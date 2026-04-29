import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================
// الثوابت والإعدادات العامة
// ============================================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// الحدود الأمنية
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const REQUEST_TIMEOUT_MS = 45000; // 45 ثانية
const MAX_CONCURRENT_PRICE_FETCHES = 5; // الحد الأقصى للطلبات المتوازية
const BATCH_PRICE_FETCH_THRESHOLD = 10; // إذا كان عدد المنتجات > 10، استخدم الدمج

// ============================================================
// تحسين 1: استخراج JSON بدقة عالية
// ============================================================

/**
 * استخراج JSON من نص AI بشكل دقيق - يتعامل مع أي نصوص قبل أو بعد JSON
 */
function extractJSONFromText(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error("Invalid input text");
  }
  
  // إزالة markdown code blocks أولاً
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  
  // محاولة استخراج JSON بين أول { وآخر }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  
  // تحديد نوع البيانات (object أو array)
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  
  // إزالة أي محتوى غير JSON
  cleaned = cleaned.trim();
  
  // التحقق من صحة JSON الأساسية
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    throw new Error("Extracted text is not valid JSON");
  }
  
  return cleaned;
}

/**
 * تحليل آمن لردود Gemini
 */
function safeParseAIResponse<T>(responseText: string): T {
  try {
    const jsonString = extractJSONFromText(responseText);
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Failed to parse AI response:", responseText.substring(0, 500));
    throw new Error("Invalid JSON response from AI");
  }
}

// ============================================================
// تحسين 2: معالجة تكرار المنتجات (Deduplication)
// ============================================================

interface UniqueProduct {
  key: string;
  product_name: string;
  brand: string | null;
  category?: string;
  occurrences: number;
  originalIndices: number[];
}

/**
 * تصفية المنتجات الفريدة وإرجاع خريطة للتوزيع
 */
function deduplicateProducts(products: Array<{ product_name: string; brand: string | null; category?: string }>): {
  uniqueProducts: UniqueProduct[];
  distributionMap: Map<number, string>;
} {
  const uniqueMap = new Map<string, UniqueProduct>();
  const distributionMap = new Map<number, string>();
  
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const normalizedName = product.product_name.trim().toLowerCase();
    const normalizedBrand = product.brand?.trim().toLowerCase() || '';
    const uniqueKey = `${normalizedName}|${normalizedBrand}`;
    
    distributionMap.set(i, uniqueKey);
    
    if (uniqueMap.has(uniqueKey)) {
      const existing = uniqueMap.get(uniqueKey)!;
      existing.occurrences++;
      existing.originalIndices.push(i);
    } else {
      uniqueMap.set(uniqueKey, {
        key: uniqueKey,
        product_name: product.product_name,
        brand: product.brand,
        category: product.category,
        occurrences: 1,
        originalIndices: [i]
      });
    }
  }
  
  return {
    uniqueProducts: Array.from(uniqueMap.values()),
    distributionMap
  };
}

// ============================================================
// تحسين 3: جلب الأسعار مع تجنب التكرار
// ============================================================

interface PriceInfo {
  price: number | null;
  confidence: string;
  source: string;
}

/**
 * جلب سعر منتج واحد فردي
 */
async function fetchSingleProductPrice(
  productName: string,
  brand: string | null,
  currencyCode: string
): Promise<PriceInfo> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const brandText = brand ? `brand ${brand}` : "";
    
    const prompt = `
      Return ONLY valid JSON with current market price for ${productName} ${brandText} in ${currencyCode}.
      FORMAT: {"price": number, "confidence": "high|medium|low", "source": "string"}
      If price unknown, return {"price": null, "confidence": "low", "source": "unknown"}
    `;
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const data = safeParseAIResponse<{ price: number | null; confidence: string; source: string }>(responseText);
    
    return {
      price: data.price && typeof data.price === 'number' ? data.price : null,
      confidence: data.confidence || "medium",
      source: data.source || "ai_estimate"
    };
  } catch (error) {
    console.error(`Failed to fetch price for ${productName}:`, error);
    return { price: null, confidence: "low", source: "error" };
  }
}

/**
 * جلب أسعار المنتجات الفريدة باستخدام طلب مجمع واحد
 */
async function fetchBatchPricesUnique(
  uniqueProducts: UniqueProduct[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const productList = uniqueProducts.map((p, i) => 
      `${i + 1}. ${p.product_name}${p.brand ? ` (${p.brand})` : ''}${p.occurrences > 1 ? ` [quantity: ${p.occurrences}]` : ''}`
    ).join('\n');
    
    const prompt = `
      You are a market price API. Return ONLY valid JSON array with current market prices.
      
      Products (unique items - some may have multiple quantities):
      ${productList}
      
      Currency: ${currencyCode}
      
      FORMAT (return exactly ${uniqueProducts.length} items):
      [
        {"product_key": "${uniqueProducts[0]?.key || ''}", "price": number, "confidence": "high|medium|low", "source": "string"},
        ...
      ]
      
      RULES:
      - For identical products with multiple quantities, return a single price
      - Use real market prices when possible
      - For unknown products, set price = null
    `;
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const data = safeParseAIResponse<any[]>(responseText);
    
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.product_key) {
          results.set(item.product_key, {
            price: item.price,
            confidence: item.confidence || "medium",
            source: item.source || "batch_estimate"
          });
        }
      }
    }
    
    // التأكد من أن كل المنتجات الفريدة لديها نتيجة
    for (const product of uniqueProducts) {
      if (!results.has(product.key)) {
        results.set(product.key, {
          price: null,
          confidence: "low",
          source: "not_found"
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error("Batch price fetch failed:", error);
    for (const product of uniqueProducts) {
      results.set(product.key, {
        price: null,
        confidence: "low",
        source: "error"
      });
    }
    return results;
  }
}

/**
 * جلب أسعار المنتجات الفريدة باستخدام طلبات متوازية
 */
async function fetchParallelPricesUnique(
  uniqueProducts: UniqueProduct[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();
  
  const chunks = [];
  for (let i = 0; i < uniqueProducts.length; i += MAX_CONCURRENT_PRICE_FETCHES) {
    chunks.push(uniqueProducts.slice(i, i + MAX_CONCURRENT_PRICE_FETCHES));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (product) => {
      try {
        const priceInfo = await fetchSingleProductPrice(product.product_name, product.brand, currencyCode);
        return { key: product.key, ...priceInfo };
      } catch (error) {
        return { key: product.key, price: null, confidence: "low", source: "error" };
      }
    });
    
    const chunkResults = await Promise.all(promises);
    for (const result of chunkResults) {
      results.set(result.key, {
        price: result.price,
        confidence: result.confidence,
        source: result.source
      });
    }
  }
  
  return results;
}

/**
 * جلب أسعار المنتجات بشكل ذكي - مع تصفية المكررات أولاً
 */
async function fetchBatchMarketPricesOptimized(
  products: Array<{ product_name: string; brand: string | null; category?: string }>,
  currencyCode: string
): Promise<{ results: Map<string, PriceInfo>; savedRequests: number; uniqueCount: number }> {
  
  if (products.length === 0) {
    return { results: new Map(), savedRequests: 0, uniqueCount: 0 };
  }
  
  const { uniqueProducts, distributionMap } = deduplicateProducts(products);
  const originalCount = products.length;
  const uniqueCount = uniqueProducts.length;
  const savedRequests = originalCount - uniqueCount;
  
  console.log(`📊 Optimization: ${originalCount} products → ${uniqueCount} unique (saved ${savedRequests} API calls)`);
  
  let priceFetchResults: Map<string, PriceInfo>;
  
  if (uniqueCount > BATCH_PRICE_FETCH_THRESHOLD) {
    console.log(`📦 Using batch fetch for ${uniqueCount} unique products`);
    priceFetchResults = await fetchBatchPricesUnique(uniqueProducts, currencyCode);
  } else {
    console.log(`⚡ Using parallel fetch for ${uniqueCount} unique products`);
    priceFetchResults = await fetchParallelPricesUnique(uniqueProducts, currencyCode);
  }
  
  return { results: priceFetchResults, savedRequests, uniqueCount };
}

// ============================================================
// تحسين 4: isValidBase64 المتقدم
// ============================================================

function isValidBase64(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  
  const dangerousPatterns = ['../', '..\\', '\0', '%00', '\x00', '\\x00', '--', '/*', '*/', '<!--', '-->', '<script', '</script', 'javascript:', 'onload=', 'onerror='];
  for (const pattern of dangerousPatterns) {
    if (str.toLowerCase().includes(pattern.toLowerCase())) return false;
  }
  
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  if (str.length > MAX_REQUEST_SIZE_BYTES) return false;
  
  try {
    Buffer.from(str, 'base64');
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// نظام العملات العالمي
// ============================================================

interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  nameAr: string;
  exchangeRateToUSD: number;
  lastUpdated: string;
}

const CURRENCY_DB: Record<string, CurrencyInfo> = {
  "SA": { code: "SAR", symbol: "﷼", name: "Saudi Riyal", nameAr: "ريال سعودي", exchangeRateToUSD: 3.75, lastUpdated: new Date().toISOString() },
  "EG": { code: "EGP", symbol: "E£", name: "Egyptian Pound", nameAr: "جنيه مصري", exchangeRateToUSD: 48.5, lastUpdated: new Date().toISOString() },
  "AE": { code: "AED", symbol: "د.إ", name: "UAE Dirham", nameAr: "درهم إماراتي", exchangeRateToUSD: 3.67, lastUpdated: new Date().toISOString() },
  "KW": { code: "KWD", symbol: "KD", name: "Kuwaiti Dinar", nameAr: "دينار كويتي", exchangeRateToUSD: 3.26, lastUpdated: new Date().toISOString() },
  "QA": { code: "QAR", symbol: "﷼", name: "Qatari Riyal", nameAr: "ريال قطري", exchangeRateToUSD: 3.64, lastUpdated: new Date().toISOString() },
  "BH": { code: "BHD", symbol: "BD", name: "Bahraini Dinar", nameAr: "دينار بحريني", exchangeRateToUSD: 3.76, lastUpdated: new Date().toISOString() },
  "OM": { code: "OMR", symbol: "﷼", name: "Omani Rial", nameAr: "ريال عماني", exchangeRateToUSD: 3.84, lastUpdated: new Date().toISOString() },
  "JO": { code: "JOD", symbol: "JD", name: "Jordanian Dinar", nameAr: "دينار أردني", exchangeRateToUSD: 0.71, lastUpdated: new Date().toISOString() },
  "LB": { code: "LBP", symbol: "ل.ل", name: "Lebanese Pound", nameAr: "ليرة لبنانية", exchangeRateToUSD: 89500, lastUpdated: new Date().toISOString() },
  "US": { code: "USD", symbol: "$", name: "US Dollar", nameAr: "دولار أمريكي", exchangeRateToUSD: 1, lastUpdated: new Date().toISOString() },
  "GB": { code: "GBP", symbol: "£", name: "British Pound", nameAr: "جنيه إسترليني", exchangeRateToUSD: 1.27, lastUpdated: new Date().toISOString() },
  "EU": { code: "EUR", symbol: "€", name: "Euro", nameAr: "يورو", exchangeRateToUSD: 1.09, lastUpdated: new Date().toISOString() },
  "TR": { code: "TRY", symbol: "₺", name: "Turkish Lira", nameAr: "ليرة تركية", exchangeRateToUSD: 32.5, lastUpdated: new Date().toISOString() },
  "PK": { code: "PKR", symbol: "₨", name: "Pakistani Rupee", nameAr: "روبية باكستانية", exchangeRateToUSD: 278, lastUpdated: new Date().toISOString() },
  "IN": { code: "INR", symbol: "₹", name: "Indian Rupee", nameAr: "روبية هندية", exchangeRateToUSD: 83.5, lastUpdated: new Date().toISOString() },
  "CN": { code: "CNY", symbol: "¥", name: "Chinese Yuan", nameAr: "يوان صيني", exchangeRateToUSD: 7.25, lastUpdated: new Date().toISOString() },
  "JP": { code: "JPY", symbol: "¥", name: "Japanese Yen", nameAr: "ين ياباني", exchangeRateToUSD: 154, lastUpdated: new Date().toISOString() },
  "KR": { code: "KRW", symbol: "₩", name: "South Korean Won", nameAr: "وون كوري", exchangeRateToUSD: 1370, lastUpdated: new Date().toISOString() },
  "RU": { code: "RUB", symbol: "₽", name: "Russian Ruble", nameAr: "روبل روسي", exchangeRateToUSD: 92, lastUpdated: new Date().toISOString() },
  "CA": { code: "CAD", symbol: "$", name: "Canadian Dollar", nameAr: "دولار كندي", exchangeRateToUSD: 1.37, lastUpdated: new Date().toISOString() },
  "AU": { code: "AUD", symbol: "$", name: "Australian Dollar", nameAr: "دولار أسترالي", exchangeRateToUSD: 0.66, lastUpdated: new Date().toISOString() },
  "CH": { code: "CHF", symbol: "Fr", name: "Swiss Franc", nameAr: "فرنك سويسري", exchangeRateToUSD: 0.91, lastUpdated: new Date().toISOString() },
  "SG": { code: "SGD", symbol: "$", name: "Singapore Dollar", nameAr: "دولار سنغافوري", exchangeRateToUSD: 1.35, lastUpdated: new Date().toISOString() },
  "MY": { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", nameAr: "رينغيت ماليزي", exchangeRateToUSD: 4.73, lastUpdated: new Date().toISOString() },
  "ID": { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", nameAr: "روبية إندونيسية", exchangeRateToUSD: 16000, lastUpdated: new Date().toISOString() },
  "BD": { code: "BDT", symbol: "৳", name: "Bangladeshi Taka", nameAr: "تاكا بنغلاديشي", exchangeRateToUSD: 117, lastUpdated: new Date().toISOString() },
  "NG": { code: "NGN", symbol: "₦", name: "Nigerian Naira", nameAr: "نايرا نيجيري", exchangeRateToUSD: 1480, lastUpdated: new Date().toISOString() },
  "ZA": { code: "ZAR", symbol: "R", name: "South African Rand", nameAr: "راند جنوب أفريقي", exchangeRateToUSD: 18.7, lastUpdated: new Date().toISOString() },
  "BR": { code: "BRL", symbol: "R$", name: "Brazilian Real", nameAr: "ريال برازيلي", exchangeRateToUSD: 5.15, lastUpdated: new Date().toISOString() },
  "MX": { code: "MXN", symbol: "$", name: "Mexican Peso", nameAr: "بيزو مكسيكي", exchangeRateToUSD: 17.2, lastUpdated: new Date().toISOString() },
};

// Cache لأسعار الصرف
let cachedExchangeRates: Record<string, number> = {};
let lastExchangeRateUpdate: Date | null = null;
const EXCHANGE_RATE_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchLatestExchangeRates(currencyCode: string): Promise<number | null> {
  if (lastExchangeRateUpdate && (Date.now() - lastExchangeRateUpdate.getTime()) < EXCHANGE_RATE_CACHE_TTL_MS) {
    return cachedExchangeRates[currencyCode] || null;
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `Return ONLY valid JSON with current exchange rate for ${currencyCode} to USD. FORMAT: {"currency": "${currencyCode}", "rate_to_usd": number}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const data = safeParseAIResponse<{ rate_to_usd: number }>(responseText);
    
    if (data.rate_to_usd && typeof data.rate_to_usd === 'number') {
      cachedExchangeRates[currencyCode] = data.rate_to_usd;
      lastExchangeRateUpdate = new Date();
      return data.rate_to_usd;
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch exchange rates:", error);
    return null;
  }
}

// ============================================================
// دوال المساعدة العامة
// ============================================================

function getAcceptLanguage(request: NextRequest): string {
  const acceptLang = request.headers.get("accept-language") || "";
  if (acceptLang.includes("ar") || acceptLang.includes("arabic")) return "ar";
  return "en";
}

function sanitizeArabicText(text: string, maxLength: number = 500): string {
  if (!text || typeof text !== 'string') return "";
  const cleaned = text.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/on\w+=/gi, '').trim();
  return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
}

function getGlobalContext(request: NextRequest) {
  const countryCode = request.headers.get("x-vercel-ip-country") || "SA";
  const userLangPref = getAcceptLanguage(request);
  
  const localeMap: Record<string, { name: string; currencyCode: string; lang: string; displayNameAr: string }> = {
    "SA": { name: "Saudi Arabia", currencyCode: "SAR", lang: "ar", displayNameAr: "المملكة العربية السعودية" },
    "EG": { name: "Egypt", currencyCode: "EGP", lang: "ar", displayNameAr: "مصر" },
    "AE": { name: "UAE", currencyCode: "AED", lang: "ar", displayNameAr: "الإمارات العربية المتحدة" },
    "KW": { name: "Kuwait", currencyCode: "KWD", lang: "ar", displayNameAr: "الكويت" },
    "QA": { name: "Qatar", currencyCode: "QAR", lang: "ar", displayNameAr: "قطر" },
    "US": { name: "United States", currencyCode: "USD", lang: "en", displayNameAr: "الولايات المتحدة الأمريكية" },
    "GB": { name: "United Kingdom", currencyCode: "GBP", lang: "en", displayNameAr: "المملكة المتحدة" },
    "TR": { name: "Turkey", currencyCode: "TRY", lang: "tr", displayNameAr: "تركيا" },
    "PK": { name: "Pakistan", currencyCode: "PKR", lang: "ur", displayNameAr: "باكستان" },
    "IN": { name: "India", currencyCode: "INR", lang: "hi", displayNameAr: "الهند" },
    "CN": { name: "China", currencyCode: "CNY", lang: "zh", displayNameAr: "الصين" },
    "JP": { name: "Japan", currencyCode: "JPY", lang: "ja", displayNameAr: "اليابان" },
    "KR": { name: "South Korea", currencyCode: "KRW", lang: "ko", displayNameAr: "كوريا الجنوبية" },
    "RU": { name: "Russia", currencyCode: "RUB", lang: "ru", displayNameAr: "روسيا" },
    "CA": { name: "Canada", currencyCode: "CAD", lang: "en", displayNameAr: "كندا" },
    "AU": { name: "Australia", currencyCode: "AUD", lang: "en", displayNameAr: "أستراليا" },
  };

  const selected = localeMap[countryCode] || localeMap["SA"];
  const currencyInfo = CURRENCY_DB[countryCode] || CURRENCY_DB["SA"];
  
  return {
    ...selected,
    currency: currencyInfo,
    displayName: userLangPref === "ar" ? selected.displayNameAr : selected.name,
    preferredLang: userLangPref
  };
}

// ============================================================
// البرومبت الاحترافي الكامل
// ============================================================

function getProfessionalMasterPrompt(ctx: any, responseLang: string, currencyCode: string, currencySymbol: string): string {
  const systemLanguage = ctx.lang === "ar" ? "العربية" : "English";
  const currencyName = responseLang === "ar" ? ctx.currency.nameAr : ctx.currency.name;
  
  return `أنت "محرك الجرد البصري المتقدم الشامل مع أسعار السوق لحظياً" - "Universal Advanced Visual Inventory Engine with Real-Time Market Pricing"

المهمة الأساسية: تحليل الصورة المقدمة وإجراء جرد احترافي دقيق لجميع أصناف المخزون المرئية، مع توفير أسعار السوق الحالية.

【نطاق الجرد الشامل - أي مخزون محتمل】
أنت غير محدود بقطاع معين، بل تتعامل مع أي بيئة تحتوي على مخزون:

1. التجزئة والمتاجر - الأطعمة، المشروبات، المنتجات الاستهلاكية، العلب، الأسعار، الباركود، تواريخ الصلاحية
2. الأدوات والمعدات - الأدوات الكهربائية واليدوية، المعدات الصناعية، قطع الغيار، أجهزة القياس
3. الأثاث والديكور - الكراسي، الطاولات، الخزائن، الديكور الداخلي، المواد، الألوان
4. الخدمات اللوجستية - الصناديق، الحاويات، المنصات، أرقام الشحن
5. الطب والصيدليات - الأدوية، المعدات الطبية، تواريخ الصلاحية، الباركود الطبي
6. الملابس والموضة - الملابس، الأحذية، الحقائب، المقاسات، الماركات
7. الإلكترونيات - الهواتف، الأجهزة، الشاشات، الموديلات، الأرقام التسلسلية
8. أي مخزون آخر غير مصنف

【تعليمات صارمة】
1. اللغة: استخدم ${systemLanguage} لجميع المخرجات النصية في JSON
2. العملة: استخدم ${currencyCode} (${currencySymbol} - ${currencyName}) لجميع الأسعار
3. تحليل دقيق وشامل: حلل كل جزء من الصورة بدقة متناهية
4. لا تختلق منتجات غير موجودة (Zero Hallucination) - هذا مهم للغاية
5. التعامل مع الصور منخفضة الجودة بحذر شديد
6. استخرج كل عنصر بشكل مستقل، حتى لو كان مكرراً
7. دقة عالية في التمييز بين المنتجات المتشابهة
8. تحديد الماركات التجارية إذا كانت مرئية

【الذكاء التحليلي المطلوب】
- قراءة النصوص الصغيرة (الملصقات، الباركود، الأرقام التسلسلية) بدقة عالية
- فهم حالة المنتج (جديد / مستخدم / مخزون / معروض للبيع)
- تقدير الأبعاد التقريبية للعناصر إذا أمكن
- توفير أسعار سوقية حالية لكل منتج

【نظام المخرجات - JSON فقط】
{
  "business_type": "نوع النشاط التجاري",
  "analysis_quality": "excellent|good|fair|poor",
  "detected_items_count": 0,
  "currency_used": "${currencyCode}",
  "exchange_rate_to_usd": ${ctx.currency.exchangeRateToUSD},
  "products": [
    {
      "product_name": "اسم المنتج باللغة ${systemLanguage}",
      "brand": "اسم الماركة أو null",
      "category": "التصنيف باللغة ${systemLanguage}",
      "current_market_price": 0,
      "price_currency": "${currencyCode}",
      "price_confidence": "high|medium|low",
      "price_source": "market_data|ai_estimate|similar_product",
      "quantity": 1,
      "barcode_serial": "باركود/رقم تسلسلي أو null",
      "confidence": "high|medium|low",
      "notes": "ملاحظات تقنية باللغة ${systemLanguage}"
    }
  ],
  "total_estimated_value": 0,
  "warnings": ["تحذيرات باللغة ${systemLanguage}"],
  "suggestions": ["اقتراحات باللغة ${systemLanguage}"]
}

【القواعد الذهبية】
- لا تخرج أي شيء خارج JSON
- لا تخرج تفسيرات نصية خارج JSON
- لا تختلق منتجات غير موجودة
- استخدم ${systemLanguage} لجميع النصوص
- كن واقعياً في التسعير
- إذا كانت الصورة فارغة، أعد array فارغ مع analysis_quality: "poor"`;
}

// ============================================================
// POST Handler - المحرك الرئيسي
// ============================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const timeoutId = setTimeout(() => {}, REQUEST_TIMEOUT_MS);
  
  try {
    const ctx = getGlobalContext(request);
    const responseLang = ctx.preferredLang === "ar" ? "ar" : "en";
    const currencyCode = ctx.currency.code;
    const currencySymbol = ctx.currency.symbol;
    
    // تحديث سعر الصرف
    const freshRate = await fetchLatestExchangeRates(currencyCode);
    if (freshRate) {
      ctx.currency.exchangeRateToUSD = freshRate;
    }
    
    // التحقق من حجم الطلب
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: "حجم الطلب كبير جداً" }, { status: 413 });
    }
    
    // التحقق من مفتاح API
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
      return NextResponse.json({ success: false, error: "مفتاح API غير موجود" }, { status: 500 });
    }
    
    // قراءة الطلب
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "طلب غير صالح" }, { status: 400 });
    }
    
    const { image, fetch_prices = true } = body;
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ success: false, error: "لم يتم استلام صورة" }, { status: 400 });
    }
    
    // معالجة الصورة
    let base64Data: string;
    let mimeType = "image/jpeg";
    const base64Parts = image.split(",");
    
    if (base64Parts.length > 1 && base64Parts[0].startsWith("data:")) {
      mimeType = base64Parts[0].substring(5, base64Parts[0].indexOf(";"));
      base64Data = base64Parts[1];
    } else {
      base64Data = image;
    }
    
    if (!isValidBase64(base64Data)) {
      return NextResponse.json({ success: false, error: "صيغة الصورة غير صالحة" }, { status: 400 });
    }
    
    const imageBuffer = Buffer.from(base64Data, 'base64');
    if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: `حجم الصورة يتجاوز ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB` }, { status: 413 });
    }
    
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!allowedMimeTypes.includes(mimeType)) mimeType = "image/jpeg";
    
    // تحليل الصورة باستخدام Gemini
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    });
    
    const masterPrompt = getProfessionalMasterPrompt(ctx, responseLang, currencyCode, currencySymbol);
    
    let result;
    try {
      result = await Promise.race([
        model.generateContent([masterPrompt, { inlineData: { data: base64Data, mimeType } }]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Request timeout")), REQUEST_TIMEOUT_MS))
      ]);
    } catch (apiError) {
      console.error("Gemini API Error:", apiError);
      return NextResponse.json({ success: false, error: "فشل تحليل الصورة" }, { status: 503 });
    }
    
    if (!result || !result.response) {
      throw new Error("Empty response from AI");
    }
    
    const responseText = result.response.text();
    let parsedData;
    try {
      parsedData = safeParseAIResponse(responseText);
    } catch (parseError) {
      console.error("Parse Error:", responseText.substring(0, 500));
      return NextResponse.json({ success: false, error: "خطأ في تنسيق البيانات" }, { status: 500 });
    }
    
    if (!parsedData.products || !Array.isArray(parsedData.products)) {
      parsedData.products = [];
    }
    
    // جلب الأسعار مع تحسين تجنب التكرار
    let enrichedProducts = [...parsedData.products];
    let marketPricesFetched = false;
    let savedRequests = 0;
    let uniqueProductsCount = 0;
    
    if (fetch_prices && enrichedProducts.length > 0) {
      const productsForPrice = enrichedProducts.map(p => ({
        product_name: p.product_name,
        brand: p.brand,
        category: p.category
      }));
      
      const { results: priceResults, savedRequests: saved, uniqueCount } = 
        await fetchBatchMarketPricesOptimized(productsForPrice, currencyCode);
      
      savedRequests = saved;
      uniqueProductsCount = uniqueCount;
      
      // تطبيق الأسعار
      for (let i = 0; i < enrichedProducts.length; i++) {
        const product = enrichedProducts[i];
        const normalizedName = product.product_name.trim().toLowerCase();
        const normalizedBrand = product.brand?.trim().toLowerCase() || '';
        const uniqueKey = `${normalizedName}|${normalizedBrand}`;
        
        const priceInfo = priceResults.get(uniqueKey);
        if (priceInfo && priceInfo.price) {
          enrichedProducts[i] = {
            ...product,
            current_market_price: priceInfo.price,
            price_currency: currencyCode,
            price_confidence: priceInfo.confidence,
            price_source: priceInfo.source
          };
          marketPricesFetched = true;
        } else {
          enrichedProducts[i] = {
            ...product,
            current_market_price: product.current_market_price || null,
            price_currency: currencyCode,
            price_confidence: "low",
            price_source: "unavailable"
          };
        }
      }
    }
    
    // حساب القيمة الإجمالية
    const totalEstimatedValue = enrichedProducts.reduce((sum, product) => {
      if (product.current_market_price && product.quantity) {
        return sum + (product.current_market_price * product.quantity);
      }
      return sum;
    }, 0);
    
    // تنقية البيانات
    const sanitizedProducts = enrichedProducts.map((product: any) => ({
      product_name: sanitizeArabicText(product.product_name || (responseLang === "ar" ? "منتج غير معروف" : "Unknown"), 500),
      brand: product.brand ? sanitizeArabicText(product.brand, 200) : null,
      category: sanitizeArabicText(product.category || (responseLang === "ar" ? "عام" : "General"), 200),
      current_market_price: product.current_market_price || null,
      price_currency: currencyCode,
      price_confidence: product.price_confidence || "low",
      price_source: product.price_source || "not_fetched",
      quantity: (typeof product.quantity === 'number' && product.quantity > 0) ? Math.floor(product.quantity) : 1,
      confidence: ['high', 'medium', 'low'].includes(product.confidence) ? product.confidence : 'medium',
      notes: sanitizeArabicText(product.notes || "", 1000)
    }));
    
    const totalDuration = Date.now() - startTime;
    
    return NextResponse.json({
      success: true,
      performance_metrics: {
        total_duration_ms: totalDuration,
        products_count: sanitizedProducts.length,
        prices_fetched: marketPricesFetched,
        unique_products_count: uniqueProductsCount,
        saved_api_calls: savedRequests,
        optimization_ratio: sanitizedProducts.length > 0 ? `${savedRequests}/${sanitizedProducts.length}` : "0/0"
      },
      business_type: sanitizeArabicText(parsedData.business_type || (responseLang === "ar" ? "مخزون عام" : "General_Inventory"), 100),
      analysis_quality: ['excellent', 'good', 'fair', 'poor'].includes(parsedData.analysis_quality) ? parsedData.analysis_quality : "fair",
      detected_items_count: sanitizedProducts.length,
      currency_info: {
        code: currencyCode,
        symbol: currencySymbol,
        name: responseLang === "ar" ? ctx.currency.nameAr : ctx.currency.name,
        exchange_rate_to_usd: ctx.currency.exchangeRateToUSD,
        last_updated: ctx.currency.lastUpdated
      },
      products: sanitizedProducts,
      total_estimated_value: totalEstimatedValue,
      total_estimated_value_formatted: `${currencySymbol}${totalEstimatedValue.toLocaleString(responseLang === "ar" ? "ar-EG" : "en-US")}`,
      warnings: Array.isArray(parsedData.warnings) ? parsedData.warnings.slice(0, 10).map((w: string) => sanitizeArabicText(w, 500)) : [],
      suggestions: Array.isArray(parsedData.suggestions) ? parsedData.suggestions.slice(0, 5).map((s: string) => sanitizeArabicText(s, 500)) : [],
      detected_location: ctx.displayName,
      language_used: ctx.lang === "ar" ? "العربية" : "English",
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error("API Error:", error.message);
    return NextResponse.json({ success: false, error: "حدث خطأ غير متوقع" }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================
// GET Handler
// ============================================================

export async function GET(request: NextRequest) {
  const ctx = getGlobalContext(request);
  const isArabic = ctx.preferredLang === "ar";
  
  const rates = Object.values(CURRENCY_DB).reduce((acc, curr) => {
    acc[curr.code] = { rate_to_usd: curr.exchangeRateToUSD, last_updated: curr.lastUpdated };
    return acc;
  }, {} as Record<string, any>);
  
  return NextResponse.json({
    status: "online",
    status_ar: "متصل",
    engine: "Universal Inventory Intelligence with Real-Time Pricing",
    engine_ar: "محرك الجرد الذكي الشامل مع أسعار السوق لحظياً",
    version: "2026.4.30-professional-final-v8",
    features: {
      auto_currency_detection: true,
      real_time_market_prices: true,
      multi_language_support: true,
      arabic_language: true,
      exchange_rate_updates: "hourly",
      product_deduplication: true,
      smart_json_extraction: true
    },
    current_currency: {
      code: ctx.currency.code,
      symbol: ctx.currency.symbol,
      name: isArabic ? ctx.currency.nameAr : ctx.currency.name,
      exchange_rate_to_usd: ctx.currency.exchangeRateToUSD
    },
    all_currencies: rates,
    supported_industries: ["Pharmacy", "Hardware", "Logistics", "Retail", "Furniture", "Electronics", "Apparel", "General Inventory"],
    supported_industries_ar: ["الصيدليات", "العدد والمعدات", "الخدمات اللوجستية", "متاجر التجزئة", "الأثاث", "الإلكترونيات", "الملابس", "المخزون العام"],
    description: isArabic
      ? "نظام متقدم للجرد البصري يعمل بالذكاء الاصطناعي مع تحديد تلقائي للعملة وجلب أسعار السوق الحالية، وتحليل دقيق للمنتجات مع دعم كامل للغة العربية وتصفية ذكية للمنتجات المكررة."
      : "Advanced AI-powered visual inventory system with automatic currency detection, real-time market price fetching, accurate product analysis with full Arabic language support and smart product deduplication.",
    endpoints: {
      post: "/api/analyze - Send base64 image for inventory analysis",
      get: "/api/analyze - Get API information"
    }
  });
}