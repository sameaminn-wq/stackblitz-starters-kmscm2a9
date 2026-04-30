// app/api/analyze/route.ts
// ╔══════════════════════════════════════════════════════════════╗
// ║  Universal Inventory Intelligence Engine — v4.0              ║
// ║  Gemini 2.5 Flash · Arabic-first · Editable Output          ║
// ╚══════════════════════════════════════════════════════════════╝

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { InventoryAnalysisResult, ProductItem, Confidence } from "../../types";

// ──────────────────────────────────────────────────────────────
// 1. CONFIGURATION
// ──────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const MODEL_NAME = "gemini-2.5-flash";

const MAX_IMAGE_SIZE_MB   = 4;
const MAX_IMAGE_BYTES     = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_BODY_BYTES      = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES  = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_RETRIES          = 4;
const BASE_RETRY_DELAY_MS  = 3000;
const BATCH_PRICE_THRESHOLD = 6;
const MAX_PARALLEL_CHUNKS   = 3;

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
// 4. CONTEXT RESOLUTION
// ──────────────────────────────────────────────────────────────

async function resolveGeoContext(request: NextRequest, bodyCountry?: string): Promise<GeoContext> {
  let countryCode = DEFAULT_COUNTRY;
  
  try {
    // محاولة آمنة للحصول على الهيدرز
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
// 5. SECURITY HELPERS
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
// 6. RETRY WITH EXPONENTIAL BACK-OFF
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
// 7. JSON EXTRACTION
// ──────────────────────────────────────────────────────────────

function extractJSON<T>(raw: string): T {
  if (!raw) throw new Error("Empty AI response");

  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const objStart  = text.indexOf("{");
  const objEnd    = text.lastIndexOf("}");
  const arrStart  = text.indexOf("[");
  const arrEnd    = text.lastIndexOf("]");

  if (objStart !== -1 && objEnd > objStart) {
    text = text.slice(objStart, objEnd + 1);
  } else if (arrStart !== -1 && arrEnd > arrStart) {
    text = text.slice(arrStart, arrEnd + 1);
  } else {
    throw new Error("No JSON structure found in AI response");
  }

  return JSON.parse(text) as T;
}

// ──────────────────────────────────────────────────────────────
// 8. PRODUCT DEDUPLICATION
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
// 9. PRICE FETCHING — BATCH & PARALLEL
// ──────────────────────────────────────────────────────────────

async function fetchPricesBatch(
  unique: UniqueProductEntry[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();

  const productList = unique
    .map((p, i) => `${i + 1}. ${p.product_name}${p.brand ? ` (${p.brand})` : ""}`)
    .join("\n");

  const prompt = `You are a market pricing assistant. Return ONLY a JSON array with no extra text.
Given these products, estimate their current retail price in ${currencyCode}.

Products:
${productList}

Return exactly ${unique.length} objects in this format:
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
      const entry = unique[item.idx - 1];
      if (entry) {
        results.set(entry.key, {
          price:      typeof item.price === "number" ? item.price : null,
          confidence: (["high", "medium", "low"].includes(item.confidence)
            ? item.confidence
            : "medium") as PriceInfo["confidence"],
          source:     item.source ?? "batch_estimate",
        });
      }
    }
  } catch {
    console.warn("[PRICES] Batch parse failed, falling back to nulls");
  }

  for (const entry of unique) {
    if (!results.has(entry.key)) {
      results.set(entry.key, { price: null, confidence: "low", source: "unavailable" });
    }
  }

  return results;
}

async function fetchPricesParallel(
  unique: UniqueProductEntry[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();
  const model   = genAI.getGenerativeModel({ model: MODEL_NAME });

  for (let i = 0; i < unique.length; i += MAX_PARALLEL_CHUNKS) {
    const chunk   = unique.slice(i, i + MAX_PARALLEL_CHUNKS);
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
        results.set(key, {
          price:      typeof data.price === "number" ? data.price : null,
          confidence: (["high", "medium", "low"].includes(data.confidence)
            ? data.confidence
            : "medium") as PriceInfo["confidence"],
          source:     data.source ?? "ai_estimate",
        });
      }
    }
  }

  for (const entry of unique) {
    if (!results.has(entry.key)) {
      results.set(entry.key, { price: null, confidence: "low", source: "fetch_failed" });
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
      ? await fetchPricesBatch(unique, currencyCode)
      : await fetchPricesParallel(unique, currencyCode);

  return { priceMap, savedCalls, uniqueCount: unique.length };
}

// ──────────────────────────────────────────────────────────────
// 10. MASTER PROMPT BUILDER (أكثر دقة)
// ──────────────────────────────────────────────────────────────

function buildMasterPrompt(ctx: GeoContext): string {
  const lang       = ctx.lang === "ar" ? "العربية الفصحى" : "English";
  const currency   = ctx.currency.code;
  const symbol     = ctx.currency.symbol;
  const country    = ctx.lang === "ar" ? ctx.countryNameAr : ctx.countryNameEn;

  return `أنت "محرك الجرد البصري الشامل فائق الدقة" (Ultra-Precise Universal Visual Inventory Engine).

═══════════════════════════════════════════════════════════════════
📍 السياق: المستخدم في ${country}
💰 العملة: ${currency} (${symbol})
🗣️ اللغة المستهدفة: ${lang}
═══════════════════════════════════════════════════════════════════

🎯 المهمة الأساسية:
قم بتحليل الصورة المرفقة بدقة متناهية وأجرِ جرداً كاملاً لكل المنتجات المرئية.

═══════════════════════════════════════════════════════════════════
📋 قائمة القطاعات المدعومة (مع أمثلة):
═══════════════════════════════════════════════════════════════════
1. التجزئة والسوبرماركت: أطعمة، مشروبات معلبة، منتجات ألبان، أسعار على الرفوف
2. الأدوات والمعدات: دريلات، مناشير، عدد يدوية، معدات صناعية
3. الأثاث والديكور: كراسي، طاولات، خزائن، إضاءة، سجاد
4. الخدمات اللوجستية: صناديق كرتون، باليتات، منصات شحن، باركود شحن
5. الصيدليات: أدوية، مكملات غذائية، مستلزمات طبية، باركود دوائي
6. الملابس والأزياء: قمصان، بناطيل، أحذية، شنط، ماركات
7. الإلكترونيات: جوالات، لابتوبات، أجهزة لوحية، شاشات، مكونات إلكترونية
8. السيارات وقطع الغيار: إطارات، بطاريات، زينة، قطع غيار
9. أي مخزون آخر غير مصنف

═══════════════════════════════════════════════════════════════════
⚠️ قواعد صارمة جداً (تطبق بصرامة عالية):
═══════════════════════════════════════════════════════════════════
1. أخرج JSON فقط — لا تضع أي نص قبله أو بعده
2. لا تختلق منتجات غير مرئية في الصورة (Zero Hallucination)
3. استخدم اللغة ${lang} لجميع الحقول النصية
4. اترك unit_price = null (سيتم جلب السعر لاحقاً من السوق)
5. حدد الكمية (quantity) بدقة بناءً على العناصر المرئية
6. عند وجود عدة عناصر متطابقة، احسب الكمية الإجمالية
7. حدد مستوى الثقة (confidence) بصراحة:
   - high: المنتج واضح تماماً والمعلومات مؤكدة
   - medium: المنتج واضح ولكن بعض التفاصيل غير مؤكدة
   - low: المنتج غير واضح أو غير مكتمل

═══════════════════════════════════════════════════════════════════
🔍 نصائح لتحليل أكثر دقة:
═══════════════════════════════════════════════════════════════════
- إذا كان المنتج مكرراً (مثل 5 علب كوكاكولا)، ضع quantity = 5 و product واحد
- اقرأ الأسعار المكتوبة على المنتجات إذا كانت مرئية (سيتم استخدامها لاحقاً)
- حدد الماركة التجارية إذا كانت ظاهرة (Apple, Samsung, Nike...)
- لاحظ تواريخ الصلاحية إذا كانت مرئية وأضفها في حقل notes
- انتبه للحالة (جديد، مستعمل، معروض للبيع، تالف)

═══════════════════════════════════════════════════════════════════
📤 مخرجات JSON المطلوبة (استخدم هذا القالب حرفياً):
═══════════════════════════════════════════════════════════════════
{
  "business_type": "نوع النشاط التجاري",
  "analysis_quality": "excellent | good | fair | poor",
  "detected_items_count": 0,
  "products": [
    {
      "product_name": "الاسم الدقيق للمنتج باللغة ${lang}",
      "brand": "اسم الماركة أو null",
      "category": "التصنيف المناسب",
      "unit_price": null,
      "quantity": 1,
      "barcode_serial": "الباركود أو الرقم التسلسلي أو null",
      "confidence": "high | medium | low",
      "notes": "تفاصيل إضافية: المقاس، اللون، السعة، الحالة، تاريخ الصلاحية، ملاحظات أخرى"
    }
  ],
  "warnings": ["أي تحذيرات متعلقة بجودة الصورة أو عدم وضوح بعض العناصر"],
  "suggestions": ["اقتراحات لتحسين الجرد مستقبلاً"]
}

═══════════════════════════════════════════════════════════════════
✅ تذكير أخير:
- دقة التحليل هي أولويتنا الأولى
- كمية المنتجات (quantity) يجب أن تعكس العدد الحقيقي في الصورة
- إذا كانت الصورة فارغة أو ذات جودة سيئة، أعد analysis_quality: "poor" وقائمة منتجات فارغة
═══════════════════════════════════════════════════════════════════`;
}

// ──────────────────────────────────────────────────────────────
// 11. IMAGE PROCESSING & VALIDATION
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

  if (!ALLOWED_MIME_TYPES.has(mimeType)) mimeType = "image/jpeg";

  return { base64, mimeType };
}

// ──────────────────────────────────────────────────────────────
// 12. PRODUCT SANITIZER
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
// 13. POST HANDLER — مع دعم قابلية التعديل اليدوي
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

  const { base64, mimeType } = processImageInput(image);

  if (!validateBase64(base64)) {
    return NextResponse.json(
      { success: false, error: "صيغة الصورة غير صالحة." },
      { status: 400 }
    );
  }

  const imageBytes = Buffer.byteLength(base64, "base64");
  if (imageBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: `حجم الصورة يتجاوز ${MAX_IMAGE_SIZE_MB}MB.` },
      { status: 413 }
    );
  }

  // تحليل الصورة
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

  // بناء الاستجابة مع إمكانية التعديل اليدوي
  const response = {
    success: true,
    editable: true, // إشارة إلى أن المخرجات قابلة للتعديل يدوياً
    business_type: sanitize(parsedAI.business_type ?? (ctx.lang === "ar" ? "مخزون عام" : "General Inventory"), 100),
    analysis_quality: analysisQuality,
    detected_items_count: products.length,
    products: products.map(p => ({
      ...p,
      _editable_fields: ["quantity", "unit_price", "product_name", "notes"] // حقول قابلة للتعديل
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

    // تعليمات التعديل اليدوي
    edit_instructions: {
      ar: "يمكنك تعديل الكمية (quantity) والسعر (unit_price) يدوياً في الواجهة الأمامية",
      en: "You can manually edit quantity and unit_price in the frontend"
    },

    // بيانات أولية للمساعدة في التعديل
    _raw_ai_response: {
      business_type: parsedAI.business_type,
      analysis_quality: parsedAI.analysis_quality,
      warnings_count: parsedAI.warnings?.length || 0,
      suggestions_count: parsedAI.suggestions?.length || 0
    },

    // مقاييس الأداء
    _meta: {
      engine: "Universal Inventory Intelligence v4.0",
      model: MODEL_NAME,
      duration_ms: Date.now() - startTime,
      prices_fetched: pricesFetched,
      unique_products: uniqueCount,
      saved_api_calls: savedCalls,
      country_detected: ctx.countryCode,
    },
  };

  return NextResponse.json(response);
}

// ──────────────────────────────────────────────────────────────
// 14. GET HANDLER
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ctx = await resolveGeoContext(request);

  return NextResponse.json({
    status: "online",
    status_ar: "متصل",
    engine: "Universal Inventory Intelligence",
    engine_ar: "محرك الجرد الذكي الشامل",
    version: "4.0.0",
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
      manual_editing_support: true
    },
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