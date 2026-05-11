// app/api/analyze/route.ts
// ╔══════════════════════════════════════════════════════════════╗
// ║  Universal Inventory Intelligence Engine — v5.0              ║
// ║  Gemini 2.5 Flash · All Image Formats · Arabic-first         ║
// ║  Supports: JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC, AVIF       ║
// ╚══════════════════════════════════════════════════════════════╝

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from 'sharp'; // أضف: npm install sharp
import type { ProductItem, Confidence } from "../../../types"; 
// تذكر: 3 مرات ../ لكي تخرج من (analyze ثم api ثم app) وتصل للجذر

// ──────────────────────────────────────────────────────────────
// 1. CONFIGURATION
// ──────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const MODEL_NAME = "gemini-2.5-flash";

const MAX_IMAGE_SIZE_MB   = 10; // زيادة إلى 10MB لدعم الصور الأكبر
const MAX_IMAGE_BYTES     = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_BODY_BYTES      = 15 * 1024 * 1024;

// دعم جميع أنواع الصور
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/gif", "image/bmp", "image/tiff", "image/tif",
  "image/svg+xml", "image/heic", "image/heif", "image/avif"
]);

// الصيغ التي تحتاج تحويل
const FORMATS_NEEDING_CONVERSION = new Set([
  "image/heic", "image/heif", "image/bmp", "image/tiff", "image/avif"
]);

const MAX_RETRIES          = 4;
const BASE_RETRY_DELAY_MS  = 3000;
const BATCH_PRICE_THRESHOLD = 6;
const MAX_PARALLEL_CHUNKS   = 3;
const CACHE_TTL           = 24 * 60 * 60 * 1000; // 24 ساعة

// ──────────────────────────────────────────────────────────────
// 2. TYPES
// ──────────────────────────────────────────────────────────────

interface CurrencyInfo {
  code:              string;
  symbol:            string;
  nameEn:            string;
  nameAr:            string;
  exchangeRateToUSD: number;
}

interface GeoContext {
  countryCode:   string;
  countryNameAr: string;
  countryNameEn: string;
  currency:      CurrencyInfo;
  lang:          "ar" | "en";
}

interface PriceInfo {
  price:      number | null;
  confidence: "high" | "medium" | "low";
  source:     string;
}

interface UniqueProductEntry {
  key:            string;
  product_name:   string;
  brand:          string | null;
  category?:      string;
  occurrences:    number;
  originalIndices: number[];
}

interface PriceCacheEntry {
  price: PriceInfo;
  timestamp: number;
  expiresAt: number;
}

// ──────────────────────────────────────────────────────────────
// 3. GEO + CURRENCY DATABASE (30+ عملة)
// ──────────────────────────────────────────────────────────────

const CURRENCY_DB: Record<string, CurrencyInfo> = {
  SA: { code: "SAR", symbol: "﷼",  nameEn: "Saudi Riyal",         nameAr: "ريال سعودي",            exchangeRateToUSD: 3.75  },
  EG: { code: "EGP", symbol: "E£", nameEn: "Egyptian Pound",       nameAr: "جنيه مصري",             exchangeRateToUSD: 48.5  },
  AE: { code: "AED", symbol: "د.إ",nameEn: "UAE Dirham",           nameAr: "درهم إماراتي",          exchangeRateToUSD: 3.67  },
  KW: { code: "KWD", symbol: "د.ك",nameEn: "Kuwaiti Dinar",        nameAr: "دينار كويتي",           exchangeRateToUSD: 0.307 },
  QA: { code: "QAR", symbol: "ر.ق",nameEn: "Qatari Riyal",         nameAr: "ريال قطري",             exchangeRateToUSD: 3.64  },
  BH: { code: "BHD", symbol: "BD", nameEn: "Bahraini Dinar",       nameAr: "دينار بحريني",          exchangeRateToUSD: 0.376 },
  OM: { code: "OMR", symbol: "ر.ع",nameEn: "Omani Rial",           nameAr: "ريال عُماني",           exchangeRateToUSD: 0.385 },
  JO: { code: "JOD", symbol: "JD", nameEn: "Jordanian Dinar",      nameAr: "دينار أردني",           exchangeRateToUSD: 0.709 },
  LB: { code: "LBP", symbol: "ل.ل",nameEn: "Lebanese Pound",       nameAr: "ليرة لبنانية",          exchangeRateToUSD: 89500 },
  MA: { code: "MAD", symbol: "د.م",nameEn: "Moroccan Dirham",      nameAr: "درهم مغربي",            exchangeRateToUSD: 10.0  },
  DZ: { code: "DZD", symbol: "DA", nameEn: "Algerian Dinar",       nameAr: "دينار جزائري",          exchangeRateToUSD: 134   },
  TN: { code: "TND", symbol: "DT", nameEn: "Tunisian Dinar",       nameAr: "دينار تونسي",           exchangeRateToUSD: 3.12  },
  US: { code: "USD", symbol: "$",  nameEn: "US Dollar",            nameAr: "دولار أمريكي",          exchangeRateToUSD: 1     },
  GB: { code: "GBP", symbol: "£",  nameEn: "British Pound",        nameAr: "جنيه إسترليني",         exchangeRateToUSD: 1.27  },
  TR: { code: "TRY", symbol: "₺",  nameEn: "Turkish Lira",         nameAr: "ليرة تركية",            exchangeRateToUSD: 32.5  },
  IN: { code: "INR", symbol: "₹",  nameEn: "Indian Rupee",         nameAr: "روبية هندية",           exchangeRateToUSD: 83.5  },
  PK: { code: "PKR", symbol: "₨",  nameEn: "Pakistani Rupee",      nameAr: "روبية باكستانية",        exchangeRateToUSD: 278   },
  CN: { code: "CNY", symbol: "¥",  nameEn: "Chinese Yuan",         nameAr: "يوان صيني",             exchangeRateToUSD: 7.25  },
  DE: { code: "EUR", symbol: "€",  nameEn: "Euro",                 nameAr: "يورو",                  exchangeRateToUSD: 1.09  },
  FR: { code: "EUR", symbol: "€",  nameEn: "Euro",                 nameAr: "يورو",                  exchangeRateToUSD: 1.09  },
  JP: { code: "JPY", symbol: "¥",  nameEn: "Japanese Yen",         nameAr: "ين ياباني",             exchangeRateToUSD: 154   },
  KR: { code: "KRW", symbol: "₩",  nameEn: "South Korean Won",     nameAr: "وون كوري",              exchangeRateToUSD: 1370  },
  RU: { code: "RUB", symbol: "₽",  nameEn: "Russian Ruble",        nameAr: "روبل روسي",             exchangeRateToUSD: 92    },
  CA: { code: "CAD", symbol: "$",  nameEn: "Canadian Dollar",      nameAr: "دولار كندي",            exchangeRateToUSD: 1.37  },
  AU: { code: "AUD", symbol: "$",  nameEn: "Australian Dollar",    nameAr: "دولار أسترالي",         exchangeRateToUSD: 0.66  },
  BR: { code: "BRL", symbol: "R$", nameEn: "Brazilian Real",       nameAr: "ريال برازيلي",          exchangeRateToUSD: 5.15  },
  MX: { code: "MXN", symbol: "$",  nameEn: "Mexican Peso",         nameAr: "بيزو مكسيكي",           exchangeRateToUSD: 17.2  },
  ZA: { code: "ZAR", symbol: "R",  nameEn: "South African Rand",   nameAr: "راند جنوب أفريقي",      exchangeRateToUSD: 18.7  },
  NG: { code: "NGN", symbol: "₦",  nameEn: "Nigerian Naira",       nameAr: "نايرا نيجيري",          exchangeRateToUSD: 1480  },
  MY: { code: "MYR", symbol: "RM", nameEn: "Malaysian Ringgit",    nameAr: "رينغيت ماليزي",         exchangeRateToUSD: 4.73  },
  ID: { code: "IDR", symbol: "Rp", nameEn: "Indonesian Rupiah",    nameAr: "روبية إندونيسية",       exchangeRateToUSD: 16000 },
};

const COUNTRY_NAMES: Record<string, { ar: string; en: string; lang: "ar" | "en" }> = {
  SA: { ar: "المملكة العربية السعودية", en: "Saudi Arabia",   lang: "ar" },
  EG: { ar: "مصر",                      en: "Egypt",           lang: "ar" },
  AE: { ar: "الإمارات العربية المتحدة", en: "UAE",             lang: "ar" },
  KW: { ar: "الكويت",                   en: "Kuwait",          lang: "ar" },
  QA: { ar: "قطر",                      en: "Qatar",           lang: "ar" },
  BH: { ar: "البحرين",                  en: "Bahrain",         lang: "ar" },
  OM: { ar: "سلطنة عُمان",              en: "Oman",            lang: "ar" },
  JO: { ar: "الأردن",                   en: "Jordan",          lang: "ar" },
  LB: { ar: "لبنان",                    en: "Lebanon",         lang: "ar" },
  MA: { ar: "المغرب",                   en: "Morocco",         lang: "ar" },
  DZ: { ar: "الجزائر",                  en: "Algeria",         lang: "ar" },
  TN: { ar: "تونس",                     en: "Tunisia",         lang: "ar" },
  US: { ar: "الولايات المتحدة",         en: "United States",   lang: "en" },
  GB: { ar: "المملكة المتحدة",          en: "United Kingdom",  lang: "en" },
  TR: { ar: "تركيا",                    en: "Turkey",          lang: "ar" },
  IN: { ar: "الهند",                    en: "India",           lang: "en" },
  PK: { ar: "باكستان",                  en: "Pakistan",        lang: "ar" },
  CN: { ar: "الصين",                    en: "China",           lang: "en" },
  DE: { ar: "ألمانيا",                  en: "Germany",         lang: "en" },
  FR: { ar: "فرنسا",                    en: "France",          lang: "en" },
};

const DEFAULT_COUNTRY = "EG";

// ──────────────────────────────────────────────────────────────
// 4. PRICE CACHE (NEW)
// ──────────────────────────────────────────────────────────────

const priceCache = new Map<string, PriceCacheEntry>();

async function getCachedPrice(productKey: string, currencyCode: string): Promise<PriceInfo | null> {
  const cacheKey = `${productKey}|${currencyCode}`;
  const cached = priceCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[CACHE] Hit for ${productKey} in ${currencyCode}`);
    return cached.price;
  }
  
  if (cached) {
    priceCache.delete(cacheKey);
  }
  
  return null;
}

async function cachePrice(productKey: string, currencyCode: string, price: PriceInfo) {
  const cacheKey = `${productKey}|${currencyCode}`;
  priceCache.set(cacheKey, {
    price,
    timestamp: Date.now(),
    expiresAt: Date.now() + CACHE_TTL
  });
  console.log(`[CACHE] Stored ${productKey} in ${currencyCode}`);
}

// ──────────────────────────────────────────────────────────────
// 5. CONTEXT RESOLUTION
// ──────────────────────────────────────────────────────────────

async function resolveGeoContext(request: NextRequest, bodyCountry?: string): Promise<GeoContext> {
  let countryCode = DEFAULT_COUNTRY;
  
  try {
    const vercelCountry = request.headers.get("x-vercel-ip-country");
    const cfCountry = request.headers.get("cf-ipcountry");
    countryCode = (bodyCountry ?? vercelCountry ?? cfCountry ?? DEFAULT_COUNTRY).toUpperCase();
  } catch (error) {
    console.warn("Could not get country from headers, using default");
  }

  const names    = COUNTRY_NAMES[countryCode]    ?? COUNTRY_NAMES[DEFAULT_COUNTRY];
  const currency = CURRENCY_DB[countryCode]      ?? CURRENCY_DB[DEFAULT_COUNTRY];
  const lang     = names.lang;

  return {
    countryCode,
    countryNameAr: names.ar,
    countryNameEn: names.en,
    currency,
    lang,
  };
}

// ──────────────────────────────────────────────────────────────
// 6. SECURITY HELPERS
// ──────────────────────────────────────────────────────────────

function validateBase64(str: string): boolean {
  if (!str || str.length > MAX_BODY_BYTES) return false;

  const FORBIDDEN = ["../", "..\\", "\0", "%00", "<script", "javascript:", "data:text/html"];
  const lower = str.slice(0, 200).toLowerCase();
  for (const pattern of FORBIDDEN) {
    if (lower.includes(pattern)) return false;
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return false;

  try {
    Buffer.from(str, "base64");
    return true;
  } catch {
    return false;
  }
}

function sanitize(text: unknown, maxLen = 500): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .trim()
    .slice(0, maxLen);
}

// ──────────────────────────────────────────────────────────────
// 7. TIMEOUT UTILITY (FIXED)
// ──────────────────────────────────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  // 1. تعريف المتغير بقيمة مبدئية لتجنب خطأ الـ Build
  let timeoutId: NodeJS.Timeout | undefined = undefined;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // 2. لا نمسح الـ timeout إلا إذا كان موجوداً فعلياً
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
// ──────────────────────────────────────────────────────────────
// 8. RETRY WITH EXPONENTIAL BACK-OFF
// ──────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempt = 0
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const isRateLimit =
      err?.status === 429 ||
      /quota|rate.?limit|resource.?exhausted/i.test(err?.message ?? "");

    if (isRateLimit && attempt < MAX_RETRIES) {
      const base  = BASE_RETRY_DELAY_MS * 2 ** attempt;
      const jitter = base * 0.2 * (Math.random() - 0.5) * 2;
      const delay  = Math.round(base + jitter);

      console.warn(`[RETRY] ${label} — attempt ${attempt + 1}/${MAX_RETRIES}, waiting ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      return withRetry(fn, label, attempt + 1);
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// 9. IMAGE CONVERSION & OPTIMIZATION (NEW - يدعم جميع الصيغ)
// ──────────────────────────────────────────────────────────────

async function convertAndOptimizeImage(
  base64: string, 
  mimeType: string,
  maxWidth: number = 1024,
  maxHeight: number = 1024
): Promise<{ base64: string; mimeType: string; originalSize: number; optimizedSize: number }> {
  
  let buffer = Buffer.from(base64, 'base64');
  const originalSize = buffer.length;
  
  // التحقق مما إذا كانت الصيغة تحتاج تحويل
  const needsConversion = FORMATS_NEEDING_CONVERSION.has(mimeType);
  let outputFormat: 'jpeg' | 'png' = 'jpeg';
  
  if (needsConversion || mimeType === 'image/gif') {
    outputFormat = 'jpeg';
  } else if (mimeType.includes('png')) {
    outputFormat = 'png';
  } else {
    outputFormat = 'jpeg';
  }
  
  try {
    let sharpInstance = sharp(buffer);
    
    // تغيير الحجم إذا كان كبيراً
    const metadata = await sharpInstance.metadata();
    if (metadata.width && metadata.height) {
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        sharpInstance = sharpInstance.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }
    }
    
    // تحويل وتحسين الجودة
    let optimizedBuffer: Buffer;
    let finalMimeType: string;
    
    switch (outputFormat) {
      case 'png':
        optimizedBuffer = await sharpInstance.png({ quality: 85, compressionLevel: 9 }).toBuffer();
        finalMimeType = 'image/png';
        break;
      case 'jpeg':
      default:
        optimizedBuffer = await sharpInstance.jpeg({ quality: 85, progressive: true }).toBuffer();
        finalMimeType = 'image/jpeg';
        break;
    }
    
    const optimizedSize = optimizedBuffer.length;
    
    console.log(`[IMAGE] Converted ${mimeType} → ${finalMimeType}, ${(originalSize/1024).toFixed(1)}KB → ${(optimizedSize/1024).toFixed(1)}KB`);
    
    return {
      base64: optimizedBuffer.toString('base64'),
      mimeType: finalMimeType,
      originalSize,
      optimizedSize
    };
  } catch (error) {
    console.error(`[IMAGE] Failed to process ${mimeType}:`, error);
    throw new Error(`Unsupported or corrupted image format: ${mimeType}`);
  }
}

// ──────────────────────────────────────────────────────────────
// 10. IMPROVED JSON EXTRACTION
// ──────────────────────────────────────────────────────────────

function extractJSON<T>(raw: string): T {
  if (!raw || typeof raw !== 'string') {
    throw new Error("Empty or invalid AI response");
  }
  
  // تنظيف الاستجابة
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .trim();
  
  // البحث عن أول { أو [
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  
  let start = -1;
  let end = -1;
  
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    let braceCount = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') braceCount++;
      if (text[i] === '}') braceCount--;
      if (braceCount === 0) {
        end = i;
        break;
      }
    }
  } else if (arrStart !== -1) {
    start = arrStart;
    let bracketCount = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') bracketCount++;
      if (text[i] === ']') bracketCount--;
      if (bracketCount === 0) {
        end = i;
        break;
      }
    }
  }
  
  if (start === -1 || end === -1) {
    throw new Error("No valid JSON structure found");
  }
  
  text = text.slice(start, end + 1);
  
  try {
    return JSON.parse(text);
  } catch (firstError) {
    // محاولة إصلاح الأخطاء الشائعة
    const fixed = text
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
      .replace(/:\s*'([^']*)'/g, ':"$1"')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
    
    try {
      return JSON.parse(fixed);
    } catch (secondError) {
      console.error("[JSON] Failed to parse:", text.substring(0, 200));
      throw new Error(`Invalid JSON format: ${firstError.message}`);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 11. PRODUCT DEDUPLICATION
// ──────────────────────────────────────────────────────────────

function deduplicateForPricing(
  products: Array<{ product_name: string; brand: string | null; category?: string }>
): { unique: UniqueProductEntry[]; indexToKey: Map<number, string> } {
  const map          = new Map<string, UniqueProductEntry>();
  const indexToKey   = new Map<number, string>();

  for (let i = 0; i < products.length; i++) {
    const p   = products[i];
    const key = `${p.product_name.trim().toLowerCase()}|${(p.brand ?? "").trim().toLowerCase()}`;

    indexToKey.set(i, key);

    if (map.has(key)) {
      const entry = map.get(key)!;
      entry.occurrences++;
      entry.originalIndices.push(i);
    } else {
      map.set(key, {
        key,
        product_name:    p.product_name,
        brand:           p.brand,
        category:        p.category,
        occurrences:     1,
        originalIndices: [i],
      });
    }
  }

  return { unique: Array.from(map.values()), indexToKey };
}

// ──────────────────────────────────────────────────────────────
// 12. PRICE FETCHING WITH CACHE
// ──────────────────────────────────────────────────────────────

async function fetchPricesBatchWithCache(
  unique: UniqueProductEntry[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();
  const toFetch: UniqueProductEntry[] = [];
  
  // التحقق من cache أولاً
  for (const entry of unique) {
    const cached = await getCachedPrice(entry.key, currencyCode);
    if (cached) {
      results.set(entry.key, cached);
    } else {
      toFetch.push(entry);
    }
  }
  
  if (toFetch.length === 0) {
    return results;
  }
  
  const productList = toFetch
    .map((p, i) => `${i + 1}. ${p.product_name}${p.brand ? ` (${p.brand})` : ""}`)
    .join("\n");

  const prompt = `You are a market pricing assistant. Return ONLY a JSON array with no extra text.
Given these products, estimate their current retail price in ${currencyCode}.

Products:
${productList}

Return exactly ${toFetch.length} objects in this format:
[{"idx": 1, "price": <number or null>, "confidence": "high|medium|low", "source": "<store or method>"}]

Rules:
- price must be a number (no currency symbols)
- if you cannot estimate, set price to null
- confidence reflects how certain you are`;

  const model  = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await withRetry(
    () => model.generateContent(prompt),
    "batch-prices"
  );

  try {
    const data = extractJSON<Array<{ idx: number; price: number | null; confidence: string; source: string }>>(
      result.response.text()
    );

    for (const item of data) {
      const entry = toFetch[item.idx - 1];
      if (entry) {
        const priceInfo: PriceInfo = {
          price:      typeof item.price === "number" ? item.price : null,
          confidence: (["high", "medium", "low"].includes(item.confidence)
            ? item.confidence
            : "medium") as PriceInfo["confidence"],
          source:     item.source ?? "batch_estimate",
        };
        results.set(entry.key, priceInfo);
        await cachePrice(entry.key, currencyCode, priceInfo);
      }
    }
  } catch (error) {
    console.warn("[PRICES] Batch parse failed, falling back to nulls");
  }

  for (const entry of toFetch) {
    if (!results.has(entry.key)) {
      const priceInfo = { price: null, confidence: "low" as const, source: "unavailable" };
      results.set(entry.key, priceInfo);
      await cachePrice(entry.key, currencyCode, priceInfo);
    }
  }

  return results;
}

async function fetchPricesParallelWithCache(
  unique: UniqueProductEntry[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();
  const toFetch: UniqueProductEntry[] = [];
  
  // التحقق من cache أولاً
  for (const entry of unique) {
    const cached = await getCachedPrice(entry.key, currencyCode);
    if (cached) {
      results.set(entry.key, cached);
    } else {
      toFetch.push(entry);
    }
  }
  
  if (toFetch.length === 0) {
    return results;
  }
  
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  for (let i = 0; i < toFetch.length; i += MAX_PARALLEL_CHUNKS) {
    const chunk   = toFetch.slice(i, i + MAX_PARALLEL_CHUNKS);
    const fetched = await Promise.allSettled(
      chunk.map(async (p) => {
        const prompt = `Return ONLY JSON. Current retail price of "${p.product_name}"${p.brand ? ` by ${p.brand}` : ""} in ${currencyCode}.
FORMAT: {"price": <number or null>, "confidence": "high|medium|low", "source": "<method>"}`;

        const res  = await withRetry(() => model.generateContent(prompt), `price:${p.key}`);
        const data = extractJSON<{ price: number | null; confidence: string; source: string }>(
          res.response.text()
        );
        return { key: p.key, data };
      })
    );

    for (const outcome of fetched) {
      if (outcome.status === "fulfilled") {
        const { key, data } = outcome.value;
        const priceInfo: PriceInfo = {
          price:      typeof data.price === "number" ? data.price : null,
          confidence: (["high", "medium", "low"].includes(data.confidence)
            ? data.confidence
            : "medium") as PriceInfo["confidence"],
          source:     data.source ?? "ai_estimate",
        };
        results.set(key, priceInfo);
        await cachePrice(key, currencyCode, priceInfo);
      }
    }
  }

  for (const entry of toFetch) {
    if (!results.has(entry.key)) {
      const priceInfo = { price: null, confidence: "low" as const, source: "fetch_failed" };
      results.set(entry.key, priceInfo);
      await cachePrice(entry.key, currencyCode, priceInfo);
    }
  }

  return results;
}

async function fetchMarketPrices(
  products: Array<{ product_name: string; brand: string | null; category?: string }>,
  currencyCode: string
): Promise<{ priceMap: Map<string, PriceInfo>; savedCalls: number; uniqueCount: number }> {
  if (products.length === 0) {
    return { priceMap: new Map(), savedCalls: 0, uniqueCount: 0 };
  }

  const { unique } = deduplicateForPricing(products);
  const savedCalls = products.length - unique.length;

  console.log(
    `[PRICES] ${products.length} products → ${unique.length} unique (saved ${savedCalls} calls)`
  );

  const priceMap =
    unique.length >= BATCH_PRICE_THRESHOLD
      ? await fetchPricesBatchWithCache(unique, currencyCode)
      : await fetchPricesParallelWithCache(unique, currencyCode);

  return { priceMap, savedCalls, uniqueCount: unique.length };
}

// ──────────────────────────────────────────────────────────────
// 13. IMAGE QUALITY ANALYSIS (NEW)
// ──────────────────────────────────────────────────────────────

async function analyzeImageQuality(base64: string, mimeType: string): Promise<{
  has_barcodes: boolean;
  has_qr_codes: boolean;
  has_prices_on_shelves: boolean;
  image_quality_score: number;
  lighting_quality: 'excellent' | 'good' | 'poor';
  suggested_improvements: string[];
}> {
  const prompt = `Analyze this inventory image and return ONLY JSON with:
{
  "has_barcodes": boolean,
  "has_qr_codes": boolean,
  "has_prices_on_shelves": boolean,
  "image_quality_score": number (0-100),
  "lighting_quality": "excellent" | "good" | "poor",
  "suggested_improvements": ["improvement1", "improvement2"]
}

Be strict: only return valid JSON, no other text.`;

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  
  try {
    const result = await withTimeout(
      model.generateContent([prompt, { inlineData: { data: base64, mimeType } }]),
      10000,
      "Image quality analysis timeout"
    );
    
    return extractJSON(result.response.text());
  } catch (error) {
    console.warn("[QUALITY] Analysis failed:", error);
    return {
      has_barcodes: false,
      has_qr_codes: false,
      has_prices_on_shelves: false,
      image_quality_score: 50,
      lighting_quality: 'good',
      suggested_improvements: ['Ensure clear focus', 'Improve lighting']
    };
  }
}

// ──────────────────────────────────────────────────────────────
// 14. MASTER PROMPT BUILDER
// ──────────────────────────────────────────────────────────────

function buildMasterPrompt(ctx: GeoContext): string {
  const lang       = ctx.lang === "ar" ? "العربية الفصحى" : "English";
  const currency   = ctx.currency.code;
  const symbol     = ctx.currency.symbol;
  const country    = ctx.lang === "ar" ? ctx.countryNameAr : ctx.countryNameEn;

  return `أنت "محرك الجرد البصري الشامل فائق الدقة v5.0"
  Multimodal Enterprise Inventory Vision Engine — MEIVE-5
  مستوى: Fortune 500 Retail & Logistics Operations
  
  ═══════════════════════════════════════════════════════════════════
  📍 السياق الجغرافي: ${country}
  💰 العملة المحلية: ${currency} (${symbol})
  🗣️ لغة المخرجات: ${lang}
  🔖 معرف الجلسة: ${batch_id}
  📸 معرف الصورة: ${image_id}
  🕐 طابع زمني: ${timestamp}
  🧩 إصدار المخطط: 5.0.0
  📋 سياق الجلسة السابقة: ${previous_scan_context}
  📐 خطة الرف المعتمدة: ${planogram_reference}
  ═══════════════════════════════════════════════════════════════════
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🧠 الهوية التشغيلية
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  أنت نظام رؤية حاسوبية مؤسسي متعدد الوسائط مدرّب على:
  - ملايين صور المستودعات والتجزئة العالمية
  - معايير GS1 للباركود والتسمية
  - أنظمة إدارة المخزون ERP/WMS
  - لوائح الامتثال الغذائي والدوائي الدولية
  - أنماط الاحتيال التجاري وتزوير المنتجات
  - تحليل أداء الرف (Planogram Compliance)
  - تحليل سلاسل الإمداد والتوزيع
  
  قدراتك البصرية تعمل بكفاءة عالية مع:
  - الصور منخفضة الجودة والمشوشة
  - إضاءة CCTV والمستودعات الصناعية
  - الزوايا الصعبة والتداخل الجزئي
  - الباركود التالف أو المطموس
  - صور الهواتف القديمة والطوارئ
  - الألوان الباهتة أو المشبعة بشكل غير طبيعي
  
  منهجية التحليل الأساسية:
  شكل → لون → أبعاد → نص → سياق → تاريخ → مقارنة → استنتاج → تدقيق ذاتي
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔁 CHAIN OF THOUGHT — إلزامي قبل أي إخراج
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  قبل إنتاج JSON، نفّذ هذا التسلسل الفكري داخلياً:
  
  STEP 1 — SCENE PARSE:
    "ماذا أرى في هذه الصورة؟"
    → حدد البيئة، كثافة المخزون، جودة الصورة، نقاط الضعف البصرية
  
  STEP 2 — OBJECT ISOLATION:
    "كم عنصراً مستقلاً يمكنني تحديده؟"
    → افصل كل منتج كوحدة مستقلة بحدود بصرية واضحة
  
  STEP 3 — IDENTITY RESOLUTION:
    لكل منتج:
    "ما أكثر تفسير منطقي لهذا العنصر بناءً على الشكل + اللون + النص + السياق؟"
    → لو لم تصل لإجابة واثقة، انزل للمستوى الأدنى (Hierarchical Fallback)
  
  STEP 4 — QUANTITY VERIFICATION:
    "هل حساب الكمية محكم؟ هل هناك وحدات مخفية خلف أخرى؟"
    → قدّر المخفية وعلّمها بـ quantity_is_estimated: true
  
  STEP 5 — TEMPORAL COMPARISON:
    "هل يوجد سياق من الجلسة السابقة ${previous_scan_context}؟"
    → إذا نعم: احسب delta_quantity و velocity_trend
    → إذا لا: اتركها null
  
  STEP 6 — PLANOGRAM CHECK:
    "هل يوجد مرجع خطة رف ${planogram_reference}؟"
    → إذا نعم: قارن وأنتج planogram_deviation
    → إذا لا: اتركها null
  
  STEP 7 — COMPLIANCE & FRAUD SCAN:
    "هل هناك مخالفات امتثال أو مؤشرات احتيال؟"
    → افحص كل منتج بشكل مستقل
  
  STEP 8 — SELF AUDIT:
    "هل أنا واثق من كل قرار؟ ما الذي يجب مراجعته بشرياً؟"
    → علّم العناصر غير المؤكدة بوضوح
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 CONFIDENCE CALIBRATION — تعريفات دقيقة بأرقام
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  high (≥ 85%):
    ✓ الاسم والماركة مقروءان بوضوح
    ✓ الباركود أو النص التعريفي مرئي
    ✓ الشكل والحجم واللون متسقان مع الهوية
    ✓ لا يوجد تداخل يؤثر على التعريف
  
  medium (60–84%):
    ⚠ الماركة مرئية لكن تفاصيل المنتج غير مكتملة
    ⚠ النص جزئي أو الباركود مطموس جزئياً
    ⚠ تداخل جزئي مع منتجات أخرى
    ⚠ الإضاءة تؤثر على القراءة لكن لا تمنعها
  
  low (< 60%):
    ✗ لا يوجد نص أو باركود مقروء
    ✗ التعريف مبني على الشكل واللون فقط
    ✗ تداخل كبير يمنع الرؤية الكاملة
    ✗ جودة الصورة سيئة جداً في منطقة المنتج
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🪜 HIERARCHICAL FALLBACK — التراجع التدريجي
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  لو تعذّر التعريف الكامل، انزل بالترتيب:
  
  المستوى 1 — تعريف كامل:
    "كوكاكولا 330ml علبة حمراء" ← confidence: high
  
  المستوى 2 — ماركة + فئة:
    "كوكاكولا — مشروب غازي" ← confidence: medium
  
  المستوى 3 — فئة + وصف بصري:
    "مشروب غازي — علبة معدنية حمراء 330ml" ← confidence: medium/low
  
  المستوى 4 — فئة عامة فقط:
    "مشروبات — عبوات متعددة غير محددة" ← confidence: low
  
  المستوى 5 — عنصر غير مصنف:
    "عنصر مرئي غير قابل للتصنيف" ← confidence: low, manual_review: true
  
  لا تستخدم null في product_name أبداً — المستوى 5 هو الحد الأدنى.
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚠️ قواعد صارمة غير قابلة للتجاوز
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  ✦ ZERO HALLUCINATION — لا منتج غير مرئي، لا باركود مخترع
  ✦ STRICT JSON ONLY — لا نص، لا Markdown، لا شرح خارج JSON
  ✦ ALL TEXT IN ${lang}
  ✦ unit_price = null دائماً
  ✦ الكمية غير المؤكدة → quantity_is_estimated: true
  ✦ النص غير المقروء → "unreadable" لا null
  ✦ duplicate_flag = true للمنتجات المتكررة عبر الصور
  ✦ compliance_flags موجودة دائماً حتى لو []
  ✦ لا تواريخ أو أكواد غير مرئية
  ✦ product_name لا يكون null أبداً — استخدم Hierarchical Fallback
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📦 القطاعات المدعومة
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  01 | التجزئة والسوبرماركت    → أطعمة، مشروبات، ألبان، وجبات خفيفة
  02 | الأدوات والمعدات         → يدوية، كهربائية، صناعية، قياس
  03 | الأثاث والديكور          → كراسي، طاولات، خزائن، إضاءة، سجاد
  04 | اللوجستيات والشحن        → كراتين، باليتات، شحن، باركود لوجستي
  05 | الصيدليات والرعاية       → أدوية، مكملات، مستلزمات، عناية
  06 | الملابس والأزياء         → ملابس، أحذية، حقائب، إكسسوارات
  07 | الإلكترونيات والتقنية    → جوالات، لابتوبات، مكونات، أجهزة
  08 | السيارات وقطع الغيار     → إطارات، بطاريات، قطع غيار
  09 | البناء ومواد التشييد     → أسمنت، طوب، بلاط، عزل، سباكة
  10 | الزراعة والحيوانات       → بذور، أسمدة، علف، أدوات
  11 | مستحضرات التجميل         → كريمات، عطور، مكياج، عناية بالشعر
  12 | غير مصنف                 → أي مخزون خارج الفئات أعلاه
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📤 JSON SCHEMA v5.0
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  {
    "schema_version": "5.0.0",
  
    "summary": {
      "batch_id": "${batch_id}",
      "image_id": "${image_id}",
      "timestamp": "${timestamp}",
      "total_images_processed": 0,
      "total_unique_products": 0,
      "total_units": 0,
      "high_confidence_count": 0,
      "medium_confidence_count": 0,
      "low_confidence_count": 0,
      "compliance_issues_count": 0,
      "urgent_reorder_count": 0,
      "expired_or_damaged_count": 0,
      "manual_review_count": 0,
      "planogram_violations_count": 0,
      "fraud_alerts_count": 0,
      "estimated_inventory_value_range": {
        "min": 0,
        "max": 0,
        "currency": "${symbol}",
        "basis": "market_segment_estimation"
      },
      "analysis_quality": "excellent"
    },
  
    "scan_metadata": {
      "business_type": null,
      "environment": "warehouse",
      "image_quality": "good",
      "lighting_condition": "mixed",
      "scan_coverage": "partial",
      "inventory_density": "medium",
      "stacking_pattern": "mixed",
      "estimated_blind_spots": [],
      "non_inventory_objects": [
        {
          "object": "hand",
          "region": "middle-left",
          "occlusion_impact": "low"
        }
      ]
    },
  
    "image_analysis": {
      "visible_text_detected": [],
      "dominant_colors": [],
      "layout_description": null,
      "shelf_zones_identified": [],
      "ocr_quality": "partial",
      "scene_complexity": "medium"
    },
  
    "temporal_analysis": {
      "previous_scan_available": false,
      "scan_interval_hours": null,
      "total_delta_units": null,
      "velocity_alert": null
    },
  
    "planogram_analysis": {
      "planogram_reference_available": false,
      "compliance_score": null,
      "violations": []
    },
  
    "products": [
      {
        "id": 1,
  
        "source_image_id": "${image_id}",
        "source_frame_timestamp": "${timestamp}",
        "fallback_level": 1,
  
        "product_name": null,
        "brand": null,
        "category": "01 | التجزئة والسوبرماركت",
        "subcategory": null,
        "sku_suggestion": null,
  
        "auto_merge_group": null,
        "cross_image_match_confidence": 0.0,
        "duplicate_flag": false,
  
        "unit_price": null,
        "currency": "${symbol}",
        "market_segment": "mid_range",
        "estimated_unit_value_range": {
          "min": null,
          "max": null,
          "currency": "${symbol}"
        },
  
        "visible_quantity": 0,
        "estimated_hidden_quantity": 0,
        "total_estimated_quantity": 0,
        "quantity_is_estimated": false,
        "unit_of_measure": "قطعة",
        "weight_volume_estimate": null,
  
        "barcode_serial": null,
        "expiry_date": null,
        "batch_number": null,
        "country_of_origin": null,
        "temperature_sensitive": false,
  
        "condition": "good",
        "packaging_integrity_score": 100,
  
        "delta_quantity": null,
        "velocity_trend": null,
        "reorder_urgency": "none",
        "days_until_stockout_estimate": null,
  
        "planogram_deviation": null,
  
        "fraud_suspicion": [],
        "compliance_flags": [],
        "risk_score": 0,
        "inventory_action": "normal_storage",
        "processing_priority": "normal",
  
        "shelf_position": "middle",
        "image_region": "middle-center",
        "bounding_box": {
          "x_percent": 0,
          "y_percent": 0,
          "width_percent": 0,
          "height_percent": 0
        },
  
        "detection_method": "multimodal_match",
        "product_match_basis": [],
        "uncertainty_type": null,
        "barcode_quality": "partial",
        "ocr_quality": "partial",
  
        "confidence": "medium",
        "confidence_score": 0.0,
        "confidence_reason": null,
  
        "model_self_check": {
          "possible_duplicates": [],
          "possible_misclassification": [],
          "manual_review_recommended": false,
          "review_reason": null
        },
  
        "notes": null
      }
    ],
  
    "warnings": [],
    "suggestions": [],
    "photographer_notes": null
  }
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📚 ENUM DEFINITIONS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  analysis_quality: excellent | good | fair | poor
  environment: warehouse | shelf | retail_display | shipping_vehicle | storage_room | pharmacy | supermarket | unknown
  image_quality: excellent | good | fair | poor | very_poor
  lighting_condition: bright | normal | dim | mixed | backlit
  scan_coverage: full | partial | limited
  inventory_density: low | medium | high | overloaded
  stacking_pattern: horizontal | vertical | mixed | palletized | scattered
  scene_complexity: low | medium | high | chaotic
  market_segment: budget | mid_range | premium | luxury
  fallback_level: 1 | 2 | 3 | 4 | 5
  condition: new | good | fair | damaged | expired | near_expiry
  confidence: high | medium | low
  confidence_score: 0.0 – 1.0
  velocity_trend: fast | normal | slow | stagnant | null
  reorder_urgency: high | medium | low | none
  days_until_stockout_estimate: integer | null
  processing_priority: urgent | normal | low
  inventory_action: restock | quarantine | discard | verify_manually | discount_sale | normal_storage
  detection_method: ocr_only | visual_match | barcode_match | multimodal_match
  uncertainty_type: blur | occlusion | glare | low_resolution | partial_visibility | ambiguous_packaging
  ocr_quality: excellent | partial | unreadable
  barcode_quality: excellent | partial | unreadable
  planogram_deviation: correct_position | wrong_position | missing_product | extra_product | null
  compliance_flags: no_barcode | no_country_of_origin | expired_on_shelf | damaged_packaging | missing_label | barcode_unreadable | possible_counterfeit | tampered_packaging
  fraud_suspicion: fake_packaging | barcode_mismatch | tampered_label
  shelf_position: top | middle | bottom | floor | hanging | unknown
  image_region: top-left | top-center | top-right | middle-left | middle-center | middle-right | bottom-left | bottom-center | bottom-right
  velocity_alert: critical_depletion | fast_moving | normal | slow_moving | null`;
}

// ──────────────────────────────────────────────────────────────
// 15. PROCESS IMAGE INPUT
// ──────────────────────────────────────────────────────────────

function processImageInput(image: string): { base64: string; mimeType: string } {
  let base64: string;
  let mimeType = "image/jpeg";

  if (image.startsWith("data:")) {
    const [header, data] = image.split(",");
    base64   = data ?? "";
    const match = header.match(/data:([^;]+);/);
    mimeType = match?.[1] ?? "image/jpeg";
  } else {
    base64 = image;
  }

  return { base64, mimeType };
}

// ──────────────────────────────────────────────────────────────
// 16. PRODUCT SANITIZER we went to see last oone 
// ──────────────────────────────────────────────────────────────

function sanitizeProduct(raw: any, lang: "ar" | "en"): ProductItem {
  const unknownLabel = lang === "ar" ? "منتج غير معروف" : "Unknown Product";
  const generalLabel = lang === "ar" ? "عام" : "General";

  const confidence: Confidence =
    ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "medium";

  return {
    product_name:   sanitize(raw.product_name || unknownLabel, 300),
    brand:          raw.brand ? sanitize(raw.brand, 150) : null,
    category:       sanitize(raw.category || generalLabel, 150),
    unit_price:     null,
    quantity:       typeof raw.quantity === "number" && raw.quantity > 0
                      ? Math.floor(raw.quantity)
                      : 1,
    barcode_serial: raw.barcode_serial ? sanitize(raw.barcode_serial, 100) : null,
    confidence,
    notes:          sanitize(raw.notes || "", 800),
  };
}

// ──────────────────────────────────────────────────────────────
// 17. POST HANDLER (الدالة الرئيسية)
// ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { success: false, error: "مفتاح Gemini API غير موجود" },
      { status: 500 }
    );
  }

  const contentLen = Number(request.headers.get("content-length") ?? 0);
  if (contentLen > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: `حجم الطلب كبير جداً. الحد الأقصى ${MAX_BODY_BYTES / 1e6}MB.` },
      { status: 413 }
    );
  }

  let body: {
    image?:           string;
    fetch_prices?:    boolean;
    country_override?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "الطلب غير صالح — يجب أن يكون JSON." },
      { status: 400 }
    );
  }

  const { image, fetch_prices = true, country_override } = body;

  if (!image || typeof image !== "string") {
    return NextResponse.json(
      { success: false, error: "لم يُرسل حقل `image` في الطلب." },
      { status: 400 }
    );
  }

  const ctx = await resolveGeoContext(request, country_override);

  // معالجة الصورة الأولية
  let { base64, mimeType } = processImageInput(image);

  if (!validateBase64(base64)) {
    return NextResponse.json(
      { success: false, error: "صيغة الصورة غير صالحة." },
      { status: 400 }
    );
  }

  // تحويل وتحسين الصورة (يدعم جميع الصيغ)
  let optimizedImage;
  try {
    optimizedImage = await convertAndOptimizeImage(base64, mimeType, 1024, 1024);
    base64 = optimizedImage.base64;
    mimeType = optimizedImage.mimeType;
  } catch (convError) {
    console.error("[IMAGE] Conversion failed:", convError);
    return NextResponse.json(
      { success: false, error: "نوع الصورة غير مدعوم أو تالف." },
      { status: 400 }
    );
  }

  const imageBytes = Buffer.byteLength(base64, "base64");
  if (imageBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: `حجم الصورة يتجاوز ${MAX_IMAGE_SIZE_MB}MB بعد التحسين.` },
      { status: 413 }
    );
  }

  // تحليل جودة الصورة (اختياري)
  let qualityAnalysis;
  try {
    qualityAnalysis = await analyzeImageQuality(base64, mimeType);
    if (qualityAnalysis.image_quality_score < 30) {
      console.warn(`[QUALITY] Low image quality: ${qualityAnalysis.image_quality_score}/100`);
    }
  } catch (qualityError) {
    console.warn("[QUALITY] Analysis skipped:", qualityError);
    qualityAnalysis = null;
  }

  // تحليل الصورة باستخدام Gemini
  let parsedAI: any;
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: "application/json",
        temperature:      0.05,
        topP:             0.9,
        topK:             32,
      },
    });

    const aiResult = await withRetry(
      () =>
        model.generateContent([
          buildMasterPrompt(ctx),
          { inlineData: { data: base64, mimeType } },
        ]),
      "image-analysis"
    );

    parsedAI = extractJSON<any>(aiResult.response.text());
  } catch (err: any) {
    console.error("[ANALYZE] AI error:", err?.message);

    if (err?.status === 429) {
      return NextResponse.json(
        { success: false, error: "تم تجاوز حد الاستخدام. انتظر وأعد المحاولة.", retry_after: 60 },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: "فشل تحليل الصورة. تأكد من وضوحها." },
      { status: 500 }
    );
  }

  // تنقية المنتجات
  const rawProducts: any[] = Array.isArray(parsedAI.products) ? parsedAI.products : [];
  let products: ProductItem[] = rawProducts.map(p => sanitizeProduct(p, ctx.lang));

  // جلب الأسعار
  let pricesFetched = false;
  let savedCalls = 0;
  let uniqueCount = 0;

  if (fetch_prices && products.length > 0) {
    try {
      const { priceMap, savedCalls: sc, uniqueCount: uc } = await fetchMarketPrices(
        products.map(p => ({ product_name: p.product_name, brand: p.brand, category: p.category })),
        ctx.currency.code
      );

      savedCalls = sc;
      uniqueCount = uc;

      products = products.map(p => {
        const key = `${p.product_name.trim().toLowerCase()}|${(p.brand ?? "").trim().toLowerCase()}`;
        const info = priceMap.get(key);
        return { ...p, unit_price: info?.price ?? null };
      });

      pricesFetched = products.some(p => p.unit_price !== null);
    } catch (priceErr) {
      console.warn("[PRICES] Failed to fetch prices:", priceErr);
    }
  }

  // حساب الإجمالي
  const totalValue = products.reduce((sum, p) => {
    return p.unit_price ? sum + p.unit_price * (p.quantity ?? 1) : sum;
  }, 0);

  const formattedTotal = new Intl.NumberFormat(
    ctx.lang === "ar" ? "ar-EG" : "en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  ).format(totalValue);

  const analysisQuality =
    ["excellent", "good", "fair", "poor"].includes(parsedAI.analysis_quality)
      ? parsedAI.analysis_quality
      : "fair";

  // بناء الاستجابة النهائية
  const response = {
    success: true,
    editable: true,
    business_type: sanitize(parsedAI.business_type ?? (ctx.lang === "ar" ? "مخزون عام" : "General Inventory"), 100),
    analysis_quality: analysisQuality,
    detected_items_count: products.length,
    products: products.map(p => ({
      ...p,
      _editable_fields: ["quantity", "unit_price", "product_name", "notes"]
    })),
    warnings: Array.isArray(parsedAI.warnings) ? parsedAI.warnings.slice(0, 10).map((w: any) => sanitize(w)) : [],
    suggestions: Array.isArray(parsedAI.suggestions) ? parsedAI.suggestions.slice(0, 5).map((s: any) => sanitize(s)) : [],
    detected_location: ctx.lang === "ar" ? ctx.countryNameAr : ctx.countryNameEn,
    timestamp: new Date().toISOString(),

    // معلومات العملة
    currency_info: {
      code: ctx.currency.code,
      symbol: ctx.currency.symbol,
      name: ctx.lang === "ar" ? ctx.currency.nameAr : ctx.currency.nameEn,
      exchange_rate_to_usd: ctx.currency.exchangeRateToUSD,
    },

    // القيم المالية
    total_estimated_value: totalValue,
    total_estimated_value_formatted: `${ctx.currency.symbol}${formattedTotal}`,

    // معلومات جودة الصورة (جديدة)
    image_quality_analysis: qualityAnalysis,

    // تعليمات التعديل اليدوي
    edit_instructions: {
      ar: "يمكنك تعديل الكمية (quantity) والسعر (unit_price) يدوياً في الواجهة الأمامية",
      en: "You can manually edit quantity and unit_price in the frontend"
    },

    // البيانات الأولية
    _raw_ai_response: {
      business_type: parsedAI.business_type,
      analysis_quality: parsedAI.analysis_quality,
      warnings_count: parsedAI.warnings?.length || 0,
      suggestions_count: parsedAI.suggestions?.length || 0
    },

    // مقاييس الأداء والميزات المدعومة
    _meta: {
      engine: "Universal Inventory Intelligence v5.0",
      model: MODEL_NAME,
      duration_ms: Date.now() - startTime,
      prices_fetched: pricesFetched,
      unique_products: uniqueCount,
      saved_api_calls: savedCalls,
      country_detected: ctx.countryCode,
      image_optimization: {
        original_size_kb: optimizedImage ? (optimizedImage.originalSize / 1024).toFixed(1) : null,
        optimized_size_kb: optimizedImage ? (optimizedImage.optimizedSize / 1024).toFixed(1) : null,
        original_format: mimeType
      },
      supported_features: {
        all_image_formats: true,
        auto_conversion: true,
        price_caching: true,
        quality_analysis: !!qualityAnalysis
      }
    },
  };

  return NextResponse.json(response);
}

// ──────────────────────────────────────────────────────────────
// 18. GET HANDLER
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ctx = await resolveGeoContext(request);

  return NextResponse.json({
    status: "online",
    status_ar: "متصل",
    engine: "Universal Inventory Intelligence",
    engine_ar: "محرك الجرد الذكي الشامل",
    version: "5.0.0",
    model: MODEL_NAME,
    timestamp: new Date().toISOString(),
    editable_output: true,
    edit_instructions: {
      ar: "يمكنك تعديل الكميات والأسعار يدوياً بعد استلام النتيجة. الحقول القابلة للتعديل: quantity, unit_price, product_name, notes",
      en: "You can manually edit quantities and prices after receiving the result. Editable fields: quantity, unit_price, product_name, notes"
    },
    features: {
      auto_geo_detection: true,
      live_market_prices: true,
      batch_price_fetching: true,
      deduplication: true,
      exponential_backoff: true,
      arabic_first: true,
      zero_hallucination: true,
      manual_editing_support: true,
      all_image_formats: true,
      auto_image_conversion: true,
      price_caching: true,
      quality_analysis: true
    },
    supported_image_formats: [
      "JPEG", "PNG", "WebP", "GIF", "BMP", 
      "TIFF", "HEIC", "HEIF", "AVIF", "SVG"
    ],
    detected_context: {
      country: ctx.countryNameEn,
      country_ar: ctx.countryNameAr,
      currency: ctx.currency.code,
      lang: ctx.lang,
    },
    supported_industries: [
      "Retail & Supermarkets",
      "Hardware & Tools",
      "Logistics & Warehousing",
      "Pharmacy & Medical",
      "Fashion & Apparel",
      "Electronics & Tech",
      "Furniture & Decor",
      "Auto Parts",
      "General Inventory"
    ],
  });
}
