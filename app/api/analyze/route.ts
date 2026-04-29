import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. إعداد محرك الذكاء الاصطناعي
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

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
// Route Handler: POST
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // أ. استخراج البيانات الأساسية فوراً
    const countryCode = request.headers.get("x-vercel-ip-country");
    const userContext = getContextByCountryCode(countryCode);

    // ب. التأكد من وجود مفتاح API
    if (!process.env.GEMINI_API_KEY) {
      console.error("CRITICAL: GEMINI_API_KEY is missing!");
      return NextResponse.json({ 
        success: false, 
        error: "فشل في العثور على مفتاح API. تأكد من إعداد الملف .env.local" 
      }, { status: 500 });
    }

    // ج. قراءة الصورة من الطلب
    const body = await request.json();
    const { image } = body;

    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json({ success: false, error: "لم يتم استلام صورة صالحة" }, { status: 400 });
    }

    // د. إعداد Gemini
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.1 
      }
    });

    const base64Data = image.split(",")[1] || image;

    const prompt = `
      أنت مستشار جرد محترف في ${userContext.name}. 
      حلل الصورة واستخرج المنتجات باللغة: ${userContext.lang}.
      الأسعار يجب أن تكون بالعملة: ${userContext.currency}.
      
      يجب أن يكون الرد JSON حصري يحتوي مصفوفة "products" تشمل:
      - product_name (اسم المنتج بالعربية)
      - brand (الماركة)
      - category (التصنيف)
      - unit_price (السعر كـ string بدون عملة)
      - quantity (رقم)
      - barcode (إن وجد)
      - confidence (high/medium/low)
      - notes (ملاحظات الجرد)

      أضف أيضاً للرد الرئيسي:
      - analysis_quality (excellent/good/partial)
      - warnings (قائمة بأي مشاكل في الصورة)
    `;

    // هـ. تنفيذ التحليل
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      },
    ]);

    const responseText = result.response.text();
    
    // و. معالجة الرد والتأكد من صحته
    try {
      const aiData = JSON.parse(responseText);
      
      return NextResponse.json({
        success: true,
        products: aiData.products || [],
        total_products_detected: (aiData.products || []).length,
        analysis_quality: aiData.analysis_quality || "good",
        warnings: aiData.warnings || [],
        detected_location: userContext.name
      });
    } catch (parseError) {
      console.error("AI Response Parsing Failed:", responseText);
      return NextResponse.json({ 
        success: false, 
        error: "فشل الذكاء الاصطناعي في صياغة البيانات بشكل صحيح" 
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error("Final API Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "حدث خطأ غير متوقع في السيرفر",
      detail: error.message 
    }, { status: 500 });
  }
}

// GET للتحقق من أن الـ Endpoint يعمل
export async function GET() {
  return NextResponse.json({ 
    status: "active", 
    engine: "Gemini-1.5-Flash",
    config: "JSON_STRICT_MODE"
  });
}