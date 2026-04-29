// app/api/analyze/route.ts

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { InventoryAnalysisResult, ProductItem, Confidence } from "../../types";

// ============================================================
// الثوابت والإعدادات العامة
// ============================================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL_NAME = "gemini-2.5-flash"; // تحديث لاسم النموذج المستقر حالياً

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_CONCURRENT_PRICE_FETCHES = 3;
const BATCH_PRICE_FETCH_THRESHOLD = 8;

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 5000;

const SAFE_CONTEXT = {
  lang: "ar",
  currency: { 
    code: "SAR", 
    symbol: "﷼", 
    name: "Saudi Riyal", 
    nameAr: "ريال سعودي", 
    exchangeRateToUSD: 3.75, 
    lastUpdated: new Date().toISOString() 
  },
  displayName: "المملكة العربية السعودية",
  preferredLang: "ar",
  name: "Saudi Arabia",
  currencyCode: "SAR"
};

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
// تحسينات استخراج الـ JSON والبيانات
// ============================================================

function extractJSONFromText(text: string): string {
  if (!text || typeof text !== 'string') throw new Error("Invalid input text");
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
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) throw new Error("Invalid JSON extraction");
  return cleaned;
}

function safeParseAIResponse<T>(responseText: string): T {
  const jsonString = extractJSONFromText(responseText);
  return JSON.parse(jsonString);
}

// ============================================================
// معالجة تكرار المنتجات (Deduplication Logic)
// ============================================================

interface UniqueProduct {
  key: string;
  product_name: string;
  brand: string | null;
  category?: string;
  occurrences: number;
  originalIndices: number[];
}

function deduplicateProducts(products: Array<{ product_name: string; brand: string | null; category?: string }>) {
  const uniqueMap = new Map<string, UniqueProduct>();
  const distributionMap = new Map<number, string>();
  
  products.forEach((product, i) => {
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
  });
  
  return { uniqueProducts: Array.from(uniqueMap.values()), distributionMap };
}

// ============================================================
// خدمات جلب الأسعار والعملات
// ============================================================

async function fetchSingleProductPrice(productName: string, brand: string | null, currencyCode: string) {
  return retryOnQuotaExceeded(async () => {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const prompt = `Return ONLY valid JSON with current market price for ${productName} ${brand || ''} in ${currencyCode}. 
    FORMAT: {"price": number, "confidence": "high|medium|low", "source": "string"}`;
    const result = await model.generateContent(prompt);
    return safeParseAIResponse<any>(result.response.text());
  }, `price_${productName}`);
}

async function fetchBatchPricesUnique(uniqueProducts: UniqueProduct[], currencyCode: string) {
  return retryOnQuotaExceeded(async () => {
    const results = new Map<string, any>();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const productList = uniqueProducts.map((p, i) => `${i + 1}. ${p.product_name} (${p.brand || 'N/A'})`).join('\n');
    const prompt = `Return ONLY JSON array with prices for these products in ${currencyCode}:\n${productList}\n
    FORMAT: [{"product_key": "string", "price": number, "confidence": "high", "source": "market"}]`;
    
    const result = await model.generateContent(prompt);
    const data = safeParseAIResponse<any[]>(result.response.text());
    
    if (Array.isArray(data)) {
      data.forEach(item => results.set(item.product_key || uniqueProducts[0].key, item));
    }
    return results;
  }, "batchPrice");
}

async function fetchBatchMarketPricesOptimized(products: any[], currencyCode: string) {
  const { uniqueProducts } = deduplicateProducts(products);
  let priceResults;
  if (uniqueProducts.length > BATCH_PRICE_FETCH_THRESHOLD) {
    priceResults = await fetchBatchPricesUnique(uniqueProducts, currencyCode);
  } else {
    const promises = uniqueProducts.map(async p => {
      const res = await fetchSingleProductPrice(p.product_name, p.brand, currencyCode);
      return { key: p.key, ...res };
    });
    const resArray = await Promise.all(promises);
    priceResults = new Map(resArray.map(r => [r.key, r]));
  }
  return { results: priceResults, uniqueCount: uniqueProducts.length, saved: products.length - uniqueProducts.length };
}

// ============================================================
// نظام العملات (CURRENCY_DB)
// ============================================================

const CURRENCY_DB: Record<string, any> = {
  "SA": { code: "SAR", symbol: "﷼", nameAr: "ريال سعودي", exchangeRateToUSD: 3.75 },
  "EG": { code: "EGP", symbol: "E£", nameAr: "جنيه مصري", exchangeRateToUSD: 48.5 },
  "AE": { code: "AED", symbol: "د.إ", nameAr: "درهم إماراتي", exchangeRateToUSD: 3.67 },
  "US": { code: "USD", symbol: "$", nameAr: "دولار أمريكي", exchangeRateToUSD: 1 },
};

// ============================================================
// الحماية والمنطق الجذري لمنع خطأ headers()
// ============================================================

function extractStaticContext(headers: Headers) {
  const countryCode = headers.get("x-vercel-ip-country") || "SA";
  const acceptLang = headers.get("accept-language") || "";
  const lang = acceptLang.includes("ar") ? "ar" : "en";
  const currencyInfo = CURRENCY_DB[countryCode] || CURRENCY_DB["SA"];
  
  return {
    lang,
    currency: { ...currencyInfo, lastUpdated: new Date().toISOString() },
    displayName: lang === "ar" ? (CURRENCY_DB[countryCode]?.nameAr || "المملكة العربية السعودية") : "Saudi Arabia"
  };
}

function isValidBase64(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str) && str.length <= MAX_REQUEST_SIZE_BYTES;
}

function sanitizeArabicText(text: string, maxLength = 500): string {
  if (!text) return "";
  return text.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

// ============================================================
// POST Handler
// ============================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    // حل جذري: استخراج البيانات مباشرة من البارامتر الممرر
    const ctx = extractStaticContext(request.headers);
    
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "API Key Missing" }, { status: 500 });

    const body = await request.json();
    const { image, fetch_prices = true } = body;
    
    if (!image) return NextResponse.json({ error: "No Image" }, { status: 400 });

    let base64Data = image.includes(",") ? image.split(",")[1] : image;
    let mimeType = image.includes(",") ? image.split(",")[0].split(":")[1].split(";")[0] : "image/jpeg";

    if (!isValidBase64(base64Data)) return NextResponse.json({ error: "Invalid Image" }, { status: 400 });

    const model = genAI.getGenerativeModel({ model: MODEL_NAME, generationConfig: { responseMimeType: "application/json" } });
    
    const masterPrompt = `Analyze inventory. Output JSON ONLY. Language: ${ctx.lang === 'ar' ? 'Arabic' : 'English'}. Currency: ${ctx.currency.code}`;

    const aiResult = await retryOnQuotaExceeded(() => model.generateContent([masterPrompt, { inlineData: { data: base64Data, mimeType } }]), "analysis");
    const parsedData = safeParseAIResponse<any>(aiResult.response.text());

    let enrichedProducts = parsedData.products || [];
    let savedCalls = 0;
    let uniqueCount = 0;

    if (fetch_prices && enrichedProducts.length > 0) {
      const { results: priceMap, saved, uniqueCount: uc } = await fetchBatchMarketPricesOptimized(enrichedProducts, ctx.currency.code);
      savedCalls = saved;
      uniqueCount = uc;
      
      enrichedProducts = enrichedProducts.map((p: any) => {
        const pKey = `${p.product_name.trim().toLowerCase()}|${(p.brand || '').trim().toLowerCase()}`;
        const priceInfo = priceMap.get(pKey);
        return { ...p, unit_price: priceInfo?.price || null, price_source: priceInfo?.source || "ai_estimate" };
      });
    }

    const totalValue = enrichedProducts.reduce((sum: number, p: any) => sum + ((p.unit_price || 0) * (p.quantity || 1)), 0);

    return NextResponse.json({
      success: true,
      ...parsedData,
      products: enrichedProducts,
      total_estimated_value: totalValue,
      currency_info: ctx.currency,
      performance_metrics: {
        total_duration_ms: Date.now() - startTime,
        saved_api_calls: savedCalls,
        unique_products_count: uniqueCount
      }
    });

  } catch (error: any) {
    console.error("Critical API Error:", error.message);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}

// ============================================================
// GET Handler
// ============================================================

export async function GET(request: NextRequest) {
  const ctx = extractStaticContext(request.headers);
  return NextResponse.json({
    status: "online",
    version: "2026.4.30-bulletproof-v11",
    currency: ctx.currency,
    engine: "Universal Inventory Intelligence"
  });
}