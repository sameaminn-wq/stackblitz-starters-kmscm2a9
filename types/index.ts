// app/types.ts

export type Confidence = "high" | "medium" | "low";

// ✅ نوع حالة المنتج
export type ProductCondition = "good" | "damaged" | "expired" | "unknown";

// ✅ نوع جودة الصورة
export type LightingQuality = "excellent" | "good" | "poor";
export type AnalysisQuality = "excellent" | "good" | "fair" | "poor";

// ============================================================
// المنتجات
// ============================================================

export interface ProductItem {
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: string | number | null; // يمكن أن يكون string من API القديم
  quantity: number | string; // يمكن أن يكون string من API القديم
  barcode: string | null; // API القديم يستخدم barcode
  barcode_serial?: string | null; // API الجديد يستخدم barcode_serial
  confidence: Confidence;
  notes: string;
  // حقول جديدة من v5.2
  condition?: ProductCondition;
  expiry_date?: string | null;
  location_hint?: string | null;
}

// ✅ تقدير السعر (نطاق مقترح)
export interface PriceEstimate {
  min_price: number | null;
  max_price: number | null;
  suggested_price: number | null;
  confidence: "high" | "medium" | "low";
  source: string;
}

// ✅ منتج قابل للتعديل (يستخدم في الواجهة الأمامية)
export interface EditableProductItem extends ProductItem {
  original_price?: number | null;
  price_estimate?: PriceEstimate;
  is_edited?: boolean;
  last_modified?: string;
  editable_fields?: string[];
  _editable_fields?: string[]; // للتوافق مع API
}

// ============================================================
// تحليل الصورة
// ============================================================

// ✅ تحليل جودة الصورة
export interface ImageQualityAnalysis {
  has_barcodes: boolean;
  has_qr_codes: boolean;
  has_prices_on_shelves: boolean;
  image_quality_score: number;
  lighting_quality: LightingQuality;
  suggested_improvements: string[];
  has_damaged_items: boolean;
  has_expiry_dates: boolean;
  shelf_coverage_pct: number;
}

// ============================================================
// العملة والموقع
// ============================================================

// ✅ معلومات العملة
export interface CurrencyInfo {
  code: string;
  symbol: string;
  nameEn: string;
  nameAr: string;
  exchangeRateToUSD: number;
}

// ✅ معلومات الموقع
export interface GeoContext {
  countryCode: string;
  countryNameAr: string;
  countryNameEn: string;
  currency: CurrencyInfo;
  lang: "ar" | "en";
}

// ✅ معلومات السعر
export interface PriceInfo {
  price: number | null;
  confidence: Confidence;
  source: string;
}

// ============================================================
// استجابات API
// ============================================================

// ✅ الاستجابة الأساسية للتحليل (API القديم)
export interface InventoryAnalysisResult {
  success: boolean;
  products: ProductItem[];
  total_products_detected: number;
  analysis_quality: AnalysisQuality;
  warnings: string[];
  // حقول إضافية
  business_type?: string;
  suggestions?: string[];
  detected_location?: string;
  timestamp?: string;
  editable?: boolean;
  currency_info?: CurrencyInfo;
  total_estimated_value?: number;
  total_estimated_value_formatted?: string;
  image_quality_analysis?: ImageQualityAnalysis;
  edit_instructions?: {
    ar: string;
    en: string;
  };
}

// ✅ نتيجة التحليل الموسعة (API الجديد v5.2)
export interface EditableInventoryAnalysisResult extends InventoryAnalysisResult {
  editable: boolean;
  allow_price_editing: boolean;
  allow_quantity_editing: boolean;
  products: EditableProductItem[];
  edit_guide?: {
    ar: {
      title: string;
      fields: Record<string, string>;
      price_range_hint: string;
    };
    en: {
      title: string;
      fields: Record<string, string>;
      price_range_hint: string;
    };
  };
  _meta?: {
    engine: string;
    model: string;
    duration_ms: number;
    prices_fetched: boolean;
    unique_products: number;
    saved_api_calls: number;
    country_detected: string;
    images_processed?: number;
    images_failed?: number;
    multi_image?: boolean;
    image_optimization?: {
      total_original_size_kb: string;
      total_optimized_size_kb: string;
    };
    supported_features?: {
      all_image_formats: boolean;
      auto_conversion: boolean;
      price_caching: boolean;
      quality_analysis: boolean;
      condition_detection: boolean;
      multi_image_support: boolean;
    };
  };
}

// ✅ طلب التحليل (يدعم صورة واحدة أو عدة صور)
export interface AnalyzeRequest {
  image?: string;
  images?: string[];
  fetch_prices?: boolean;
  country_override?: string;
  session_id?: string;
}

// ✅ استجابة التحليل الكاملة (API v5.2)
export interface AnalyzeResponse {
  success: boolean;
  editable: boolean;
  business_type: string;
  analysis_quality: AnalysisQuality;
  detected_items_count: number;
  products: EditableProductItem[];
  warnings: string[];
  suggestions: string[];
  detected_location: string;
  timestamp: string;
  currency_info: CurrencyInfo;
  total_estimated_value: number;
  total_estimated_value_formatted: string;
  image_quality_analysis: ImageQualityAnalysis | null;
  edit_instructions: {
    ar: string;
    en: string;
  };
  _raw_ai_response?: {
    business_type: string;
    analysis_quality: string;
    warnings_count: number;
    suggestions_count: number;
  };
  _meta: {
    engine: string;
    model: string;
    duration_ms: number;
    prices_fetched: boolean;
    unique_products: number;
    saved_api_calls: number;
    country_detected: string;
    images_processed: number;
    images_failed: number;
    multi_image: boolean;
    image_optimization: {
      total_original_size_kb: string;
      total_optimized_size_kb: string;
    };
    supported_features: {
      all_image_formats: boolean;
      auto_conversion: boolean;
      price_caching: boolean;
      quality_analysis: boolean;
      condition_detection: boolean;
      multi_image_support: boolean;
    };
  };
}

// ============================================================
// Google Sheets والتصدير
// ============================================================

// ✅ طلب التصدير إلى Google Sheets
export interface ExportRequest {
  products: ProductItem[];
  invoiceTitle?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
  sheetName?: string;
}

// ✅ استجابة التصدير
export interface ExportResponse {
  success: boolean;
  message?: string;
  error?: string;
  sheetUrl?: string;
}

// ============================================================
// التعديلات اليدوية
// ============================================================

// ✅ طلب تحديث المنتج
export interface UpdateProductRequest {
  product_id?: number;
  product_name?: string;
  quantity?: number;
  unit_price?: number | null;
  condition?: ProductCondition;
  notes?: string;
}

// ✅ طلب حفظ التعديلات
export interface SaveEditsRequest {
  products: UpdateProductRequest[];
  session_id?: string;
  timestamp?: string;
}

// ✅ رد حفظ التعديلات
export interface SaveEditsResponse {
  success: boolean;
  message: string;
  updated_products: ProductItem[];
  new_total_value: number;
  new_total_formatted: string;
}

// ============================================================
// حالة الخادم (GET /api/analyze)
// ============================================================

// ✅ معلومات حالة الخادم
export interface ServerStatusResponse {
  status: "online";
  status_ar: string;
  engine: string;
  engine_ar: string;
  version: string;
  model: string;
  timestamp: string;
  editable_output: boolean;
  edit_instructions: {
    ar: string;
    en: string;
  };
  features: {
    auto_geo_detection: boolean;
    live_market_prices: boolean;
    batch_price_fetching: boolean;
    deduplication: boolean;
    exponential_backoff: boolean;
    arabic_first: boolean;
    zero_hallucination: boolean;
    manual_editing_support: boolean;
    all_image_formats: boolean;
    auto_image_conversion: boolean;
    price_caching: boolean;
    quality_analysis: boolean;
    condition_detection: boolean;
    expiry_detection: boolean;
    location_hints: boolean;
    multi_image_support: boolean;
    max_images_per_request: number;
  };
  supported_image_formats: string[];
  detected_context: {
    country: string;
    country_ar: string;
    currency: string;
    lang: string;
  };
  supported_industries: string[];
}

// ============================================================
// دوال مساعدة للتوافق بين الإصدارات
// ============================================================

// ✅ تحويل منتج من صيغة API القديم إلى الجديد
export function normalizeProduct(product: any): EditableProductItem {
  return {
    product_name: product.product_name || "منتج غير معروف",
    brand: product.brand || null,
    category: product.category || "عام",
    unit_price: typeof product.unit_price === "number" ? product.unit_price : 
                (product.unit_price ? parseFloat(product.unit_price) : null),
    quantity: typeof product.quantity === "number" ? product.quantity :
              (product.quantity ? parseInt(String(product.quantity)) : 1),
    barcode: product.barcode || product.barcode_serial || null,
    barcode_serial: product.barcode_serial || product.barcode || null,
    confidence: product.confidence || "medium",
    notes: product.notes || "",
    condition: product.condition || "unknown",
    expiry_date: product.expiry_date || null,
    location_hint: product.location_hint || null,
    editable_fields: ["quantity", "unit_price", "product_name", "notes", "condition"],
  };
}

// ✅ تحويل استجابة API القديم إلى الصيغة الجديدة
export function normalizeAnalysisResult(result: any): EditableInventoryAnalysisResult {
  const products = Array.isArray(result.products) 
    ? result.products.map(normalizeProduct)
    : [];

  return {
    success: result.success ?? true,
    products,
    total_products_detected: products.length,
    analysis_quality: result.analysis_quality || "good",
    warnings: result.warnings || [],
    business_type: result.business_type || "مخزون عام",
    suggestions: result.suggestions || [],
    detected_location: result.detected_location || "",
    timestamp: result.timestamp || new Date().toISOString(),
    editable: result.editable ?? true,
    allow_price_editing: true,
    allow_quantity_editing: true,
    currency_info: result.currency_info,
    total_estimated_value: result.total_estimated_value || 0,
    total_estimated_value_formatted: result.total_estimated_value_formatted || "0",
    image_quality_analysis: result.image_quality_analysis || null,
    edit_instructions: result.edit_instructions || {
      ar: "يمكنك تعديل الكمية والسعر والحالة يدوياً",
      en: "You can manually edit quantity, price and condition"
    },
    _meta: result._meta || {
      engine: "Universal Inventory Intelligence",
      model: "gemini-2.5-flash",
      duration_ms: 0,
      prices_fetched: false,
      unique_products: 0,
      saved_api_calls: 0,
      country_detected: "EG"
    }
  };
}