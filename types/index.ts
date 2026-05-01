// app/types.ts

export type Confidence = "high" | "medium" | "low";

// ✅ نوع حالة المنتج
export type ProductCondition = "good" | "damaged" | "expired" | "unknown";

// ✅ نوع جودة الصورة
export type LightingQuality = "excellent" | "good" | "poor";
export type AnalysisQuality = "excellent" | "good" | "fair" | "poor";

export interface ProductItem {
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: number | null; // السعر الحالي (يمكن تعديله يدوياً)
  quantity: number; // الكمية (يمكن تعديلها يدوياً)
  barcode_serial: string | null;
  confidence: Confidence;
  notes: string;
  // ✅ حقول جديدة من v5.2
  condition?: ProductCondition;      // حالة المنتج (جيد/تالف/منتهي)
  expiry_date?: string | null;       // تاريخ الصلاحية
  location_hint?: string | null;     // موقع المنتج في الرف
}

// ✅ جديد: تقدير السعر (نطاق مقترح)
export interface PriceEstimate {
  min_price: number | null;      // أقل سعر تقريبي
  max_price: number | null;      // أعلى سعر تقريبي
  suggested_price: number | null; // السعر المقترح (متوسط)
  confidence: "high" | "medium" | "low";
  source: string;                 // مصدر التقدير (market_data, similar_products, ai_estimate)
}

// ✅ جديد: منتج قابل للتعديل (يستخدم في الواجهة الأمامية)
export interface EditableProductItem extends ProductItem {
  original_price?: number | null;      // السعر الأصلي من AI (للرجوع)
  price_estimate?: PriceEstimate;      // تقدير السعر التقريبي
  is_edited?: boolean;                  // هل تم تعديله يدوياً؟
  last_modified?: string;               // تاريخ آخر تعديل
  editable_fields?: string[];           // الحقول القابلة للتعديل
}

// ✅ جديد: تحليل جودة الصورة
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

// ✅ جديد: معلومات العملة
export interface CurrencyInfo {
  code: string;
  symbol: string;
  nameEn: string;
  nameAr: string;
  exchangeRateToUSD: number;
}

// ✅ جديد: معلومات الموقع
export interface GeoContext {
  countryCode: string;
  countryNameAr: string;
  countryNameEn: string;
  currency: CurrencyInfo;
  lang: "ar" | "en";
}

// ✅ جديد: معلومات السعر
export interface PriceInfo {
  price: number | null;
  confidence: Confidence;
  source: string;
}

// ✅ الاستجابة الأساسية للتحليل
export interface InventoryAnalysisResult {
  success: boolean;
  business_type: string;
  analysis_quality: AnalysisQuality;
  detected_items_count: number;
  products: ProductItem[];
  warnings: string[];
  suggestions: string[];
  detected_location?: string;
  timestamp?: string;
  // ✅ حقول جديدة
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

// ✅ نتيجة التحليل الموسعة (مع دعم التعديل)
export interface EditableInventoryAnalysisResult extends InventoryAnalysisResult {
  editable: boolean;                     // هل النتيجة قابلة للتعديل؟
  allow_price_editing: boolean;         // السماح بتعديل الأسعار
  allow_quantity_editing: boolean;      // السماح بتعديل الكميات
  products: EditableProductItem[];      // منتجات قابلة للتعديل
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
    // ✅ حقول جديدة لتحليل الصور المتعددة
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
  image?: string;           // صورة واحدة (Base64 أو Data URL)
  images?: string[];        // عدة صور (Base64 أو Data URL)
  fetch_prices?: boolean;   // هل يجب جلب الأسعار؟
  country_override?: string; // تجاوز البلد المحدد (مثل "SA", "EG")
  session_id?: string;      // معرف الجلسة للتعديلات
}

// ✅ استجابة التحليل الكاملة (من API v5.2)
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

// ✅ طلب التصدير إلى Google Sheets
export interface ExportRequest {
  products: ProductItem[];
  invoiceTitle?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
  sheetName?: string;
}

// ✅ طلب تحديث المنتج (لحفظ التعديلات)
export interface UpdateProductRequest {
  product_id?: number;              // معرف المنتج (إذا كان هناك)
  product_name?: string;
  quantity?: number;
  unit_price?: number | null;
  condition?: ProductCondition;
  notes?: string;
}

// ✅ طلب حفظ التعديلات (للـ API)
export interface SaveEditsRequest {
  products: UpdateProductRequest[];
  session_id?: string;              // معرف الجلسة
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

// ✅ معلومات حالة الخادم (GET /api/analyze)
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