import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* =========================================================
   Gemini Config
========================================================= */
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY");
}

const genAI = new GoogleGenerativeAI(apiKey);

/* =========================================================
   Types
========================================================= */
type Confidence = "high" | "medium" | "low";
type AnalysisQuality = "excellent" | "good" | "partial" | "failed";

interface ProductItem {
  product_name: string;
  brand: string;
  category: string;
  unit_price: string;
  quantity: number;
  barcode: string;
  confidence: Confidence;
  notes: string;
}

interface AnalysisResult {
  success: boolean;
  country: string;
  currency: string;
  language: string;
  products: ProductItem[];
  total_products_detected: number;
  analysis_quality: AnalysisQuality;
  warnings: string[];
}

/* =========================================================
   Country Detection
========================================================= */
function detectCountry(req: NextRequest) {
  const country =
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cf-ipcountry") ||
    req.geo?.country ||
    "EG";

  return country.toUpperCase();
}

function getCountrySettings(code: string) {
  const countries: Record<
    string,
    { country: string; currency: string; language: string }
  > = {
    EG: { country: "Egypt", currency: "EGP", language: "Arabic" },
    SA: { country: "Saudi Arabia", currency: "SAR", language: "Arabic" },
    AE: { country: "UAE", currency: "AED", language: "Arabic" },
    KW: { country: "Kuwait", currency: "KWD", language: "Arabic" },
    QA: { country: "Qatar", currency: "QAR", language: "Arabic" },
    BH: { country: "Bahrain", currency: "BHD", language: "Arabic" },
    OM: { country: "Oman", currency: "OMR", language: "Arabic" },
    US: { country: "United States", currency: "USD", language: "English" },
    GB: { country: "United Kingdom", currency: "GBP", language: "English" },
    FR: { country: "France", currency: "EUR", language: "French" },
    DE: { country: "Germany", currency: "EUR", language: "German" },
  };

  return (
    countries[code] || {
      country: "Egypt",
      currency: "EGP",
      language: "Arabic",
    }
  );
}

/* =========================================================
   Helpers
========================================================= */
function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getMime(base64: string) {
  const match = base64.match(/^data:(image\/.*?);base64,/);
  return match?.[1] || "image/jpeg";
}

function cleanBase64(base64: string) {
  return base64.split(",")[1] || "";
}

/* =========================================================
   Gemini Analyze
========================================================= */
async function analyzeImage(
  image: string,
  countryInfo: {
    country: string;
    currency: string;
    language: string;
  }
): Promise<AnalysisResult> {
  const mimeType = getMime(image);
  const base64 = cleanBase64(image);

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const prompt = `
You are a professional inventory AI.

User Country: ${countryInfo.country}
Language: ${countryInfo.language}
Currency: ${countryInfo.currency}

Analyze shelf/store image and extract visible products only.

Rules:
- Use ${countryInfo.language} language in response.
- Use ${countryInfo.currency} currency.
- If price unclear leave empty.
- Count repeated items.
- No guessing.

Return JSON only:

{
 "products":[
   {
    "product_name":"",
    "brand":"",
    "category":"",
    "unit_price":"",
    "quantity":0,
    "barcode":"",
    "confidence":"high",
    "notes":""
   }
 ],
 "analysis_quality":"excellent",
 "warnings":[]
}
`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: base64,
        mimeType,
      },
    },
  ]);

  const text = result.response.text();
  const parsed = JSON.parse(text);

  const products = Array.isArray(parsed.products)
    ? parsed.products
    : [];

  return {
    success: true,
    country: countryInfo.country,
    currency: countryInfo.currency,
    language: countryInfo.language,
    products,
    total_products_detected: products.length,
    analysis_quality: parsed.analysis_quality || "good",
    warnings: parsed.warnings || [],
  };
}

/* =========================================================
   POST
========================================================= */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image = body?.image;

    if (!image) {
      return json(
        { success: false, error: "No image uploaded" },
        400
      );
    }

    const countryCode = detectCountry(req);
    const countryInfo = getCountrySettings(countryCode);

    const result = await analyzeImage(image, countryInfo);

    return json(result);
  } catch (error: any) {
    return json(
      {
        success: false,
        error: "Image analysis failed",
        detail: error.message,
      },
      500
    );
  }
}

/* =========================================================
   GET
========================================================= */
export async function GET(req: NextRequest) {
  const code = detectCountry(req);
  const country = getCountrySettings(code);

  return json({
    status: "ok",
    service: "Global Smart Analyzer",
    auto_detected_country: country.country,
    currency: country.currency,
    language: country.language,
    endpoint: "/api/analyze",
  });
}