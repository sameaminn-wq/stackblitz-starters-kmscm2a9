import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. إعداد محرك الذكاء الاصطناعي العالمي (Enterprise Configuration)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * نظام استخبارات الموقع - يحدد السياق الجغرافي والمالي واللغوي تلقائياً
 */
function getGlobalContext(request: NextRequest) {
  const countryCode = request.headers.get("x-vercel-ip-country") || "EG";
  
  const localeMap: Record<string, { name: string; currency: string; lang: string }> = {
    "SA": { name: "المملكة العربية السعودية", currency: "SAR", lang: "العربية" },
    "EG": { name: "مصر", currency: "EGP", lang: "العربية" },
    "AE": { name: "الإمارات", currency: "AED", lang: "العربية/English" },
    "KW": { name: "الكويت", currency: "KWD", lang: "العربية" },
    "QA": { name: "قطر", currency: "QAR", lang: "العربية" },
    "US": { name: "USA", currency: "USD", lang: "English" },
  };

  return localeMap[countryCode] || localeMap["EG"];
}

// ============================================================
// POST Handler - المحرك الرئيسي للتحليل
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // أ. استخلاص السياق والتحقق من المفاتيح
    const ctx = getGlobalContext(request);
    
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ 
        success: false, 
        error: "CRITICAL: API Key is missing. Check environment variables." 
      }, { status: 500 });
    }

    const { image } = await request.json();
    if (!image) {
      return NextResponse.json({ success: false, error: "لم يتم استلام صورة للجرد" }, { status: 400 });
    }

    // ب. تهيئة الموديل بأعلى معايير الدقة (Strict Mode)
    // نستخدم Gemini 1.5 Flash للسرعة الفائقة في معالجة الصور المتعددة العناصر
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash", 
      generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.1, // لضمان نتائج واقعية تماماً وتجنب التخيل
        topP: 0.95
      }
    });

    const base64Data = image.split(",")[1] || image;

    // ج. البرومبت العبقري المطور (The Master Intelligence Prompt)
    const masterPrompt = `
أنت "محرك الجرد البصري العالمي المتقدم" (Universal Inventory Intelligence Engine).

مهمتك الأساسية هي تحليل الصورة المرفقة وإجراء جرد احترافي دقيق لأي عناصر مخزنية أو تجارية تظهر فيها، بغض النظر عن القطاع.

[النطاق الشامل للجرد]:
1. التجزئة والمتاجر: (مواد غذائية، سلع، أسعار، باركود، تواريخ صلاحية).
2. الأدوات والمعدات: (أدوات كهربائية ويدوية مثل Bosch, Makita، تحديد القدرة W, V).
3. الأثاث والديكور: (كراسي، كنب، طاولات، تحديد الخامة واللون والطراز).
4. اللوجستيات والموانئ: (صناديق، حاويات، منصات Pallets، رموز تتبع).
5. الطب والصيدلة: (أدوية، معدات طبية، باركود طبي، تركيز).
6. الملابس والأزياء: (مقاسات، ماركات، خامات، ألوان).
7. الإلكترونيات: (هواتف، شاشات، سيريال نمبر، موديل).

[التعليمات الصارمة]:
1. اللغة: استخدم ${ctx.lang}.
2. العملة: استخدم ${ctx.currency} عند وجود تقدير سعر.
3. استخراج كل عنصر بشكل مستقل بدقة متناهية.
4. فهم حالة المنتج (جديد / مستخدم / مخزون).

[نظام الإخراج - JSON فقط]:
يجب أن يكون الرد JSON كائن يحتوي على:
{
  "business_type": "Auto-detected category",
  "analysis_quality": "excellent | good | partial",
  "detected_items_count": number,
  "products": [
    {
      "product_name": "...",
      "brand": "...",
      "category": "...",
      "unit_price": "number_only_as_string",
      "quantity": number,
      "barcode": "...",
      "confidence": "high | medium | low",
      "notes": "تفاصيل تقنية: مقاس، قوة، حالة، لون"
    }
  ],
  "warnings": []
}
`;

    // د. تنفيذ المعالجة البصرية
    const result = await model.generateContent([
      masterPrompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      },
    ]);

    const responseText = result.response.text();
    
    // هـ. التحقق من صحة الـ JSON المستلم قبل إرساله
    try {
      const parsedData = JSON.parse(responseText);
      
      return NextResponse.json({
        success: true,
        ...parsedData,
        detected_location: ctx.name,
        timestamp: new Date().toISOString()
      });
    } catch (parseError) {
      console.error("AI Parsing Error:", responseText);
      return NextResponse.json({ 
        success: false, 
        error: "فشل المحرك في صياغة البيانات بشكل سليم" 
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error("Global Master API Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "حدث خطأ غير متوقع في محرك الجرد",
      detail: error.message 
    }, { status: 500 });
  }
}

/**
 * Health Check & Model Versioning
 */
export async function GET() {
  return NextResponse.json({ 
    status: "online", 
    engine: "Universal Inventory Intelligence",
    version: "2026.4.30",
    supported_industries: ["Pharmacy", "Hardware", "Logistics", "Retail", "Furniture"]
  });
}