import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. إعداد محرك الذكاء الاصطناعي (تأكد من وجود المفتاح في .env.local)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ============================================================
// Types & Interfaces (متوافقة تماماً مع الـ Frontend الخاص بك)
// ============================================================
type Confidence = "high" | "medium" | "low";
type AnalysisQuality = "excellent" | "good" | "partial" | "failed";

interface ProductItem {
  product_name: string;
  brand: string;
  category: string;
  unit_price: string;
  quantity: number | string;
  barcode: string;
  confidence: Confidence;
  notes: string;
}

interface AnalysisResult {
  success: boolean;
  products: ProductItem[];
  total_products_detected: number;
  analysis_quality: AnalysisQuality;
  warnings: string[];
  detected_location?: string;
}

// ============================================================
// Logic: اكتشاف الدولة والعملة واللغة
// ============================================================
function getUserContext(request: NextRequest) {
  // اكتشاف الدولة من الـ Headers (Vercel/Cloudflare) أو افتراضي "EG"
  const countryCode = request.headers.get("x-vercel-ip-country") || "EG";

  const localeMap: Record<string, { name: string; currency: string; lang: string }> = {
    "SA": { name: "المملكة العربية السعودية", currency: "ريال سعودي", lang: "العربية (السعودية)" },
    "EG": { name: "مصر", currency: "جنيه مصري", lang: "العربية (المصرية)" },
    "AE": { name: "الإمارات العربية المتحدة", currency: "درهم إماراتي", lang: "العربية (الإماراتية)" },
    "KW": { name: "الكويت", currency: "دينار كويتي", lang: "العربية (الكويتية)" },
    "QA": { name: "قطر", currency: "ريال قطري", lang: "العربية" },
    "JO": { name: "الأردن", currency: "دينار أردني", lang: "العربية" },
    "MA": { name: "المغرب", currency: "درهم مغربي", lang: "العربية (المغربية)" },
    "US": { name: "الولايات المتحدة", currency: "USD", lang: "English" },
  };

  return localeMap[countryCode] || localeMap["EG"];
}

// ============================================================
// Core Function: التحليل عبر Gemini 1.5 Flash
// ============================================================
async function analyzeWithGemini(imageBase64: string, context: any): Promise<Partial<AnalysisResult>> {
  const base64Data = imageBase64.split(",")[1] || imageBase64;

  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { 
      responseMimeType: "application/json",
      temperature: 0.1 // دقة أعلى وتقليل الهلوسة
    }
  });

  const prompt = `
    أنت مستشار جرد محترف تعمل في ${context.name}. 
    حلل صورة الرفوف واستخرج المنتجات باللغة: ${context.lang}.
    يجب أن تكون الأسعار متوافقة مع العملة: ${context.currency}.
    
    المطلوب رد JSON يحتوي مصفوفة "products" كالتالي:
    - product_name: اسم المنتج (عربي دقيق).
    - brand: العلامة التجارية.
    - category: التصنيف.
    - unit_price: السعر الرقمي فقط كـ string.
    - quantity: الكمية (رقم).
    - barcode: الباركود (إن وجد).
    - confidence: (high/medium/low).
    - notes: ملاحظات حول حالة المنتج أو وضوح السعر.

    أضف أيضاً:
    - analysis_quality: (excellent/good/partial).
    - warnings: قائمة بأي مشاكل في الصورة (إضاءة ضعيفة، منتجات متداخلة).
  `;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
    ]);

    return JSON.parse(result.response.text());
  } catch (error) {
    console.error("Gemini Execution Error:", error);
    throw new Error("فشل الذكاء الاصطناعي في معالجة الصورة.");
  }
}

// ============================================================
// Route Handler: POST
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image } = body;

    // 1. Validations
    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json({ success: false, error: "يجب تقديم صورة صالحة بتنسيق Base64" }, { status: 400 });
    }

    // 2. Get User Context (Country/Currency)
    const userContext = getUserContext(request);

    // 3. Perform AI Analysis
    const aiResponse = await analyzeWithGemini(image, userContext);

    // 4. Return Structured Response
    return NextResponse.json({
      success: true,
      products: aiResponse.products || [],
      total_products_detected: aiResponse.products?.length || 0,
      analysis_quality: aiResponse.analysis_quality || "good",
      warnings: aiResponse.warnings || [],
      detected_location: userContext.name
    });

  } catch (error: any) {
    console.error("Final API Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "حدث خطأ غير متوقع",
      detail: error.message 
    }, { status: 500 });
  }
}

// Health Check
export async function GET() {
  return NextResponse.json({ status: "active", engine: "Gemini-1.5-Flash" });
}