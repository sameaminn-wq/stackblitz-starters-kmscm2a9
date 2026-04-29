// app/api/analyze/route.ts

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { InventoryAnalysisResult, ProductItem, Confidence } from "../../types";

// ============================================================
// الثوابت والإعدادات العامة
// ============================================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL_NAME = "gemini-2.5-flash"; // ✅ استخدام نموذج واحد فقط

// الحدود الأمنية
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const REQUEST_TIMEOUT_MS = 60000; // 60 ثانية
const MAX_CONCURRENT_PRICE_FETCHES = 3; // تقليل التوازي لتجنب الـ rate limits
const BATCH_PRICE_FETCH_THRESHOLD = 8; // تقليل العتبة

// إعدادات إعادة المحاولة
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 5000;

// ============================================================
// دالة إعادة المحاولة التلقائية (لخطأ 429)
// ============================================================

async function retryOnQuotaExceeded<T>(
  fn: () => Promise<T>,
  operationName: string,
  retryCount: number = 0
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || 
                         error?.message?.includes("quota") || 
                         error?.message?.includes("rate limit");
    
    if (isQuotaError && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`⚠️ Quota exceeded for ${operationName}. Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOnQuotaExceeded(fn, operationName, retryCount + 1);
    }
    throw error;
  }
}

// ============================================================
// تحسين 1: استخراج JSON بدقة عالية
// ============================================================

function extractJSONFromText(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error("Invalid input text");
  }
  
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  
  cleaned = cleaned.trim();
  
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    throw new Error("Extracted text is not valid JSON");
  }
  
  return cleaned;
}

function safeParseAIResponse<T>(responseText: string): T {
  const jsonString = extractJSONFromText(responseText);
  return JSON.parse(jsonString);
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
// جلب الأسعار (باستخدام gemini-2.5-flash فقط)
// ============================================================

interface PriceInfo {
  price: number | null;
  confidence: string;
  source: string;
}

async function fetchSingleProductPrice(
  productName: string,
  brand: string | null,
  currencyCode: string
): Promise<PriceInfo> {
  return retryOnQuotaExceeded(async () => {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
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
  }, `fetchPrice_${productName}`);
}

async function fetchBatchPricesUnique(
  uniqueProducts: UniqueProduct[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  return retryOnQuotaExceeded(async () => {
    const results = new Map<string, PriceInfo>();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    const productList = uniqueProducts.map((p, i) => 
      `${i + 1}. ${p.product_name}${p.brand ? ` (${p.brand})` : ''}${p.occurrences > 1 ? ` [quantity: ${p.occurrences}]` : ''}`
    ).join('\n');
    
    const prompt = `
      You are a market price API. Return ONLY valid JSON array with current market prices.
      
      Products (unique items):
      ${productList}
      
      Currency: ${currencyCode}
      
      FORMAT (return exactly ${uniqueProducts.length} items):
      [
        {"product_key": "key", "price": number, "confidence": "high|medium|low", "source": "string"}
      ]
      
      For unknown products, set price = null.
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
    
    for (const product of uniqueProducts) {
      if (!results.has(product.key)) {
        results.set(product.key, { price: null, confidence: "low", source: "not_found" });
      }
    }
    
    return results;
  }, "batchPriceFetch");
}

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
      const priceInfo = await fetchSingleProductPrice(product.product_name, product.brand, currencyCode);
      return { key: product.key, ...priceInfo };
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
  
  console.log(`📊 Optimization: ${originalCount} products → ${uniqueCount} unique (saved ${savedRequests} calls)`);
  
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
// جلب أسعار الصرف (باستخدام gemini-2.5-flash فقط مع Cache قوي)
// ============================================================

let cachedExchangeRates: Record<string, { rate: number; timestamp: number }> = {};
const EXCHANGE_RATE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 دقيقة

async function fetchLatestExchangeRates(currencyCode: string): Promise<number | null> {
  const cached = cachedExchangeRates[currencyCode];
  if (cached && (Date.now() - cached.timestamp) < EXCHANGE_RATE_CACHE_TTL_MS) {
    console.log(`Using cached exchange rate for ${currencyCode}: ${cached.rate}`);
    return cached.rate;
  }
  
  return retryOnQuotaExceeded(async () => {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    const prompt = `
      Return ONLY valid JSON with current exchange rate for ${currencyCode} to USD.
      Use real current market rates.
      FORMAT: {"currency": "${currencyCode}", "rate_to_usd": number}
    `;
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const data = safeParseAIResponse<{ rate_to_usd: number }>(responseText);
    
    if (data.rate_to_usd && typeof data.rate_to_usd === 'number') {
      cachedExchangeRates[currencyCode] = {
        rate: data.rate_to_usd,
        timestamp: Date.now()
      };
      return data.rate_to_usd;
    }
    return null;
  }, "exchangeRate");
}

// ============================================================
// الأمان والتحقق
// ============================================================

function isValidBase64(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  
  const dangerousPatterns = ['../', '..\\', '\0', '%00', '<script', 'javascript:', 'onload=', 'onerror='];
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

function getAcceptLanguage(request: NextRequest): string {
  const acceptLang = request.headers.get("accept-language") || "";
  return acceptLang.includes("ar") ? "ar" : "en";
}

function sanitizeArabicText(text: string, maxLength: number = 500): string {
  if (!text || typeof text !== 'string') return "";
  return text.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').trim().slice(0, maxLength);
}

// ============================================================
// قاعدة بيانات العملات
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
  "BR": { code: "BRL", symbol: "R$", name: "Brazilian Real", nameAr: "ريال برازيلي", exchangeRateToUSD: 5.15, lastUpdated: new Date().toISOString() },
  "MX": { code: "MXN", symbol: "$", name: "Mexican Peso", nameAr: "بيزو مكسيكي", exchangeRateToUSD: 17.2, lastUpdated: new Date().toISOString() },
  "ZA": { code: "ZAR", symbol: "R", name: "South African Rand", nameAr: "راند جنوب أفريقي", exchangeRateToUSD: 18.7, lastUpdated: new Date().toISOString() },
};

function getGlobalContext(request: NextRequest) {
  const countryCode = request.headers.get("x-vercel-ip-country") || "SA";
  const userLangPref = getAcceptLanguage(request);
  
  const localeMap: Record<string, { name: string; currencyCode: string; lang: string; displayNameAr: string }> = {
    "SA": { name: "Saudi Arabia", currencyCode: "SAR", lang: "ar", displayNameAr: "المملكة العربية السعودية" },
    "EG": { name: "Egypt", currencyCode: "EGP", lang: "ar", displayNameAr: "مصر" },
    "AE": { name: "UAE", currencyCode: "AED", lang: "ar", displayNameAr: "الإمارات" },
    "US": { name: "United States", currencyCode: "USD", lang: "en", displayNameAr: "الولايات المتحدة" },
    "GB": { name: "United Kingdom", currencyCode: "GBP", lang: "en", displayNameAr: "المملكة المتحدة" },
    "TR": { name: "Turkey", currencyCode: "TRY", lang: "tr", displayNameAr: "تركيا" },
    "PK": { name: "Pakistan", currencyCode: "PKR", lang: "ur", displayNameAr: "باكستان" },
    "IN": { name: "India", currencyCode: "INR", lang: "hi", displayNameAr: "الهند" },
    "CN": { name: "China", currencyCode: "CNY", lang: "zh", displayNameAr: "الصين" },
    "JP": { name: "Japan", currencyCode: "JPY", lang: "ja", displayNameAr: "اليابان" },
    "KR": { name: "South Korea", currencyCode: "KRW", lang: "ko", displayNameAr: "كوريا" },
    "RU": { name: "Russia", currencyCode: "RUB", lang: "ru", displayNameAr: "روسيا" },
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
// البرومبت الاحترافي (باستخدام gemini-2.5-flash)
// ============================================================

function getProfessionalMasterPrompt(ctx: any, responseLang: string, currencyCode: string, currencySymbol: string): string {
  const systemLanguage = ctx.lang === "ar" ? "العربية" : "English";
  
  return `أنت "محرك الجرد البصري المتقدم الشامل" - "Universal Advanced Visual Inventory Engine"

المهمة: تحليل الصورة وإجراء جرد احترافي دقيق لجميع أصناف المخزون المرئية.

【نطاق الجرد】
1. التجزئة والمتاجر - الأطعمة، المشروبات، العلب، الأسعار، الباركود، تواريخ الصلاحية
2. الأدوات والمعدات - الأدوات الكهربائية واليدوية، المعدات الصناعية
3. الأثاث والديكور - الكراسي، الطاولات، الخزائن
4. الخدمات اللوجستية - الصناديق، الحاويات، المنصات
5. الطب والصيدليات - الأدوية، المعدات الطبية
6. الملابس والموضة - الملابس، الأحذية، الحقائب
7. الإلكترونيات - الهواتف، الأجهزة، الشاشات
8. أي مخزون آخر

【تعليمات】
1. اللغة: استخدم ${systemLanguage} لجميع المخرجات
2. العملة: استخدم ${currencyCode} (${currencySymbol}) للأسعار
3. لا تختلق منتجات غير موجودة (Zero Hallucination)
4. حلل كل جزء من الصورة بدقة

【المخرجات - JSON فقط】
{
  "business_type": "نوع النشاط",
  "analysis_quality": "excellent|good|fair|poor",
  "detected_items_count": 0,
  "products": [
    {
      "product_name": "الاسم",
      "brand": "الماركة أو null",
      "category": "التصنيف",
      "unit_price": null,
      "quantity": 1,
      "barcode_serial": null,
      "confidence": "high|medium|low",
      "notes": "ملاحظات"
    }
  ],
  "warnings": [],
  "suggestions": []
}

【قواعد ذهبية】
- أخرج JSON فقط
- استخدم ${systemLanguage} لجميع النصوص
- إذا كانت الصورة فارغة، أعد array فارغ مع analysis_quality: "poor"`;
}

// ============================================================
// POST Handler
// ============================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const ctx = getGlobalContext(request);
    const responseLang = ctx.preferredLang === "ar" ? "ar" : "en";
    const currencyCode = ctx.currency.code;
    const currencySymbol = ctx.currency.symbol;
    
    // تحديث سعر الصرف (مع cache)
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
    
    // تحليل الصورة باستخدام Gemini 2.5 Flash
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    });
    
    const masterPrompt = getProfessionalMasterPrompt(ctx, responseLang, currencyCode, currencySymbol);
    
    const result = await retryOnQuotaExceeded(async () => {
      return await model.generateContent([masterPrompt, { inlineData: { data: base64Data, mimeType } }]);
    }, "imageAnalysis");
    
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
      
      for (let i = 0; i < enrichedProducts.length; i++) {
        const product = enrichedProducts[i];
        const normalizedName = product.product_name.trim().toLowerCase();
        const normalizedBrand = product.brand?.trim().toLowerCase() || '';
        const uniqueKey = `${normalizedName}|${normalizedBrand}`;
        
        const priceInfo = priceResults.get(uniqueKey);
        if (priceInfo && priceInfo.price) {
          enrichedProducts[i] = {
            ...product,
            unit_price: priceInfo.price,
            price_confidence: priceInfo.confidence,
            price_source: priceInfo.source
          };
          marketPricesFetched = true;
        } else {
          enrichedProducts[i] = {
            ...product,
            unit_price: product.unit_price || null,
            price_confidence: "low",
            price_source: "unavailable"
          };
        }
      }
    }
    
    // حساب القيمة الإجمالية
    const totalEstimatedValue = enrichedProducts.reduce((sum, product) => {
      if (product.unit_price && product.quantity) {
        return sum + (product.unit_price * product.quantity);
      }
      return sum;
    }, 0);
    
    // تنقية البيانات
    const sanitizedProducts: ProductItem[] = enrichedProducts.map((product: any) => ({
      product_name: sanitizeArabicText(product.product_name || (responseLang === "ar" ? "منتج غير معروف" : "Unknown"), 500),
      brand: product.brand ? sanitizeArabicText(product.brand, 200) : null,
      category: sanitizeArabicText(product.category || (responseLang === "ar" ? "عام" : "General"), 200),
      unit_price: product.unit_price || null,
      quantity: (typeof product.quantity === 'number' && product.quantity > 0) ? Math.floor(product.quantity) : 1,
      barcode_serial: product.barcode_serial ? sanitizeArabicText(product.barcode_serial, 100) : null,
      confidence: ['high', 'medium', 'low'].includes(product.confidence) ? product.confidence as Confidence : 'medium',
      notes: sanitizeArabicText(product.notes || "", 1000)
    }));
    
    const totalDuration = Date.now() - startTime;
    
    const resultData: InventoryAnalysisResult = {
      business_type: sanitizeArabicText(parsedData.business_type || (responseLang === "ar" ? "مخزون عام" : "General_Inventory"), 100),
      analysis_quality: ['excellent', 'good', 'fair', 'poor'].includes(parsedData.analysis_quality) 
        ? parsedData.analysis_quality as "excellent" | "good" | "fair" | "poor"
        : "fair",
      detected_items_count: sanitizedProducts.length,
      products: sanitizedProducts,
      warnings: Array.isArray(parsedData.warnings) ? parsedData.warnings.slice(0, 10).map((w: string) => sanitizeArabicText(w, 500)) : [],
      suggestions: Array.isArray(parsedData.suggestions) ? parsedData.suggestions.slice(0, 5).map((s: string) => sanitizeArabicText(s, 500)) : [],
      detected_location: ctx.displayName,
      timestamp: new Date().toISOString()
    };
    
    return NextResponse.json({
      success: true,
      ...resultData,
      performance_metrics: {
        total_duration_ms: totalDuration,
        products_count: sanitizedProducts.length,
        prices_fetched: marketPricesFetched,
        unique_products_count: uniqueProductsCount,
        saved_api_calls: savedRequests,
        model_used: MODEL_NAME
      },
      currency_info: {
        code: currencyCode,
        symbol: currencySymbol,
        name: responseLang === "ar" ? ctx.currency.nameAr : ctx.currency.name,
        exchange_rate_to_usd: ctx.currency.exchangeRateToUSD,
        last_updated: ctx.currency.lastUpdated
      },
      total_estimated_value: totalEstimatedValue,
      total_estimated_value_formatted: `${currencySymbol}${totalEstimatedValue.toLocaleString(responseLang === "ar" ? "ar-EG" : "en-US")}`
    });
    
  } catch (error: any) {
    console.error("API Error:", error.message);
    
    // معالجة خاصة لخطأ 429
    if (error.status === 429) {
      return NextResponse.json({ 
        success: false, 
        error: "تم تجاوز حد الاستخدام المجاني للـ API. يرجى الانتظار دقيقة والمحاولة مرة أخرى، أو تفعيل الفوترة للحصول على حدود أعلى.",
        retry_after: 60
      }, { status: 429 });
    }
    
    return NextResponse.json({ success: false, error: "حدث خطأ غير متوقع" }, { status: 500 });
  }
}

// ============================================================
// GET Handler
// ============================================================

export async function GET(request: NextRequest) {
  const ctx = getGlobalContext(request);
  const isArabic = ctx.preferredLang === "ar";
  
  return NextResponse.json({
    status: "online",
    status_ar: "متصل",
    engine: "Universal Inventory Intelligence",
    engine_ar: "محرك الجرد الذكي الشامل",
    version: "2026.4.30-final-v9",
    model_used: MODEL_NAME,
    features: {
      auto_currency_detection: true,
      real_time_market_prices: true,
      arabic_language: true,
      product_deduplication: true,
      auto_retry_on_quota: true
    },
    current_currency: {
      code: ctx.currency.code,
      symbol: ctx.currency.symbol,
      name: isArabic ? ctx.currency.nameAr : ctx.currency.name
    },
    description: isArabic
      ? "نظام متقدم للجرد البصري باستخدام Gemini 2.5 Flash مع تحديد تلقائي للعملة وأسعار السوق"
      : "Advanced visual inventory system using Gemini 2.5 Flash with auto currency detection and market prices"
  });
}