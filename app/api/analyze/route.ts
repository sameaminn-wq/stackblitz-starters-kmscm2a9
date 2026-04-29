import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. إعداد محرك الذكاء الاصطناعي
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ============================================================
// Types & Interfaces
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
// Logic: تحويل كود الدولة إلى سياق (Currency/Lang)
// ============================================================
function getContextByCountryCode(code: string | null) {
  const country = code || "EG";

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

  return localeMap[country] || localeMap["EG"];
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
      temperature: 0.1 
    }
  });

  const prompt = `
    أنت مستشار جرد محترف تعمل في ${context.name}. 
    حلل صورة الرفوف واستخرج المنتجات باللغة: ${context.lang}.
    يجب أن تكون الأسعار متوافقة مع العملة المحلية: ${context.currency}.
    
    المطلوب رد JSON حصري يحتوي مصفوفة "products" كالتالي:
    - product_name: اسم المنتج بالعربية.
    - brand: العلامة التجارية.
    - category: التصنيف.
    - unit_price: السعر الرقمي فقط كـ string.
    - quantity: الكمية المكتشفة (رقم).
    - barcode: الباركود إن وجد.
    - confidence: (high/medium/low).
    - notes: ملاحظات حول المنتج.

    أضف أيضاً للرد:
    - analysis_quality: (excellent/good/partial).
    - warnings: أي مشاكل في وضوح الصورة.
  `;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
    ]);

    return JSON.parse(result.response.text());
  } catch (error: any) {
    console.error("Gemini Error:", error);
    throw new Error(error.message || "فشل تحليل الصورة عبر AI");
  }
}

// ============================================================
// Route Handler: POST
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // استخراج الهيدر فوراً لتجنب مشاكل الـ AsyncStorage في Next.js
    const countryCode = request.headers.get("x-vercel-ip-country");
    
    const body = await request.json();
    const { image } = body;

    // التأكد من وجود مفتاح API
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ success: false, error: "API Key is missing in environment" }, { status: 500 });
    }

    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json({ success: false, error: "صورة غير صالحة" }, { status: 400 });
    }

    // بناء السياق الجغرافي
    const userContext = getContextByCountryCode(countryCode);

    // التحليل
    const aiResponse = await analyzeWithGemini(image, userContext);

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
      error: "حدث خطأ في السيرفر",
      detail: error.message 
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "active", engine: "Gemini-1.5-Flash" });
}