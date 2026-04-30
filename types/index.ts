// app/types.ts

export type Confidence = "high" | "medium" | "low";

export interface ProductItem {
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: number | null; // السعر الحالي (يمكن تعديله يدوياً)
  quantity: number; // الكمية (يمكن تعديلها يدوياً)
  barcode_serial: string | null;
  confidence: Confidence;
  notes: string;
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

// ✅ جديد: نتيجة التحليل الموسعة (مع دعم التعديل)
export interface EditableInventoryAnalysisResult extends InventoryAnalysisResult {
  editable: boolean;                     // هل النتيجة قابلة للتعديل؟
  allow_price_editing: boolean;         // السماح بتعديل الأسعار
  allow_quantity_editing: boolean;      // السماح بتعديل الكميات
  products: EditableProductItem[];      // منتجات قابلة للتعديل
  currency_info: {
    code: string;
    symbol: string;
    name: string;
    exchange_rate_to_usd: number;
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
    engine: string;
    model: string;
    duration_ms: number;
    prices_fetched: boolean;
    unique_products: number;
    saved_api_calls: number;
    country_detected: string;
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
  product_id?: number;              // معرف المنتج (إذا كان هناك)
  product_name?: string;
  quantity?: number;
  unit_price?: number | null;
  notes?: string;
}

// ✅ جديد: طلب حفظ التعديلات (للـ API)
export interface SaveEditsRequest {
  products: UpdateProductRequest[];
  session_id?: string;              // معرف الجلسة
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