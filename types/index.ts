// app/types.ts

export type Confidence = "high" | "medium" | "low";

// --- Enums لضمان توافق المحرك الخامس ---
export type FallbackLevel = 1 | 2 | 3 | 4 | 5;
export type DetectionMethod = "ocr_only" | "visual_match" | "barcode_match" | "multimodal_match";

// ✅ ProductItem الأساسي (متوافق مع API الفعلي)
export interface ProductItem {
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: number | null;
  quantity: number;
  barcode: string;                    // ✅ API يرسل barcode
  barcode_serial: string;             // ✅ API يرسل barcode_serial أيضاً
  confidence: Confidence;
  notes: string;
  
  // ✅ حقول اختيارية من API
  id?: number;
  fallback_level?: FallbackLevel;
  detection_method?: DetectionMethod;
  confidence_score?: number;
  image_region?: string;
  is_estimated?: boolean;
  compliance_flags?: string[];
}

// ✅ تقدير السعر (نطاق مقترح)
export interface PriceEstimate {
  min_price: number | null;
  max_price: number | null;
  suggested_price: number | null;
  confidence: Confidence;
  source: string;
}

// ✅ منتج قابل للتعديل (يستخدم في الواجهة الأمامية)
export interface EditableProductItem extends ProductItem {
  original_price?: number | null;
  price_estimate?: PriceEstimate;
  is_edited?: boolean;
  last_modified?: string;
  editable_fields?: string[];
  
  shelf_position?: string;
  uncertainty_type?: string;
}

// ✅ نتيجة التحليل الأساسية (من API)
export interface InventoryAnalysisResult {
  success: boolean;
  editable: boolean;
  business_type: string;
  analysis_quality: "excellent" | "good" | "fair" | "poor";
  detected_items_count: number;
  products: ProductItem[];
  warnings: string[];
  suggestions: string[];
  detected_location?: string;
  timestamp?: string;
  
  // حقول إضافية من API
  total_estimated_value: number;
  total_estimated_value_formatted: string;
  currency_info: {
    code: string;
    symbol: string;
    name: string;
    exchange_rate_to_usd: number;
  };
  image_quality_analysis?: {
    has_barcodes: boolean;
    has_qr_codes: boolean;
    has_prices_on_shelves: boolean;
    image_quality_score: number;
    lighting_quality: string;
    suggested_improvements: string[];
  } | null;
  _meta?: {
    engine: string;
    model: string;
    duration_ms: number;
    prices_fetched: boolean;
    unique_products: number;
    saved_api_calls: number;
    country_detected: string;
  };
}

// ✅ نتيجة التحليل الموسعة (مع دعم التعديل)
export interface EditableInventoryAnalysisResult extends InventoryAnalysisResult {
  editable: boolean;
  allow_price_editing: boolean;
  allow_quantity_editing: boolean;
  products: EditableProductItem[];
  
  summary_metrics?: {
    high_confidence_count: number;
    compliance_issues_count: number;
    manual_review_required_count: number;
    inventory_density: "low" | "medium" | "high";
  };

  edit_instructions?: {
    ar: string;
    en: string;
  };
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
}

// ✅ طلب التصدير
export interface ExportRequest {
  products: ProductItem[];
  invoiceTitle?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
}

// ✅ طلب تحديث المنتج
export interface UpdateProductRequest {
  product_id?: number;
  product_name?: string;
  quantity?: number;
  unit_price?: number | null;
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
// ✅ دوال مساعدة للتحويل بين الأنواع
// ============================================================

/**
 * تحويل ProductItem من API إلى EditableProductItem
 */
export function toEditableProduct(product: ProductItem, index?: number): EditableProductItem {
  return {
    ...product,
    id: product.id ?? index ?? 0,
    fallback_level: product.fallback_level ?? 2,
    detection_method: product.detection_method ?? "multimodal_match",
    confidence_score: product.confidence_score ?? (product.confidence === "high" ? 0.9 : product.confidence === "medium" ? 0.7 : 0.4),
    image_region: product.image_region ?? "middle-center",
    is_estimated: product.is_estimated ?? false,
    compliance_flags: product.compliance_flags ?? [],
    editable_fields: ["quantity", "unit_price", "product_name", "notes", "brand", "category", "barcode"],
    original_price: product.unit_price,
    is_edited: false,
  };
}

/**
 * تحويل EditableProductItem إلى UpdateProductRequest
 */
export function toUpdateRequest(product: EditableProductItem): UpdateProductRequest {
  return {
    product_id: product.id,
    product_name: product.product_name,
    quantity: product.quantity,
    unit_price: product.unit_price,
    notes: product.notes,
  };
}

/**
 * حساب إجمالي قيمة المنتجات
 */
export function calculateTotalValue(products: ProductItem[]): number {
  return products.reduce((sum, p) => {
    return p.unit_price ? sum + p.unit_price * (p.quantity || 1) : sum;
  }, 0);
}

/**
 * تنسيق القيمة كعملة
 */
export function formatTotalValue(total: number, currencySymbol: string = "$"): string {
  return `${currencySymbol}${total.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * إنشاء ProductItem جديد فارغ
 */
export function createEmptyProduct(): ProductItem {
  return {
    product_name: "منتج جديد",
    brand: null,
    category: "عام",
    unit_price: null,
    quantity: 1,
    barcode: "",
    barcode_serial: "",
    confidence: "medium",
    notes: "",
  };
}

/**
 * نسخ ProductItem للتعديل
 */
export function copyProduct(product: ProductItem): ProductItem {
  return {
    ...product,
    product_name: product.product_name,
    brand: product.brand,
    category: product.category,
    unit_price: product.unit_price,
    quantity: product.quantity,
    barcode: product.barcode,
    barcode_serial: product.barcode_serial,
    confidence: product.confidence,
    notes: product.notes,
  };
}

/**
 * التحقق من صحة ProductItem
 */
export function isValidProduct(product: ProductItem): boolean {
  return !!(product.product_name && product.product_name.trim().length > 0);
}

/**
 * الحصول على نطاق ثقة readable
 */
export function getConfidenceLabel(confidence: Confidence, lang: "ar" | "en" = "ar"): string {
  const labels = {
    high: { ar: "دقة عالية", en: "High" },
    medium: { ar: "دقة متوسطة", en: "Medium" },
    low: { ar: "دقة منخفضة", en: "Low" },
  };
  return labels[confidence][lang];
}

/**
 * الحصول على لون الثقة للـ UI
 */
export function getConfidenceColor(confidence: Confidence): string {
  const colors = {
    high: "#10b981",  // أخضر
    medium: "#f59e0b", // برتقالي
    low: "#ef4444",    // أحمر
  };
  return colors[confidence];
}

/**
 * تصفية المنتجات حسب الثقة
 */
export function filterByConfidence(products: ProductItem[], minConfidence: Confidence): ProductItem[] {
  const order: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const minLevel = order[minConfidence];
  return products.filter(p => order[p.confidence] >= minLevel);
}

/**
 * إحصائيات المنتجات
 */
export interface ProductStats {
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  totalValue: number;
  uniqueBrands: number;
  uniqueCategories: number;
  estimatedCount: number;
  manualReviewNeeded: number;
}

/**
 * حساب إحصائيات المنتجات
 */
export function getProductStats(products: ProductItem[]): ProductStats {
  return {
    total: products.length,
    highConfidence: products.filter(p => p.confidence === "high").length,
    mediumConfidence: products.filter(p => p.confidence === "medium").length,
    lowConfidence: products.filter(p => p.confidence === "low").length,
    totalValue: calculateTotalValue(products),
    uniqueBrands: new Set(products.map(p => p.brand).filter(Boolean)).size,
    uniqueCategories: new Set(products.map(p => p.category).filter(Boolean)).size,
    estimatedCount: products.filter(p => p.is_estimated).length,
    manualReviewNeeded: products.filter(p => p.compliance_flags?.includes("manual_review_needed")).length,
  };
}