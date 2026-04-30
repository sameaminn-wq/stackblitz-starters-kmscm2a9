// app/api/analyze/route.ts
// ╔══════════════════════════════════════════════════════════════╗
// ║  Universal Inventory Intelligence Engine — v3.0              ║
// ║  Gemini 1.5 Flash (Batch-compatible) · Arabic-first         ║
// ╚══════════════════════════════════════════════════════════════╝

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { InventoryAnalysisResult, ProductItem, Confidence } from "../../types";

// ──────────────────────────────────────────────────────────────
// 1. CONFIGURATION
// ──────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

/** نستخدم gemini-1.5-flash لأنه متوافق مع Batch API وأسرع + أرخص */
const MODEL_NAME = "gemini-1.5-flash";

const MAX_IMAGE_SIZE_MB   = 4;
const MAX_IMAGE_BYTES     = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_BODY_BYTES      = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES  = new Set(["image/jpeg", "image/png", "image/webp"]);

// إعادة المحاولة عند 429 — Exponential back-off
const MAX_RETRIES          = 4;
const BASE_RETRY_DELAY_MS  = 3000; // 3 ثوانٍ

// حد التكرار لتجميع الأسعار دفعة واحدة
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
// 3. GEO + CURRENCY DATABASE
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
//    يقرأ رأس x-vercel-ip-country أولاً، ثم CF-IPCountry،
//    ثم x-country-override من الـ body (للتطوير المحلي)
// ──────────────────────────────────────────────────────────────

function resolveGeoContext(request: NextRequest, bodyCountry?: string): GeoContext {
  const headerCountry =
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry") ||
    null;

  // الأولوية: body override (تطوير) → Vercel header → CF header → افتراضي
  const code = (bodyCountry ?? headerCountry ?? DEFAULT_COUNTRY).toUpperCase();

  const names    = COUNTRY_NAMES[code]    ?? COUNTRY_NAMES[DEFAULT_COUNTRY];
  const currency = CURRENCY_DB[code]      ?? CURRENCY_DB[DEFAULT_COUNTRY];
  const lang     = names.lang;

  return {
    countryCode:   code,
    countryNameAr: names.ar,
    countryNameEn: names.en,
    currency,
    lang,
  };
}

// ──────────────────────────────────────────────────────────────
// 5. SECURITY HELPERS
// ──────────────────────────────────────────────────────────────

/** التحقق من صحة base64 مع رفض البيانات الخطرة */
function validateBase64(str: string): boolean {
  if (!str || str.length > MAX_BODY_BYTES) return false;

  // رفض أي محاولة لحقن بيانات خطرة داخل سلسلة base64
  const FORBIDDEN = ["../", "..\\", "\0", "%00", "<script", "javascript:", "data:text/html"];
  const lower = str.slice(0, 200).toLowerCase(); // نفحص البداية فقط لأداء أفضل
  for (const pattern of FORBIDDEN) {
    if (lower.includes(pattern)) return false;
  }

  // تحقق سريع: base64 يحتوي فقط على [A-Za-z0-9+/=]
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return false;

  try {
    Buffer.from(str, "base64");
    return true;
  } catch {
    return false;
  }
}

/** تعقيم النص لمنع XSS وحقن البيانات */
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
      // Jitter: تأخير عشوائي ± 20% لتجنب thundering herd
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
// 7. JSON EXTRACTION (robust against markdown fences)
// ──────────────────────────────────────────────────────────────

function extractJSON<T>(raw: string): T {
  if (!raw) throw new Error("Empty AI response");

  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // إيجاد أول `{` أو `[` وآخر `}` أو `]`
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
// 8. PRODUCT DEDUPLICATION (لتوفير استدعاءات API للأسعار)
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
// 9. PRICE FETCHING — BATCH (single call for ≥ threshold items)
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

  // تأمين: أي منتج لم يُعطَ سعر → null
  for (const entry of unique) {
    if (!results.has(entry.key)) {
      results.set(entry.key, { price: null, confidence: "low", source: "unavailable" });
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────────
// 10. PRICE FETCHING — PARALLEL CHUNKS (for small counts)
// ──────────────────────────────────────────────────────────────

async function fetchPricesParallel(
  unique: UniqueProductEntry[],
  currencyCode: string
): Promise<Map<string, PriceInfo>> {
  const results = new Map<string, PriceInfo>();
  const model   = genAI.getGenerativeModel({ model: MODEL_NAME });

  // تقسيم إلى chunks لتجنب إغراق API
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

  // تأمين fallback
  for (const entry of unique) {
    if (!results.has(entry.key)) {
      results.set(entry.key, { price: null, confidence: "low", source: "fetch_failed" });
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────────
// 11. ORCHESTRATE PRICE FETCHING
// ──────────────────────────────────────────────────────────────

async function fetchMarketPrices(
  products: Array<{ product_name: string; brand: string | null; category?: string }>,
  currencyCode: string
): Promise<{ priceMap: Map<string, PriceInfo>; savedCalls: number; uniqueCount: number }> {
  if (products.length === 0) {
    return { priceMap: new Map(), savedCalls: 0, uniqueCount: 0 };
  }

  const { unique, indexToKey } = deduplicateForPricing(products);
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
// 12. MASTER PROMPT BUILDER
// ──────────────────────────────────────────────────────────────

function buildMasterPrompt(ctx: GeoContext): string {
  const lang       = ctx.lang === "ar" ? "العربية الفصحى" : "English";
  const currency   = ctx.currency.code;
  const symbol     = ctx.currency.symbol;
  const country    = ctx.lang === "ar" ? ctx.countryNameAr : ctx.countryNameEn;

  return `أنت "محرك الجرد البصري الشامل" (Universal Visual Inventory Engine).
السياق: المستخدم في ${country} — العملة: ${currency} (${symbol}) — اللغة: ${lang}

═══════════════════════════════════════════════════
▌ المهمة
═══════════════════════════════════════════════════
حلّل الصورة المرفقة وأجرِ جرداً احترافياً شاملاً لكل الأصناف المرئية.

═══════════════════════════════════════════════════
▌ نطاق الجرد (شامل لجميع القطاعات)
═══════════════════════════════════════════════════
• تجزئة وسوبرماركت: أطعمة، مشروبات، علب، أسعار، باركود، تواريخ صلاحية
• أدوات ومعدات: أدوات كهربائية ويدوية (Bosch, Makita...)، قدرة، موديل
• أثاث وديكور: كراسي، طاولات، خزائن، الخامة واللون
• لوجستيات: صناديق، حاويات، Pallets، رموز الشحن
• صيدلة: أدوية، جرعة، تركيز، باركود طبي
• ملابس وموضة: مقاسات، ماركات، ألوان
• إلكترونيات: هواتف، شاشات، سيريال نمبر

═══════════════════════════════════════════════════
▌ قواعد صارمة (لا استثناء)
═══════════════════════════════════════════════════
1. أخرج JSON فقط — لا نص خارجه أبداً
2. لا تختلق منتجات غير مرئية (Zero Hallucination)
3. استخدم ${lang} لجميع النصوص (اسم المنتج، التصنيف، الملاحظات)
4. اترك unit_price كـ null (سيُحسب لاحقاً بسعر السوق الحي)
5. حلّل كل ركن في الصورة بدقة

═══════════════════════════════════════════════════
▌ مخرجات JSON المطلوبة (هذا الشكل حرفياً)
═══════════════════════════════════════════════════
{
  "business_type": "نوع النشاط التجاري",
  "analysis_quality": "excellent | good | fair | poor",
  "detected_items_count": <number>,
  "products": [
    {
      "product_name": "اسم المنتج",
      "brand": "الماركة أو null",
      "category": "التصنيف",
      "unit_price": null,
      "quantity": <number>,
      "barcode_serial": "الباركود أو null",
      "confidence": "high | medium | low",
      "notes": "تفاصيل: مقاس، حالة، لون، صلاحية..."
    }
  ],
  "warnings": ["أي ملاحظات تحذيرية"],
  "suggestions": ["مقترحات لتحسين الجرد"]
}`;
}

// ──────────────────────────────────────────────────────────────
// 13. IMAGE PROCESSING HELPER
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
// 14. PRODUCT SANITIZER
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
    unit_price:     null, // يُملأ لاحقاً
    quantity:       typeof raw.quantity === "number" && raw.quantity > 0
                      ? Math.floor(raw.quantity)
                      : 1,
    barcode_serial: raw.barcode_serial ? sanitize(raw.barcode_serial, 100) : null,
    confidence,
    notes:          sanitize(raw.notes || "", 800),
  };
}

// ──────────────────────────────────────────────────────────────
// 15. POST HANDLER — MAIN ENGINE
// ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // ── أ. التحقق من مفتاح API ──────────────────────────────────
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { success: false, error: "مفتاح Gemini API غير موجود. تحقق من متغيرات البيئة." },
      { status: 500 }
    );
  }

  // ── ب. التحقق من حجم الطلب ─────────────────────────────────
  const contentLen = Number(request.headers.get("content-length") ?? 0);
  if (contentLen > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: `حجم الطلب كبير جداً. الحد الأقصى ${MAX_BODY_BYTES / 1e6}MB.` },
      { status: 413 }
    );
  }

  // ── ج. قراءة الـ body ───────────────────────────────────────
  let body: {
    image?:           string;
    fetch_prices?:    boolean;
    country_override?: string; // للتطوير المحلي فقط
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

  // ── د. تحديد السياق الجغرافي ───────────────────────────────
  const ctx = resolveGeoContext(request, country_override);

  // ── هـ. معالجة الصورة وتحقق الأمان ────────────────────────
  const { base64, mimeType } = processImageInput(image);

  if (!validateBase64(base64)) {
    return NextResponse.json(
      { success: false, error: "صيغة الصورة غير صالحة أو تحتوي على بيانات خطرة." },
      { status: 400 }
    );
  }

  const imageBytes = Buffer.byteLength(base64, "base64");
  if (imageBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: `حجم الصورة يتجاوز ${MAX_IMAGE_SIZE_MB}MB. يرجى ضغط الصورة.` },
      { status: 413 }
    );
  }

  // ── و. تحليل الصورة بـ Gemini 1.5 Flash ────────────────────
  let parsedAI: any;
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: "application/json",
        temperature:      0.05, // دقة قصوى، لا تخيل
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
        {
          success:     false,
          error:       "تم تجاوز حد استخدام API. انتظر دقيقة واحدة ثم أعد المحاولة.",
          retry_after: 60,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: "فشل تحليل الصورة. تأكد من وضوحها وأعد المحاولة." },
      { status: 500 }
    );
  }

  // ── ز. تعقيم المنتجات ──────────────────────────────────────
  const rawProducts: any[] = Array.isArray(parsedAI.products) ? parsedAI.products : [];
  let products: ProductItem[] = rawProducts.map(p => sanitizeProduct(p, ctx.lang));

  // ── ح. جلب أسعار السوق الحية ───────────────────────────────
  let pricesFetched  = false;
  let savedCalls     = 0;
  let uniqueCount    = 0;

  if (fetch_prices && products.length > 0) {
    try {
      const { priceMap, savedCalls: sc, uniqueCount: uc } = await fetchMarketPrices(
        products.map(p => ({ product_name: p.product_name, brand: p.brand, category: p.category })),
        ctx.currency.code
      );

      savedCalls  = sc;
      uniqueCount = uc;

      // إسناد الأسعار
      products = products.map(p => {
        const key  = `${p.product_name.trim().toLowerCase()}|${(p.brand ?? "").trim().toLowerCase()}`;
        const info = priceMap.get(key);
        return {
          ...p,
          unit_price: info?.price ?? null,
        };
      });

      pricesFetched = products.some(p => p.unit_price !== null);
    } catch (priceErr) {
      console.warn("[PRICES] Failed to fetch prices:", priceErr);
      // لا نفشل الطلب بأكمله بسبب فشل الأسعار
    }
  }

  // ── ط. الإحصائيات المالية ──────────────────────────────────
  const totalValue = products.reduce((sum, p) => {
    return p.unit_price ? sum + p.unit_price * (p.quantity ?? 1) : sum;
  }, 0);

  const formattedTotal = new Intl.NumberFormat(
    ctx.lang === "ar" ? "ar-EG" : "en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  ).format(totalValue);

  // ── ي. بناء الاستجابة ──────────────────────────────────────
  const analysisQuality =
    ["excellent", "good", "fair", "poor"].includes(parsedAI.analysis_quality)
      ? parsedAI.analysis_quality
      : "fair";

  const response: InventoryAnalysisResult & Record<string, any> = {
    success:              true,
    business_type:        sanitize(parsedAI.business_type ?? (ctx.lang === "ar" ? "مخزون عام" : "General Inventory"), 100),
    analysis_quality:     analysisQuality,
    detected_items_count: products.length,
    products,
    warnings:             Array.isArray(parsedAI.warnings)
                            ? parsedAI.warnings.slice(0, 10).map((w: any) => sanitize(w))
                            : [],
    suggestions:          Array.isArray(parsedAI.suggestions)
                            ? parsedAI.suggestions.slice(0, 5).map((s: any) => sanitize(s))
                            : [],
    detected_location:    ctx.lang === "ar" ? ctx.countryNameAr : ctx.countryNameEn,
    timestamp:            new Date().toISOString(),

    // معلومات العملة
    currency_info: {
      code:   ctx.currency.code,
      symbol: ctx.currency.symbol,
      name:   ctx.lang === "ar" ? ctx.currency.nameAr : ctx.currency.nameEn,
      exchange_rate_to_usd: ctx.currency.exchangeRateToUSD,
    },

    // القيمة الإجمالية
    total_estimated_value:           totalValue,
    total_estimated_value_formatted: `${ctx.currency.symbol}${formattedTotal}`,

    // مقاييس الأداء (للتطوير والمراقبة)
    _meta: {
      engine:              "Universal Inventory Intelligence v3",
      model:               MODEL_NAME,
      duration_ms:         Date.now() - startTime,
      prices_fetched:      pricesFetched,
      unique_products:     uniqueCount,
      saved_api_calls:     savedCalls,
      country_detected:    ctx.countryCode,
    },
  };

  return NextResponse.json(response);
}

// ──────────────────────────────────────────────────────────────
// 16. GET HANDLER — Health Check
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ctx = resolveGeoContext(request);

  return NextResponse.json({
    status:      "online",
    engine:      "Universal Inventory Intelligence",
    version:     "3.0.0",
    model:       MODEL_NAME,
    timestamp:   new Date().toISOString(),
    features: {
      auto_geo_detection:    true,
      live_market_prices:    true,
      batch_price_fetching:  true,
      deduplication:         true,
      exponential_backoff:   true,
      arabic_first:          true,
      zero_hallucination:    true,
    },
    detected_context: {
      country:  ctx.countryNameEn,
      currency: ctx.currency.code,
      lang:     ctx.lang,
    },
    supported_industries: [
      "Retail & Supermarkets",
      "Hardware & Tools",
      "Logistics & Warehousing",
      "Pharmacy & Medical",
      "Fashion & Apparel",
      "Electronics & Tech",
      "Furniture & Decor",
    ],
  });
}