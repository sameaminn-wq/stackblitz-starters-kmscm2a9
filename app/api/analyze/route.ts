import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { InventoryAnalysisResult, ProductItem } from "../types";

// 1. إعداد محرك الذكاء الاصطناعي العالمي (Enterprise Configuration)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// الحدود الأمنية
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_CONCURRENT_PRICE_FETCHES = 5; // الحد الأقصى للطلبات المتوازية
const BATCH_PRICE_FETCH_THRESHOLD = 10; // إذا كان عدد المنتجات > 10، استخدم الدمج بدلاً من الطلبات الفردية

// ============================================================
// تحسين isValidBase64 - حماية أكثر صرامة
// ============================================================

function isValidBase64(str: string): boolean {
  // 1. منع الهجمات الأساسية
  if (!str || typeof str !== 'string') return false;
  
  // 2. منع path traversal attacks
  const dangerousPatterns = ['../', '..\\', '\0', '%00', '\x00', '\\x00', '--', '/*', '*/', '<!--', '-->'];
  for (const pattern of dangerousPatterns) {
    if (str.includes(pattern)) return false;
  }
  
  // 3. التحقق من أن السلسلة لا تحتوي على أحرف غير مسموحة في Base64
  // Base64 الصالح يحتوي فقط على: A-Z, a-z, 0-9, +, /, =
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  
  // 4. التحقق من طول مناسب (أقل من 10MB مشفر)
  if (str.length > MAX_REQUEST_SIZE_BYTES) return false;
  
  // 5. التأكد من عدم وجود HTML أو JavaScript tags
  const htmlPattern = /<[^>]*>|javascript:|on\w+=|eval\(|document\.|window\.|alert\(/gi;
  if (htmlPattern.test(str)) return false;
  
  // 6. محاولة فك التشفير للتحقق من الصلاحية
  try {
    const buffer = Buffer.from(str, 'base64');
    // التأكد من أن النتيجة الناتجة لا تحتوي على أنماط خطيرة
    const decodedString = buffer.toString('utf8', 0, Math.min(buffer.length, 1000));
    const dangerousInDecoded = /<script|<\/script|javascript:|onload=|onerror=|eval\(/gi;
    if (dangerousInDecoded.test(decodedString)) return false;
  } catch {
    return false;
  }
  
  return base64Regex.test(str);
}

// ============================================================
// تحسين جلب الأسعار - حل مشكلة الحلقات المفرغة
// ============================================================

interface PriceFetchResult {
  productName: string;
  brand: string | null;
  price: number | null;
  confidence: string;
  source: string;
}

/**
 * جلب أسعار متعددة بشكل متوازي مع التحكم في التزامن
 */
async function fetchBatchMarketPrices(
  products: Array<{ product_name: string; brand: string | null; category?: string }>,
  currencyCode: string
): Promise<Map<string, PriceFetchResult>> {
  const results = new Map<string, PriceFetchResult>();
  
  if (products.length === 0) return results;
  
  // استراتيجية 1: إذا كان عدد المنتجات كبير، استخدم طلب واحد مجمع
  if (products.length > BATCH_PRICE_FETCH_THRESHOLD) {
    console.log(`Using batch fetch for ${products.length} products`);
    const batchResult = await fetchBatchPricesFromGemini(products, currencyCode);
    for (const item of batchResult) {
      results.set(item.productName, item);
    }
    return results;
  }
  
  // استراتيجية 2: طلبات متوازية مع حد أقصى للعدد
  console.log(`Using parallel fetch with concurrency ${MAX_CONCURRENT_PRICE_FETCHES} for ${products.length} products`);
  
  const chunks = [];
  for (let i = 0; i < products.length; i += MAX_CONCURRENT_PRICE_FETCHES) {
    chunks.push(products.slice(i, i + MAX_CONCURRENT_PRICE_FETCHES));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(product => 
      fetchSingleMarketPrice(product.product_name, product.brand, currencyCode)
        .then(priceInfo => ({
          productName: product.product_name,
          brand: product.brand,
          ...priceInfo
        }))
        .catch(error => {
          console.error(`Failed to fetch price for ${product.product_name}:`, error);
          return {
            productName: product.product_name,
            brand: product.brand,
            price: null,
            confidence: "low",
            source: "error"
          };
        })
    );
    
    const chunkResults = await Promise.all(promises);
    for (const result of chunkResults) {
      results.set(result.productName, result);
    }
  }
  
  return results;
}

/**
 * جلب سعر منتج واحد من Gemini
 */
async function fetchSingleMarketPrice(
  productName: string,
  brand: string | null,
  currencyCode: string
): Promise<{ price: number | null; confidence: string; source: string }> {
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
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const data = JSON.parse(cleanJson);
    
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
 * جلب جميع الأسعار في طلب واحد مجمع (للمنتجات الكثيرة)
 */
async function fetchBatchPricesFromGemini(
  products: Array<{ product_name: string; brand: string | null }>,
  currencyCode: string
): Promise<PriceFetchResult[]> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const productList = products.map((p, i) => `${i + 1}. ${p.product_name}${p.brand ? ` (${p.brand})` : ''}`).join('\n');
    
    const prompt = `
      You are a market price API. Return ONLY valid JSON array with current market prices for these products in ${currencyCode}.
      
      Products:
      ${productList}
      
      FORMAT: 
      [
        {"product_name": "exact product name", "price": number, "confidence": "high|medium|low", "source": "string"},
        ...
      ]
      
      RULES:
      - Use real market prices when possible
      - For unknown products, set price = null
      - Be realistic and accurate
      - Return array with same number of items as input
    `;
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const data = JSON.parse(cleanJson);
    
    if (Array.isArray(data)) {
      return data.map(item => ({
        productName: item.product_name,
        brand: null,
        price: item.price,
        confidence: item.confidence || "medium",
        source: item.source || "batch_estimate"
      }));
    }
    
    return [];
  } catch (error) {
    console.error("Batch price fetch failed:", error);
    return [];
  }
}

/**
 * جلب أحدث أسعار الصرف باستخدام Gemini AI (مع caching)
 */
let cachedExchangeRates: Record<string, number> = {};
let lastExchangeRateUpdate: Date | null = null;
const EXCHANGE_RATE_CACHE_TTL_MS = 60 * 60 * 1000; // ساعة واحدة

async function fetchLatestExchangeRates(currencyCode: string): Promise<number | null> {
  // التحقق من cache
  if (lastExchangeRateUpdate && (Date.now() - lastExchangeRateUpdate.getTime()) < EXCHANGE_RATE_CACHE_TTL_MS) {
    return cachedExchangeRates[currencyCode] || null;
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `
      Return ONLY valid JSON with current exchange rate for ${currencyCode} to USD.
      Use real current market rates.
      FORMAT: {"currency": "${currencyCode}", "rate_to_usd": number}
    `;
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const data = JSON.parse(cleanJson);
    
    if (data.rate_to_usd && typeof data.rate_to_usd === 'number') {
      cachedExchangeRates[currencyCode] = data.rate_to_usd;
      lastExchangeRateUpdate = new Date();
      return data.rate_to_usd;
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch exchange rates from Gemini:", error);
    return null;
  }
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
  // ... باقي العملات بنفس الشكل
};

// ============================================================
// دوال المساعدة
// ============================================================

function getAcceptLanguage(request: NextRequest): string {
  const acceptLang = request.headers.get("accept-language") || "";
  if (acceptLang.includes("ar") || acceptLang.includes("arabic")) {
    return "ar";
  }
  return "en";
}

function sanitizeArabicText(text: string, maxLength: number = 500): string {
  if (!text || typeof text !== 'string') return "";
  const cleaned = text
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
  return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
}

function getGlobalContext(request: NextRequest) {
  const countryCode = request.headers.get("x-vercel-ip-country") || "SA";
  const userLangPref = getAcceptLanguage(request);
  
  const localeMap: Record<string, { name: string; currencyCode: string; lang: string; displayNameAr: string }> = {
    "SA": { name: "Saudi Arabia", currencyCode: "SAR", lang: "ar", displayNameAr: "المملكة العربية السعودية" },
    "EG": { name: "Egypt", currencyCode: "EGP", lang: "ar", displayNameAr: "مصر" },
    "AE": { name: "UAE", currencyCode: "AED", lang: "ar", displayNameAr: "الإمارات العربية المتحدة" },
    "US": { name: "United States", currencyCode: "USD", lang: "en", displayNameAr: "الولايات المتحدة" },
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
// POST Handler - النسخة المحسنة
// ============================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const timeoutId = setTimeout(() => {}, REQUEST_TIMEOUT_MS);
  
  try {
    const ctx = getGlobalContext(request);
    const responseLang = ctx.preferredLang === "ar" ? "ar" : "en";
    const currencyCode = ctx.currency.code;
    const currencySymbol = ctx.currency.symbol;
    
    // تحديث سعر الصرف إذا لزم الأمر
    const freshRate = await fetchLatestExchangeRates(currencyCode);
    if (freshRate) {
      ctx.currency.exchangeRateToUSD = freshRate;
      ctx.currency.lastUpdated = new Date().toISOString();
    }
    
    // ... التحقق من الصورة والمعالجة الأولية (نفس الكود السابق) ...
    
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
    
    // معالجة الصورة واستخراج base64
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
    
    // تحليل الصورة باستخدام Gemini
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    });
    
    const masterPrompt = `
      Analyze this inventory image. Return JSON with products detected.
      Currency: ${currencyCode} (${currencySymbol})
      Language: ${responseLang === "ar" ? "Arabic" : "English"}
      
      Output format:
      {
        "products": [
          {
            "product_name": "string",
            "brand": "string or null", 
            "category": "string",
            "quantity": number,
            "confidence": "high|medium|low",
            "notes": "string"
          }
        ],
        "business_type": "string",
        "analysis_quality": "excellent|good|fair|poor"
      }
    `;
    
    let result;
    try {
      result = await Promise.race([
        model.generateContent([masterPrompt, { inlineData: { data: base64Data, mimeType } }]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), REQUEST_TIMEOUT_MS))
      ]);
    } catch (apiError) {
      return NextResponse.json({ success: false, error: "فشل تحليل الصورة" }, { status: 503 });
    }
    
    const responseText = result.response.text();
    let parsedData;
    try {
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      parsedData = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json({ success: false, error: "خطأ في تنسيق البيانات" }, { status: 500 });
    }
    
    if (!parsedData.products || !Array.isArray(parsedData.products)) {
      parsedData.products = [];
    }
    
    // ============================================================
    // الجزء المحسن: جلب الأسعار بدون حلقات مفرغة
    // ============================================================
    
    let enrichedProducts = [...parsedData.products];
    let marketPricesFetched = false;
    
    if (fetch_prices && enrichedProducts.length > 0) {
      const priceFetchStart = Date.now();
      console.log(`Fetching prices for ${enrichedProducts.length} products...`);
      
      // استخدام الدالة المحسنة للجلب المتوازي/المجمع
      const priceResults = await fetchBatchMarketPrices(
        enrichedProducts.map(p => ({ product_name: p.product_name, brand: p.brand, category: p.category })),
        currencyCode
      );
      
      // تطبيق الأسعار المسترجعة
      for (let i = 0; i < enrichedProducts.length; i++) {
        const product = enrichedProducts[i];
        const priceInfo = priceResults.get(product.product_name);
        
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
            current_market_price: null,
            price_currency: currencyCode,
            price_confidence: "low",
            price_source: "unavailable"
          };
        }
      }
      
      const priceFetchDuration = Date.now() - priceFetchStart;
      console.log(`Price fetching completed in ${priceFetchDuration}ms for ${enrichedProducts.length} products`);
    }
    
    // حساب القيمة الإجمالية
    const totalEstimatedValue = enrichedProducts.reduce((sum, product) => {
      if (product.current_market_price && product.quantity) {
        return sum + (product.current_market_price * product.quantity);
      }
      return sum;
    }, 0);
    
    // تنقية البيانات النهائية
    const sanitizedProducts = enrichedProducts.map((product: any) => ({
      product_name: sanitizeArabicText(product.product_name || "Unknown", 500),
      brand: product.brand ? sanitizeArabicText(product.brand, 200) : null,
      category: sanitizeArabicText(product.category || "General", 200),
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
        batch_strategy_used: sanitizedProducts.length > BATCH_PRICE_FETCH_THRESHOLD ? "batch" : "parallel"
      },
      business_type: sanitizeArabicText(parsedData.business_type || "General_Inventory", 100),
      analysis_quality: parsedData.analysis_quality || "fair",
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
      detected_location: ctx.displayName,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error("API Error:", error.message);
    return NextResponse.json({ 
      success: false, 
      error: "حدث خطأ غير متوقع"
    }, { status: 500 });
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
  
  return NextResponse.json({
    status: "online",
    engine: "Universal Inventory Intelligence with Optimized Pricing",
    version: "2026.4.30-optimized-v7",
    performance_features: {
      parallel_price_fetching: true,
      batch_price_fetching: true,
      max_concurrent_requests: MAX_CONCURRENT_PRICE_FETCHES,
      batch_threshold: BATCH_PRICE_FETCH_THRESHOLD,
      exchange_rate_caching: true
    },
    current_currency: {
      code: ctx.currency.code,
      symbol: ctx.currency.symbol,
      name: isArabic ? ctx.currency.nameAr : ctx.currency.name
    }
  });
}