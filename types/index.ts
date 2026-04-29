
export type Confidence = "high" | "medium" | "low";

export interface ProductItem {
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: number | null; // تم تغيير النوع إلى number ليتوافق مع العمليات الحسابية
  quantity: number; // تم تغيير النوع إلى number
  barcode_serial: string | null; // تم دمج الباركود والرقم التسلسلي والموديل
  confidence: Confidence;
  notes: string;
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

export interface ExportRequest {
  products: ProductItem[];
  // يمكن إضافة حقول أخرى مثل اسم العميل، رقم الفاتورة، إلخ.
  invoiceTitle?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
}