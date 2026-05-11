// app/types.ts

export type Confidence = "high" | "medium" | "low";

// --- Enums لضمان توافق المحرك الخامس ---
export type FallbackLevel = 1 | 2 | 3 | 4 | 5;
export type DetectionMethod = "ocr_only" | "visual_match" | "barcode_match" | "multimodal_match";

export interface ProductItem {
  id: number; // معرف فريد لكل عنصر في الجلسة
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: number | null; 
  quantity: number; 
  barcode_serial: string | null;
  confidence: Confidence;
  notes: string;
  
  // ✅ إضافات MEIVE-5 الأساسية (للتوافق مع المحرك)
  fallback_level: FallbackLevel;         // مستوى التراجع الهرمي
  detection_method: DetectionMethod;    // طريقة الاكتشاف
  confidence_score: number;             // درجة الثقة من 0.0 إلى 1.0
  image_region: string;                 // مكان المنتج (top-left, middle, etc.)
  is_estimated: boolean;                // هل الكمية تقديرية (بسبب وجود عناصر مخفية)
  compliance_flags: string[];           // مخالفات الامتثال (تالف، ناقص، بدون باركود)
}

// ✅ جديد: تقدير السعر (نطاق مقترح)
export interface PriceEstimate {
  min_price: number | null;      
  max_price: number | null;      
  suggested_price: number | null; 
  confidence: Confidence;
  source: string;                 
}

// ✅ جديد: منتج قابل للتعديل (يستخدم في الواجهة الأمامية)
export interface EditableProductItem extends ProductItem {
  original_price?: number | null;      
  price_estimate?: PriceEstimate;      
  is_edited?: boolean;                  
  last_modified?: string;               
  editable_fields?: string[];           
  
  // ✅ بيانات إضافية من MEIVE-5 للواجهة
  shelf_position?: string;              // وضعية الرف (top, middle, bottom)
  uncertainty_type?: string;            // سبب عدم التأكد (blur, occlusion)
}

export interface InventoryAnalysisResult {
  business_type: string;
  analysis_quality: "excellent" | "good" | "fair" | "poor";
  detected_items_count: number;
  products: ProductItem[];
  warnings: string[];
  suggestions: string[];
  detected_location?: string;
  timestamp?: string;
}

// ✅ جديد: نتيجة التحليل الموسعة (مع دعم التعديل وتوافق MEIVE-5)
export interface EditableInventoryAnalysisResult extends InventoryAnalysisResult {
  editable: boolean;                     
  allow_price_editing: boolean;         
  allow_quantity_editing: boolean;      
  products: EditableProductItem[];      
  currency_info: {
    code: string;
    symbol: string;
    name: string;
    exchange_rate_to_usd: number;
  };
  
  // ✅ تحليل إحصائي متقدم من المحرك الخامس
  summary_metrics: {
    high_confidence_count: number;
    compliance_issues_count: number;
    manual_review_required_count: number;
    inventory_density: "low" | "medium" | "high";
  };

  total_estimated_value: number;
  total_estimated_value_formatted: string;
  edit_instructions: {
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
  
  _meta?: {
    engine: string;           // سيكتب هنا "MEIVE-5"
    model: string;
    duration_ms: number;
    prices_fetched: boolean;
    unique_products: number;
    saved_api_calls: number;
    country_detected: string;
    image_quality_score: string; // جودة الصورة الملتقطة
  };
}

export interface ExportRequest {
  products: ProductItem[];
  invoiceTitle?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
}

// ✅ جديد: طلب تحديث المنتج (لحفظ التعديلات)
export interface UpdateProductRequest {
  product_id?: number;              
  product_name?: string;
  quantity?: number;
  unit_price?: number | null;
  notes?: string;
}

// ✅ جديد: طلب حفظ التعديلات (للـ API)
export interface SaveEditsRequest {
  products: UpdateProductRequest[];
  session_id?: string;              
  timestamp?: string;
}

// ✅ جديد: رد حفظ التعديلات
export interface SaveEditsResponse {
  success: boolean;
  message: string;
  updated_products: ProductItem[];
  new_total_value: number;
  new_total_formatted: string;
}