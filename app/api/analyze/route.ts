
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { InventoryAnalysisResult, ProductItem } from "../types";

// 1. إعداد محرك الذكاء الاصطناعي العالمي (Enterprise Configuration)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// الحد الأقصى لحجم الصورة المسموح به (5MB) بالبايت
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * نظام استخبارات الموقع - يحدد السياق الجغرافي والمالي واللغوي تلقائياً
 * @param request - كائن NextRequest الذي يحتوي على معلومات الطلب.
 * @returns كائن يحتوي على اسم البلد، العملة، واللغة بناءً على رأس 'x-vercel-ip-country'.
 */
function getGlobalContext(request: NextRequest) {
  const countryCode = request.headers.get("x-vercel-ip-country") || "US"; // الافتراضي للولايات المتحدة
  
  const localeMap: Record<string, { name: string; currency: string; lang: string }> = {
    "SA": { name: "المملكة العربية السعودية", currency: "SAR", lang: "العربية" },
    "EG": { name: "مصر", currency: "EGP", lang: "العربية" },
    "AE": { name: "الإمارات", currency: "AED", lang: "العربية/English" },
    "KW": { name: "الكويت", currency: "KWD", lang: "العربية" },
    "QA": { name: "قطر", currency: "QAR", lang: "العربية" },
    "US": { name: "الولايات المتحدة الأمريكية", currency: "USD", lang: "English" },
    "GB": { name: "المملكة المتحدة", currency: "GBP", lang: "English" },
    "DE": { name: "ألمانيا", currency: "EUR", lang: "Deutsch" },
    "FR": { name: "فرنسا", currency: "EUR", lang: "Français" },
    "IT": { name: "إيطاليا", currency: "EUR", lang: "Italiano" },
    "ES": { name: "إسبانيا", currency: "EUR", lang: "Español" },
    "JP": { name: "اليابان", currency: "JPY", lang: "日本語" },
    "CN": { name: "الصين", currency: "CNY", lang: "中文" },
    "IN": { name: "الهند", currency: "INR", lang: "English/हिन्दी" },
    "BR": { name: "البرازيل", currency: "BRL", lang: "Português" },
    "CA": { name: "كندا", currency: "CAD", lang: "English/Français" },
    "MX": { name: "المكسيك", currency: "MXN", lang: "Español" },
    "AU": { name: "أستراليا", currency: "AUD", lang: "English" },
    "SG": { name: "سنغافورة", currency: "SGD", lang: "English/中文" },
    "KR": { name: "كوريا الجنوبية", currency: "KRW", lang: "한국어" },
    "RU": { name: "روسيا", currency: "RUB", lang: "Русский" },
  };

  // ملاحظة: يعتمد هذا على رأس 'x-vercel-ip-country' الذي توفره Vercel.
  // في بيئات الاستضافة الأخرى (مثل AWS, DigitalOcean)، قد تحتاج إلى استخدام مكتبة GeoIP
  // مثل 'geoip-lite' لتحديد الموقع بناءً على IP.
  return localeMap[countryCode] || localeMap["US"];
}

// ============================================================
// POST Handler - المحرك الرئيسي للتحليل
// ============================================================
/**
 * يتعامل مع طلبات POST لتحليل الصور وإجراء جرد احترافي للعناصر.
 * @param request - كائن NextRequest الذي يحتوي على الصورة المراد تحليلها.
 * @returns استجابة JSON تحتوي على نتائج الجرد أو رسالة خطأ.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = getGlobalContext(request);
    
    if (!process.env.GEMINI_API_KEY) {
      console.error("CRITICAL: GEMINI_API_KEY is missing. Check environment variables.");
      return NextResponse.json({ 
        success: false, 
        error: "خطأ حرج: مفتاح API غير موجود. يرجى التحقق من متغيرات البيئة." 
      }, { status: 500 });
    }

    const { image } = await request.json();
    if (!image) {
      return NextResponse.json({ success: false, error: "لم يتم استلام صورة للجرد" }, { status: 400 });
    }

    let mimeType = "image/jpeg";
    const base64Parts = image.split(",");
    const base64Data = base64Parts.length > 1 ? base64Parts[1] : image;
    if (base64Parts.length > 1 && base64Parts[0].startsWith("data:")) {
      mimeType = base64Parts[0].substring(5, base64Parts[0].indexOf(";"));
    }

    if (!base64Data) {
      return NextResponse.json({ success: false, error: "صيغة الصورة غير صالحة أو فارغة" }, { status: 400 });
    }

    // التحقق من حجم الصورة لمنع هجمات DoS
    const imageBuffer = Buffer.from(base64Data, 'base64');
    if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: `حجم الصورة يتجاوز الحد الأقصى المسموح به (${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB).` }, { status: 413 });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        topP: 0.95,
      },
    });
// 1. تعريف المتغيرات المطلوبة لضمان عدم وجود أخطاء مرجعية
const ctx = {
  lang: "Arabic", // أو القيمة الديناميكية التي تستخدمها
  currency: "SAR"  // أو القيمة الديناميكية التي تستخدمها
};

// 2. إصلاح Master Prompt مع الحفاظ على النص الكامل (بدون تغيير حرف واحد)
const masterPrompt = `
  You are the "Universal Advanced Visual Inventory Engine".
  
  Your primary task is to analyze the provided image and perform a precise, professional inventory of any stock, commercial, or operational items visible, regardless of the sector or activity type.
  
  [Comprehensive Inventory Scope - Any Potential Stock]:
  You are not limited to a specific sector but handle any environment containing inventory, including:
  
  1. Retail and Stores:
     - Food items, consumer goods, canned products, beverages
     - Prices, barcodes, expiry dates, promotions
  
  2. Tools and Equipment:
     - Electric and hand tools (Drills, Grinders, Saws)
     - Industrial equipment, spare parts, measuring devices
     - Power estimation (W, V, HP) if available
  
  3. Furniture and Decor:
     - Chairs, tables, cabinets, interior decor
     - Material, color, style, and condition identification
  
  4. Logistics and Supply Chains:
     - Boxes, containers, pallets
     - Shipping numbers, tracking codes, labels
  
  5. Medicine, Pharmacy, and Laboratories:
     - Medicines, packaging, medical equipment
     - Expiry dates, concentration, medical barcodes
  
  6. Clothing and Fashion:
     - Clothes, shoes, bags
     - Sizes, brands, materials, colors
  
  7. Electronics:
     - Phones, devices, screens, electronic boards
     - Model, serial number, specifications
  
  8. Any other unclassified inventory:
     - Any item suitable for sale, storage, or inventory should be considered an "Inventory Item"
  
  [Strict Instructions]:
  1. Language: Use ${ctx.lang} for all textual output in the JSON values.
  2. Currency: Use ${ctx.currency} only when a price estimate is available.
  3. **Comprehensive and Accurate Analysis:** Analyze every part of the image with extreme precision, focusing on detecting all visible items, even small or background ones.
  4. **Do not assume unseen or unconfirmed information.** If the image quality is low or an item is unclear, set \`confidence\` to \`low\` and add a note in \`warnings\`.
  5. High accuracy in distinguishing similar items.
  6. Extract each item independently, even if duplicated.
  7. **Do not add any items not actually present in the image (Zero Hallucination).** This is critically important.
  8. **Handle low-quality images with extreme caution.** Try to extract what can be clearly extracted, and set \`confidence\` to \`low\` for questionable items. Do not invent details.
  
  [Required Analytical Intelligence]:
  - Accurately distinguish similar products (e.g., types of chargers or tools).
  - Identify brands if visible (Bosch, Makita, Samsung, Apple...).
  - Read small texts (labels, barcodes, serial numbers) with high accuracy.
  - Understand product condition (new / used / stock / on display for sale).
  - **Estimate approximate dimensions or size of items if possible, indicating that the estimate is approximate.**
  
  [Output System - JSON Only]:
  {
    "business_type": "Auto-detected business category or General_Inventory",
    "analysis_quality": "excellent | good | fair | poor", // Reflects analysis quality based on image clarity
    "detected_items_count": 0,
    "products": [
      {
        "product_name": "اسم دقيق ومحترف للمنتج",
        "brand": "العلامة التجارية إن وجدت أو null",
        "category": "التصنيف الدقيق",
        "unit_price": "رقم فقط أو null إذا غير متاح",
        "quantity": "عدد القطع الظاهرة",
        "barcode_serial": "barcode / serial / model number أو null", // Barcode, serial, and model number combined
        "confidence": "high | medium | low",
        "notes": "تفاصيل تقنية مثل المقاس، القوة، الحالة، اللون، الإصدار، أو أي معلومات إضافية مستخلصة."
      }
    ],
    "warnings": [
      "أي مشاكل في وضوح الصورة أو احتمالات خطأ في التعرف بسبب جودة الصورة المنخفضة أو التعتيم."
    ],
    "suggestions": [
      "اقتراحات لتحسين الجرد المستقبلي، مثل: 'يرجى توفير صور ذات إضاءة أفضل للحصول على نتائج أدق.'"
    ]
  };
  [Golden Rules]:
  - Do not output anything outside of JSON.
  - Do not add textual explanations outside of JSON.
  - Do not hallucinate non-existent products.
  - Each item must be independent and actually inventory-able.
  - **If the image is empty or contains no clear inventory items, return an empty JSON with 'analysis_quality': 'poor' and appropriate 'warnings'.**
  - **Ensure all values in the JSON are consistent with their type (e.g., 'unit_price' must be a number or null).**
`;

// 3. تنفيذ الاستدعاء مع معالجة الأخطاء لضمان استقرار النظام (Security Best Practices)
try {
  const result = await model.generateContent([
      masterPrompt,
      {
          inlineData: {
              data: base64Data, // تأكد أن هذا المتغير يحتوي على base64 للصورة
              mimeType: "image/png", // أو نوع الصورة المناسب
          },
      },
  ]);
  
  // التعامل مع النتيجة (Result Handling)
  const responseText = result.response.text();
  console.log("Inventory Result:", JSON.parse(responseText));

} catch (error) {
  console.error("Critical Analysis Error:", error.message);
}

    const responseText = result.response.text();
    
    try {
      const parsedData: InventoryAnalysisResult = JSON.parse(responseText);
      
      if (!parsedData.products || !Array.isArray(parsedData.products)) {
        console.warn("AI response did not contain a valid 'products' array.", responseText);
        throw new Error("Invalid AI response structure.");
      }

      return NextResponse.json({
        success: true,
        ...parsedData,
        detected_location: ctx.name,
        timestamp: new Date().toISOString()
      });
    } catch (parseError: any) {
      console.error("AI Parsing Error: Invalid JSON or structure.", parseError.message, "Raw AI Response:", responseText);
      return NextResponse.json({ 
        success: false, 
        error: "فشل المحرك في صياغة البيانات بشكل سليم أو هيكل الاستجابة غير صالح.",
        detail: parseError.message
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error("Global Master API Error:", error.message, error.stack);
    return NextResponse.json({ 
      success: false, 
      error: "حدث خطأ غير متوقع في محرك الجرد",
      detail: error.message 
    }, { status: 500 });
  }
}

/**
 * Health Check & Model Versioning
 * يوفر معلومات حول حالة API ونوعه وإصداره والصناعات المدعومة.
 * @returns استجابة JSON تحتوي على معلومات الحالة.
 */
export async function GET() {
  return NextResponse.json({
    status: "online",
    engine: "Universal Inventory Intelligence",
    version: "2026.4.30-global-professional-enhanced-v5",
    supported_industries: ["Pharmacy", "Hardware", "Logistics", "Retail", "Furniture", "Electronics", "Apparel", "General Inventory"],
    description: "Advanced AI-powered visual inventory system for highly accurate and non-hallucinatory analysis of diverse inventory items, including low-quality images, with global language and currency support and enhanced granular detection."
  });
}