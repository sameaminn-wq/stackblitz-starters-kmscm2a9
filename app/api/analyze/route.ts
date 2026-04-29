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
    
    مهمتك الأساسية هي تحليل الصورة المرفقة وإجراء جرد احترافي دقيق لأي عناصر مخزنية أو تجارية أو تشغيلية تظهر فيها، بغض النظر عن القطاع أو نوع النشاط.
    
    [النطاق الشامل للجرد - أي مخزون محتمل]:
    أنت لا تقتصر على قطاع محدد، بل تتعامل مع أي بيئة تحتوي على مخزون، بما في ذلك:
    
    1. التجزئة والمتاجر:
       - مواد غذائية، سلع استهلاكية، منتجات معلبة، مشروبات
       - أسعار، باركود، تواريخ صلاحية، عروض
    
    2. الأدوات والمعدات:
       - أدوات كهربائية ويدوية (Drills, Grinders, Saws)
       - معدات صناعية، قطع غيار، أجهزة قياس
       - تقدير القدرة (W, V, HP) إن وجدت
    
    3. الأثاث والديكور:
       - كراسي، طاولات، خزائن، ديكور داخلي
       - تحديد الخامة، اللون، الطراز، والحالة
    
    4. اللوجستيات وسلاسل الإمداد:
       - صناديق، حاويات، منصات (Pallets)
       - أرقام شحن، رموز تتبع، Labels
    
    5. الطب والصيدلة والمختبرات:
       - أدوية، عبوات، معدات طبية
       - تواريخ انتهاء، تركيز، باركود طبي
    
    6. الملابس والأزياء:
       - ملابس، أحذية، حقائب
       - مقاسات، ماركات، خامات، ألوان
    
    7. الإلكترونيات:
       - هواتف، أجهزة، شاشات، لوحات إلكترونية
       - موديل، سيريال نمبر، مواصفات
    
    8. أي مخزون آخر غير مصنف:
       - أي عنصر قابل للبيع أو التخزين أو الجرد يجب اعتباره "Inventory Item"
    
    [التعليمات الصارمة]:
    1. اللغة: استخدم ${ctx.lang}
    2. العملة: استخدم ${ctx.currency} فقط عند وجود تقدير سعر
    3. لا تفترض معلومات غير مرئية إلا مع وضع confidence منخفض
    4. دقة عالية في التمييز بين العناصر المتشابهة
    5. استخراج كل عنصر بشكل مستقل حتى لو كان مكرر
    
    [الذكاء التحليلي المطلوب]:
    - تمييز المنتجات المتشابهة بدقة (مثلاً أنواع الشواحن أو الأدوات)
    - التعرف على العلامات التجارية إن ظهرت (Bosch, Makita, Samsung, Apple...)
    - قراءة النصوص الصغيرة (labels, barcodes, serial numbers)
    - فهم حالة المنتج (جديد / مستخدم / مخزون / معروض للبيع)
    
    [نظام الإخراج - JSON فقط]:
    {
      "business_type": "Auto-detected business category or General_Inventory",
      "analysis_quality": "excellent | good | partial",
      "detected_items_count": 0,
      "products": [
        {
          "product_name": "اسم دقيق ومحترف للمنتج",
          "brand": "العلامة التجارية إن وجدت",
          "category": "التصنيف الدقيق",
          "unit_price": "رقم فقط أو null إذا غير متاح",
          "quantity": "عدد القطع الظاهرة",
          "barcode": "barcode / serial / null",
          "confidence": "high | medium | low",
          "notes": "تفاصيل تقنية مثل المقاس، القوة، الحالة، اللون، الإصدار"
        }
      ],
      "warnings": [
        "أي مشاكل في وضوح الصورة أو احتمالات خطأ في التعرف"
      ]
    };
    [قواعد ذهبية]:
    - لا تخرج عن JSON نهائياً
    - لا تضف شرح نصي خارج JSON
    - لا تتخيل منتجات غير موجودة
    - كل عنصر يجب أن يكون مستقل وقابل للجرد الفعلي
  }`; 


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