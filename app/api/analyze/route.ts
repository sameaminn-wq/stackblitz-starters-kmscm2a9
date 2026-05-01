"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// Types
// ============================================================
type Confidence = "high" | "medium" | "low";
type AnalysisQuality = "excellent" | "good" | "partial" | "failed";
type ProductCondition = "good" | "damaged" | "expired" | "unknown";

interface ProductItem {
  product_name: string;
  brand: string | null;
  category: string;
  unit_price: number | null;
  quantity: number;
  barcode: string | null;
  confidence: Confidence;
  notes: string;
  condition?: ProductCondition;
  expiry_date?: string | null;
  location_hint?: string | null;
}

interface AnalysisResult {
  success: boolean;
  products: ProductItem[];
  total_products_detected: number;
  analysis_quality: AnalysisQuality;
  warnings: string[];
  image_quality_analysis?: any;
  total_estimated_value?: number;
  total_estimated_value_formatted?: string;
  currency_info?: {
    code: string;
    symbol: string;
    name: string;
  };
}

// ============================================================
// دالة تنظيف النصوص (XSS Prevention)
// ============================================================
function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// دالة تحويل من API إلى Frontend
// ============================================================
function normalizeProduct(apiProduct: any): ProductItem {
  return {
    product_name: escapeHtml(apiProduct.product_name) || "منتج غير معروف",
    brand: apiProduct.brand ? escapeHtml(apiProduct.brand) : null,
    category: escapeHtml(apiProduct.category) || "عام",
    unit_price: typeof apiProduct.unit_price === 'number' ? apiProduct.unit_price : null,
    quantity: typeof apiProduct.quantity === 'number' ? apiProduct.quantity : 1,
    barcode: apiProduct.barcode_serial || apiProduct.barcode || null,
    confidence: ["high", "medium", "low"].includes(apiProduct.confidence) ? apiProduct.confidence : "medium",
    notes: escapeHtml(apiProduct.notes) || "",
    condition: apiProduct.condition || "unknown",
    expiry_date: apiProduct.expiry_date || null,
    location_hint: apiProduct.location_hint ? escapeHtml(apiProduct.location_hint) : null,
  };
}

// ============================================================
// Sub-components
// ============================================================

function ConfidenceBadge({ level }: { level: Confidence }) {
  const map: Record<Confidence, { label: string; class: string }> = {
    high: { label: "دقة عالية", class: "badge-success" },
    medium: { label: "دقة متوسطة", class: "badge-warning" },
    low: { label: "دقة منخفضة", class: "badge-danger" },
  };
  const { label, class: cls } = map[level] ?? map.medium;
  return React.createElement("span", { className: `badge ${cls}` }, label);
}

function ConditionBadge({ condition }: { condition?: ProductCondition }) {
  if (!condition || condition === "unknown") return null;
  
  const map: Record<ProductCondition, { label: string; class: string; icon: string }> = {
    good: { label: "جيد", class: "badge-success", icon: "✅" },
    damaged: { label: "تالف", class: "badge-danger", icon: "⚠️" },
    expired: { label: "منتهي الصلاحية", class: "badge-danger", icon: "🔴" },
    unknown: { label: "غير معروف", class: "badge-warning", icon: "❓" },
  };
  const { label, class: cls, icon } = map[condition];
  return React.createElement("span", { className: `badge ${cls}` }, `${icon} ${label}`);
}

function QualityBar({ quality }: { quality: AnalysisQuality }) {
  const map: Record<AnalysisQuality, { label: string; width: string; color: string }> = {
    excellent: { label: "ممتاز", width: "100%", color: "#10b981" },
    good: { label: "جيد", width: "75%", color: "#3b82f6" },
    partial: { label: "جزئي", width: "45%", color: "#f59e0b" },
    failed: { label: "فشل", width: "10%", color: "#ef4444" },
  };
  const { label, width, color } = map[quality] ?? map.good;
  return React.createElement("div", { className: "quality-bar-wrapper" },
    React.createElement("span", { className: "quality-label" }, `جودة التحليل: ${label}`),
    React.createElement("div", { className: "quality-track" },
      React.createElement("div", { className: "quality-fill", style: { width, background: color } })
    )
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return React.createElement("div", { className: "stat-card" },
    React.createElement("span", { className: "stat-icon" }, icon),
    React.createElement("span", { className: "stat-value" }, value),
    React.createElement("span", { className: "stat-label" }, label)
  );
}

// ============================================================
// ProductCard Component
// ============================================================
function ProductCard({
  item,
  index,
  onChange,
  onDelete,
  currencySymbol,
}: {
  item: ProductItem;
  index: number;
  onChange: (idx: number, field: keyof ProductItem, value: string | number | null) => void;
  onDelete: (idx: number) => void;
  currencySymbol: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const formatPrice = (price: number | null) => {
    if (price === null || price === 0) return "—";
    return `${price} ${currencySymbol}`;
  };

  return React.createElement("div", { className: "product-card" },
    React.createElement("div", { className: "product-card-header", onClick: () => setExpanded(!expanded) },
      React.createElement("div", { className: "product-card-left" },
        React.createElement("div", { className: "product-index" }, `#${index + 1}`),
        React.createElement("div", {},
          React.createElement("div", { className: "product-name" }, item.product_name || "منتج غير معروف"),
          React.createElement("div", { className: "product-meta" },
            item.brand && React.createElement("span", { className: "chip chip-brand" }, item.brand),
            item.category && React.createElement("span", { className: "chip chip-cat" }, item.category),
            React.createElement(ConditionBadge, { condition: item.condition })
          )
        )
      ),
      React.createElement("div", { className: "product-card-right" },
        React.createElement(ConfidenceBadge, { level: item.confidence }),
        React.createElement("span", { className: "expand-icon" }, expanded ? "▲" : "▼")
      )
    ),
    React.createElement("div", { className: "product-quick-stats" },
      React.createElement("div", { className: "quick-stat" },
        React.createElement("span", { className: "qs-label" }, "الكمية"),
        React.createElement("span", { className: "qs-value" }, item.quantity || "—")
      ),
      React.createElement("div", { className: "quick-stat" },
        React.createElement("span", { className: "qs-label" }, "السعر"),
        React.createElement("span", { className: "qs-value" }, formatPrice(item.unit_price))
      ),
      item.barcode && React.createElement("div", { className: "quick-stat" },
        React.createElement("span", { className: "qs-label" }, "باركود"),
        React.createElement("span", { className: "qs-value barcode" }, item.barcode)
      ),
      item.expiry_date && React.createElement("div", { className: "quick-stat" },
        React.createElement("span", { className: "qs-label" }, "تاريخ الصلاحية"),
        React.createElement("span", { className: "qs-value" }, item.expiry_date)
      )
    ),
    expanded && React.createElement("div", { className: "product-edit-section" },
      React.createElement("div", { className: "edit-grid" },
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "اسم المنتج"),
          React.createElement("input", { className: "edit-input", value: item.product_name, onChange: (e) => onChange(index, "product_name", e.target.value), dir: "rtl" })
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "الماركة"),
          React.createElement("input", { className: "edit-input", value: item.brand || "", onChange: (e) => onChange(index, "brand", e.target.value), dir: "rtl" })
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "التصنيف"),
          React.createElement("input", { className: "edit-input", value: item.category, onChange: (e) => onChange(index, "category", e.target.value), dir: "rtl" })
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, `السعر (${currencySymbol})`),
          React.createElement("input", { type: "number", className: "edit-input", value: item.unit_price ?? "", onChange: (e) => onChange(index, "unit_price", e.target.value === "" ? null : Number(e.target.value)), dir: "ltr" })
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "الكمية"),
          React.createElement("input", { type: "number", className: "edit-input", value: item.quantity, onChange: (e) => onChange(index, "quantity", Number(e.target.value)), dir: "ltr" })
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "الباركود"),
          React.createElement("input", { className: "edit-input", value: item.barcode || "", onChange: (e) => onChange(index, "barcode", e.target.value), dir: "ltr" })
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "الحالة"),
          React.createElement("select", { className: "edit-input", value: item.condition || "unknown", onChange: (e) => onChange(index, "condition", e.target.value) },
            React.createElement("option", { value: "good" }, "✅ جيد"),
            React.createElement("option", { value: "damaged" }, "⚠️ تالف"),
            React.createElement("option", { value: "expired" }, "🔴 منتهي الصلاحية"),
            React.createElement("option", { value: "unknown" }, "❓ غير معروف")
          )
        ),
        React.createElement("div", { className: "edit-field" },
          React.createElement("label", { className: "edit-label" }, "تاريخ الصلاحية"),
          React.createElement("input", { type: "date", className: "edit-input", value: item.expiry_date || "", onChange: (e) => onChange(index, "expiry_date", e.target.value), dir: "ltr" })
        )
      ),
      item.location_hint && React.createElement("div", { className: "notes-row" },
        React.createElement("span", { className: "notes-icon" }, "📍"),
        React.createElement("span", { className: "notes-text" }, item.location_hint)
      ),
      item.notes && React.createElement("div", { className: "notes-row" },
        React.createElement("span", { className: "notes-icon" }, "ℹ"),
        React.createElement("span", { className: "notes-text" }, item.notes)
      ),
      React.createElement("button", { className: "delete-btn", onClick: () => onDelete(index) }, "حذف هذا المنتج")
    )
  );
}

// ============================================================
// ImageCapture Component
// ============================================================
function ImageCapture({ onCapture, onCaptureMultiple, disabled }: { 
  onCapture: (img: string) => void; 
  onCaptureMultiple?: (imgs: string[]) => void;
  disabled: boolean; 
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  const readFiles = (files: FileList) => {
    const fileArray = Array.from(files);
    setSelectedCount(fileArray.length);
    
    if (fileArray.length === 1) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) onCapture(e.target.result as string);
        setTimeout(() => setSelectedCount(0), 2000);
      };
      reader.readAsDataURL(fileArray[0]);
    } else if (fileArray.length > 1 && onCaptureMultiple) {
      Promise.all(
        fileArray.map((file) => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.readAsDataURL(file);
          });
        })
      ).then((images) => {
        onCaptureMultiple(images);
        setTimeout(() => setSelectedCount(0), 2000);
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      readFiles(files);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) onCapture(ev.target.result as string);
      };
      reader.readAsDataURL(file);
    }
    if (cameraRef.current) cameraRef.current.value = "";
  };

  return React.createElement("div", { className: "capture-zone" },
    React.createElement("div", { className: "capture-icon" }, "📷"),
    React.createElement("p", { className: "capture-title" }, "التقط صورة الرف أو ارفع صورة"),
    React.createElement("p", { className: "capture-sub" }, "JPEG · PNG · WEBP · حتى 10MB (يدعم عدة صور)"),
    React.createElement("p", { className: "capture-sub", style: { fontSize: "0.7rem", color: "#60a5fa", marginTop: "-0.5rem" } }, "💡 يمكنك اختيار عدة صور مرة واحدة (Ctrl + Click أو Shift + Click)"),
    React.createElement("div", { className: "capture-buttons" },
      React.createElement("button", { className: "btn btn-primary", disabled: disabled, onClick: () => cameraRef.current?.click() }, "📸 كاميرا"),
      React.createElement("button", { className: "btn btn-secondary", disabled: disabled, onClick: () => fileRef.current?.click() }, "📁 رفع صور (يدعم متعدد)")
    ),
    React.createElement("input", { ref: fileRef, type: "file", accept: "image/*", multiple: true, className: "hidden", onChange: handleFileChange }),
    React.createElement("input", { ref: cameraRef, type: "file", accept: "image/*", capture: "environment", className: "hidden", onChange: handleCameraChange }),
    selectedCount > 0 && React.createElement("div", { style: { marginTop: "1rem", padding: "0.5rem", background: selectedCount === 1 ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)", borderRadius: "10px", fontSize: "0.75rem", color: selectedCount === 1 ? "#34d399" : "#60a5fa" } },
      selectedCount === 1 ? "✅ تم اختيار صورة واحدة للتحليل" : `✅ تم اختيار ${selectedCount} صور للتحليل المتزامن`
    )
  );
}

// ============================================================
// VideoCapture Component (مبسط لتجنب الأخطاء)
// ============================================================
function VideoCapture({ onCapture, disabled }: { onCapture: (img: string) => void; disabled: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) onCapture(ev.target.result as string);
      };
      reader.readAsDataURL(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return React.createElement("div", { style: { marginTop: "0.75rem" } },
    React.createElement("button", { className: "btn btn-secondary", disabled: disabled, onClick: () => fileRef.current?.click(), style: { width: "100%", justifyContent: "center", gap: "0.5rem", padding: "0.7rem" } }, "📁 رفع صورة (بديل الكاميرا)"),
    React.createElement("input", { ref: fileRef, type: "file", accept: "image/*", className: "hidden", onChange: handleFileChange })
  );
}

// ============================================================
// نظام العملات
// ============================================================
interface Currency {
  code: string;
  symbol: string;
  name: string;
  flag: string;
}

const CURRENCIES: Currency[] = [
  { code: "EGP", symbol: "ج.م", name: "جنيه مصري", flag: "🇪🇬" },
  { code: "SAR", symbol: "ر.س", name: "ريال سعودي", flag: "🇸🇦" },
  { code: "AED", symbol: "د.إ", name: "درهم إماراتي", flag: "🇦🇪" },
  { code: "USD", symbol: "$", name: "دولار أمريكي", flag: "🇺🇸" },
  { code: "EUR", symbol: "€", name: "يورو", flag: "🇪🇺" },
];

// ============================================================
// Invoice Functions
// ============================================================
function generateInvoiceHTML(products: ProductItem[], currency: Currency, clientName: string): string {
  const total = products.reduce((sum, p) => sum + (p.unit_price || 0) * p.quantity, 0);
  const rows = products.map((p, i) => {
    const safeName = escapeHtml(p.product_name);
    const safeBrand = escapeHtml(p.brand || "—");
    const safeCategory = escapeHtml(p.category || "—");
    return `<tr><td>${i + 1}</td><td>${safeName}</td><td>${safeBrand}</td><td>${safeCategory}</td><td>${p.quantity}</td><td>${p.unit_price || 0} ${currency.symbol}</td><td>${((p.unit_price || 0) * p.quantity)} ${currency.symbol}</td></tr>`;
  }).join("");
  
  return `<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="UTF-8"><title>فاتورة الجرد</title>
<style>
  body{font-family:Arial;padding:2rem;direction:rtl}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ddd;padding:8px;text-align:right}
  th{background:#f2f2f2}
  .total{font-size:1.2rem;font-weight:bold;margin-top:1rem}
  button{margin-top:1rem;padding:0.5rem 1rem;background:#2563eb;color:white;border:none;border-radius:8px;cursor:pointer}
</style>
</head>
<body>
<h2>فاتورة جرد المخزون</h2>
<p><strong>العميل:</strong> ${escapeHtml(clientName)}</p>
<p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-EG")}</p>
<table><thead><tr><th>#</th><th>المنتج</th><th>الماركة</th><th>التصنيف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="total">الإجمالي النهائي: ${total} ${currency.symbol}</div>
<button onclick="window.print()">🖨️ طباعة</button>
</body>
</html>`;
}

// ============================================================
// Main Component
// ============================================================
export default function InventoryScannerPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isAnalyzingMultiple, setIsAnalyzingMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]);
  const [processingImagesCount, setProcessingImagesCount] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem("inv_spreadsheet_id");
    if (saved) setSpreadsheetId(saved);
    const savedCurrency = localStorage.getItem("inv_currency");
    if (savedCurrency) {
      const found = CURRENCIES.find(c => c.code === savedCurrency);
      if (found) setCurrency(found);
    }
  }, []);

  // دالة موحدة لمعالجة الصور
  const sendImagesToAPI = useCallback(async (images: string[]) => {
    if (images.length === 0) return null;
    
    setPreviewImages(images);
    setProcessingImagesCount(images.length);
    const isMultiple = images.length > 1;
    if (isMultiple) setIsAnalyzingMultiple(true);
    setLoading(true);
    setError(null);
    setResult(null);
    setExportSuccess(false);
    setAnalysisProgress(0);

    const progressInterval = setInterval(() => {
      setAnalysisProgress(prev => Math.min(prev + 10, 90));
    }, 1500);

    try {
      console.log(`📸 جاري تحليل ${images.length} صور...`);
      
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: images, fetch_prices: true }),
      });

      clearInterval(progressInterval);
      setAnalysisProgress(100);

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `خطأ ${res.status}`);
      }

      const normalizedProducts = (data.products || []).map(normalizeProduct);
      
      setResult({
        success: true,
        products: normalizedProducts,
        total_products_detected: normalizedProducts.length,
        analysis_quality: data.analysis_quality || "good",
        warnings: data.warnings || [],
        image_quality_analysis: data.image_quality_analysis,
        total_estimated_value: data.total_estimated_value,
        total_estimated_value_formatted: data.total_estimated_value_formatted,
        currency_info: data.currency_info,
      });
      
      console.log(`✅ تم تحليل ${images.length} صور، تم اكتشاف ${normalizedProducts.length} منتج`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ غير متوقع");
    } finally {
      setLoading(false);
      setIsAnalyzingMultiple(false);
      setAnalysisProgress(0);
    }
  }, []);

  const handleCapture = useCallback((imageData: string) => sendImagesToAPI([imageData]), [sendImagesToAPI]);
  const handleCaptureMultiple = useCallback((imagesData: string[]) => sendImagesToAPI(imagesData), [sendImagesToAPI]);

  const removePreviewImage = (index: number) => {
    setPreviewImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllImages = () => {
    setPreviewImages([]);
    setResult(null);
    setError(null);
  };

  const handleFieldChange = useCallback((idx: number, field: keyof ProductItem, value: string | number | null) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updated = [...prev.products];
      updated[idx] = { ...updated[idx], [field]: value as any };
      return { ...prev, products: updated, total_products_detected: updated.length };
    });
  }, []);

  const handleDelete = useCallback((idx: number) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updated = prev.products.filter((_, i) => i !== idx);
      return { ...prev, products: updated, total_products_detected: updated.length };
    });
  }, []);

  const handleExport = async () => {
    if (!result || result.products.length === 0) return;
    if (!spreadsheetId.trim()) {
      setShowSettings(true);
      setError("الرجاء إدخال رابط Google Sheets أولاً");
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId: spreadsheetId.trim(), products: result.products }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setExportSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ في التصدير");
    } finally {
      setExporting(false);
    }
  };

  const handleSaveSettings = () => {
    if (!spreadsheetId.trim()) return;
    localStorage.setItem("inv_spreadsheet_id", spreadsheetId);
    localStorage.setItem("inv_currency", currency.code);
    setShowSettings(false);
    setError(null);
  };

  const handleAddProduct = useCallback(() => {
    const newItem: ProductItem = {
      product_name: "منتج جديد",
      brand: null,
      category: "عام",
      unit_price: null,
      quantity: 1,
      barcode: null,
      confidence: "high",
      notes: "",
      condition: "unknown",
      expiry_date: null,
      location_hint: null,
    };
    setResult((prev) => {
      const existing = prev?.products ?? [];
      return {
        success: true,
        products: [newItem, ...existing],
        total_products_detected: existing.length + 1,
        analysis_quality: prev?.analysis_quality ?? "good",
        warnings: prev?.warnings ?? [],
      };
    });
  }, []);

  const handleReset = () => {
    const hasUnsaved = result && result.products.length > 0 && !exportSuccess;
    if (hasUnsaved && !window.confirm(`⚠️ يوجد ${result.products.length} منتج لم يتم ترحيله. هل أنت متأكد؟`)) return;
    setResult(null);
    setPreviewImages([]);
    setError(null);
    setExportSuccess(false);
    setProcessingImagesCount(0);
    setAnalysisProgress(0);
  };

  const handlePrintInvoice = () => {
    if (!result || result.products.length === 0) return;
    const name = prompt("الرجاء إدخال اسم العميل:", "العميل");
    if (name) {
      const html = generateInvoiceHTML(result.products, currency, name);
      const win = window.open("", "_blank");
      if (win) { win.document.write(html); win.document.close(); }
    }
  };

  const highConfidence = result?.products.filter(p => p.confidence === "high").length ?? 0;
  const totalValue = result?.products.reduce((sum, p) => sum + (p.unit_price || 0) * p.quantity, 0) ?? 0;

  if (!isMounted) return null;

  const isLoading = loading || isAnalyzingMultiple;
  const loadingText = isAnalyzingMultiple ? `جاري تحليل ${processingImagesCount} صور...` : "جاري تحليل الرفوف...";

  return React.createElement("div", { className: "scanner-root" },
    React.createElement("style", null, `
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Cairo','Segoe UI',sans-serif;direction:rtl;background:#0a0e1a;color:#e2e8f0}
      .scanner-root{min-height:100vh;background:linear-gradient(135deg,#0a0e1a,#0f1628,#0a1224);padding-bottom:4rem}
      .header{background:linear-gradient(180deg,rgba(15,22,44,0.98),rgba(10,14,26,0.95));border-bottom:1px solid rgba(99,157,255,0.15);padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
      .header-logo{width:38px;height:38px;background:linear-gradient(135deg,#3b82f6,#6366f1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
      .header-title{font-size:1.1rem;font-weight:700}
      .main{max-width:700px;margin:0 auto;padding:1.5rem 1rem}
      .capture-zone{border:2px dashed rgba(99,157,255,0.25);border-radius:20px;padding:2rem 1.5rem;text-align:center;background:rgba(15,22,44,0.5)}
      .capture-icon{font-size:3rem;margin-bottom:0.75rem}
      .capture-title{font-size:1rem;font-weight:600;margin-bottom:0.3rem}
      .capture-sub{font-size:0.75rem;color:#475569;margin-bottom:1.5rem}
      .capture-buttons{display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap}
      .btn{display:inline-flex;align-items:center;gap:0.4rem;padding:0.65rem 1.4rem;border-radius:12px;font-weight:600;border:none;cursor:pointer;font-family:inherit}
      .btn:disabled{opacity:0.5;cursor:not-allowed}
      .btn-primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff}
      .btn-secondary{background:rgba(30,40,65,0.8);color:#94a3b8;border:1px solid rgba(99,157,255,0.2)}
      .btn-export{width:100%;padding:1rem;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-radius:16px}
      .btn-reset{width:100%;padding:0.75rem;background:transparent;color:#64748b;border:1px solid rgba(100,116,139,0.2);border-radius:12px;margin-top:0.5rem}
      .images-preview-grid{background:rgba(15,22,44,0.5);border-radius:16px;padding:1rem;margin-bottom:1rem;border:1px solid rgba(99,157,255,0.15)}
      .images-header{display:flex;justify-content:space-between;margin-bottom:0.75rem;font-size:0.85rem;color:#60a5fa}
      .clear-images-btn{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:0.25rem 0.75rem;border-radius:8px;font-size:0.7rem;cursor:pointer}
      .preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:0.75rem}
      .preview-item{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid rgba(99,157,255,0.2)}
      .preview-item img{width:100%;height:100%;object-fit:cover}
      .remove-image-btn{position:absolute;top:4px;right:4px;background:rgba(239,68,68,0.8);border:none;color:white;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px}
      .image-number{position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.6);color:white;font-size:10px;padding:2px 5px;border-radius:4px}
      .progress-container{background:rgba(15,22,44,0.8);border-radius:12px;padding:1rem;margin-bottom:1rem;border:1px solid rgba(59,130,246,0.3)}
      .progress-bar{height:8px;background:linear-gradient(90deg,#3b82f6,#6366f1);border-radius:4px;transition:width 0.3s;margin-bottom:0.5rem}
      .progress-text{font-size:0.85rem;color:#60a5fa;text-align:center}
      .loading-wrapper{text-align:center;padding:2rem;background:rgba(15,22,44,0.6);border-radius:20px}
      .loading-spinner{width:52px;height:52px;border:3px solid rgba(59,130,246,0.15);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 1rem}
      @keyframes spin{to{transform:rotate(360deg)}}
      .error-box{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:14px;padding:1rem;display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem}
      .error-text{color:#fca5a5;font-size:0.88rem;flex:1}
      .stats-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:1rem}
      .stat-card{background:rgba(15,22,44,0.7);border:1px solid rgba(99,157,255,0.12);border-radius:14px;padding:0.9rem 0.75rem;text-align:center}
      .stat-value{font-size:1.4rem;font-weight:700}
      .stat-label{font-size:0.65rem;color:#64748b}
      .quality-bar-wrapper{background:rgba(15,22,44,0.5);border-radius:12px;padding:0.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:1rem}
      .quality-label{font-size:0.78rem;color:#64748b}
      .quality-track{flex:1;height:6px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden}
      .quality-fill{height:100%;border-radius:3px;transition:width 0.6s}
      .warnings-box{background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:0.75rem 1rem;margin-bottom:1rem}
      .warnings-title{font-size:0.75rem;font-weight:600;color:#fbbf24}
      .warnings-list{list-style:none;padding:0}
      .warnings-list li{font-size:0.75rem;color:#d97706}
      .section-title{font-size:0.8rem;font-weight:600;color:#475569;margin-bottom:0.75rem;display:flex;justify-content:space-between}
      .products-list{display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem}
      .product-card{background:rgba(15,22,44,0.6);border:1px solid rgba(99,157,255,0.12);border-radius:16px;overflow:hidden}
      .product-card-header{display:flex;justify-content:space-between;padding:0.9rem 1rem 0.6rem;cursor:pointer}
      .product-card-left{display:flex;gap:0.75rem;flex:1}
      .product-index{width:28px;height:28px;background:rgba(59,130,246,0.12);color:#60a5fa;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700}
      .product-name{font-size:0.92rem;font-weight:600}
      .product-meta{display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.35rem}
      .chip{font-size:0.65rem;padding:2px 8px;border-radius:6px;font-weight:500}
      .chip-brand{background:rgba(99,102,241,0.15);color:#a5b4fc}
      .chip-cat{background:rgba(20,184,166,0.1);color:#5eead4}
      .badge{font-size:0.62rem;padding:3px 8px;border-radius:6px;font-weight:600}
      .badge-success{background:rgba(16,185,129,0.12);color:#34d399}
      .badge-warning{background:rgba(245,158,11,0.1);color:#fbbf24}
      .badge-danger{background:rgba(239,68,68,0.1);color:#f87171}
      .product-quick-stats{display:flex;gap:1rem;border-top:1px solid rgba(99,157,255,0.07);padding:0.55rem 1rem;flex-wrap:wrap}
      .quick-stat{display:flex;flex-direction:column;gap:1px}
      .qs-label{font-size:0.62rem;color:#475569}
      .qs-value{font-size:0.82rem;font-weight:600}
      .product-edit-section{padding:0.75rem 1rem 1rem;border-top:1px solid rgba(99,157,255,0.1);background:rgba(10,14,26,0.4)}
      .edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.6rem}
      .edit-field{display:flex;flex-direction:column;gap:4px}
      .edit-label{font-size:0.68rem;color:#475569}
      .edit-input{background:rgba(15,22,44,0.8);border:1px solid rgba(99,157,255,0.15);border-radius:8px;padding:0.45rem 0.6rem;color:#e2e8f0;font-size:0.82rem;font-family:inherit}
      .notes-row{display:flex;gap:0.5rem;padding:0.5rem;background:rgba(59,130,246,0.06);border-radius:8px;margin:0.5rem 0}
      .notes-icon{color:#60a5fa}
      .delete-btn{background:transparent;border:1px solid rgba(239,68,68,0.2);color:#f87171;padding:0.4rem 0.9rem;border-radius:8px;cursor:pointer;margin-top:0.5rem}
      .export-success{background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:14px;padding:1rem;text-align:center;margin-bottom:1rem}
      .divider{height:1px;background:rgba(99,157,255,0.08);margin:1rem 0}
      .settings-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:200}
      .settings-modal{background:#0f1628;border:1px solid rgba(99,157,255,0.2);border-radius:20px;padding:1.5rem;width:100%;max-width:420px}
      .settings-title{font-size:1rem;font-weight:700;margin-bottom:0.35rem}
      .settings-label{font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:0.4rem}
      .settings-input{width:100%;background:rgba(15,22,44,0.8);border:1px solid rgba(99,157,255,0.2);border-radius:10px;padding:0.6rem;color:#e2e8f0;margin-bottom:1rem}
      .settings-actions{display:flex;gap:0.6rem}
      .hidden{display:none}
      @media(max-width:420px){.stats-bar{grid-template-columns:1fr 1fr}.edit-grid{grid-template-columns:1fr}}
    `),
    React.createElement("div", { className: "scanner-root" },
      React.createElement("header", { className: "header" },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
          React.createElement("div", { className: "header-logo" }, "🏪"),
          React.createElement("div", { className: "header-title" }, "الماسح الذكي للمخزون")
        ),
        React.createElement("div", { style: { display: "flex", gap: "0.6rem", alignItems: "center" } },
          React.createElement("button", { onClick: () => setShowSettings(true), style: { background: "rgba(30,40,65,0.8)", padding: "0.4rem 0.8rem", borderRadius: "10px", border: "none", color: "#94a3b8", cursor: "pointer" } }, "⚙️"),
          React.createElement("span", { style: { background: "rgba(16,185,129,0.1)", padding: "0.3rem 0.8rem", borderRadius: "20px", fontSize: "0.7rem", color: "#34d399" } }, `${currency.flag} ${currency.symbol}`)
        )
      ),
      React.createElement("main", { className: "main" },
        previewImages.length > 0 && !isLoading && React.createElement("div", { className: "images-preview-grid" },
          React.createElement("div", { className: "images-header" },
            React.createElement("span", null, `📸 ${previewImages.length} صور مرفوعة`),
            React.createElement("button", { onClick: clearAllImages, className: "clear-images-btn" }, "مسح الكل")
          ),
          React.createElement("div", { className: "preview-grid" },
            previewImages.map((img, idx) => React.createElement("div", { key: idx, className: "preview-item" },
              React.createElement("img", { src: img, alt: `صورة ${idx + 1}` }),
              React.createElement("button", { className: "remove-image-btn", onClick: () => removePreviewImage(idx) }, "✕"),
              React.createElement("span", { className: "image-number" }, `#${idx + 1}`)
            ))
          )
        ),
        isAnalyzingMultiple && analysisProgress > 0 && analysisProgress < 100 && React.createElement("div", { className: "progress-container" },
          React.createElement("div", { className: "progress-bar", style: { width: `${analysisProgress}%` } }),
          React.createElement("div", { className: "progress-text" }, `🔄 جاري تحليل ${processingImagesCount} صور... ${analysisProgress}%`)
        ),
        !result && !isLoading && previewImages.length === 0 && React.createElement(ImageCapture, { onCapture: handleCapture, onCaptureMultiple: handleCaptureMultiple, disabled: isLoading }),
        React.createElement(VideoCapture, { onCapture: handleCapture, disabled: isLoading }),
        isLoading && React.createElement("div", { className: "loading-wrapper" },
          React.createElement("div", { className: "loading-spinner" }),
          React.createElement("p", { style: { color: "#94a3b8" } }, loadingText),
          isAnalyzingMultiple && React.createElement("p", { style: { color: "#475569", fontSize: "0.75rem", marginTop: "0.5rem" } }, `يتم دمج النتائج من ${processingImagesCount} صورة تلقائياً`)
        ),
        error && React.createElement("div", { className: "error-box" },
          React.createElement("span", { style: { fontSize: "1.2rem" } }, "⚠️"),
          React.createElement("div", { className: "error-text" }, error),
          React.createElement("button", { className: "btn btn-secondary", style: { fontSize: "0.78rem", padding: "0.3rem 0.8rem" }, onClick: handleReset }, "حاول مرة أخرى")
        ),
        result && !isLoading && React.createElement(React.Fragment, null,
          React.createElement("div", { className: "stats-bar" },
            React.createElement(StatCard, { label: "إجمالي المنتجات", value: result.total_products_detected, icon: "📦" }),
            React.createElement(StatCard, { label: "دقة عالية", value: highConfidence, icon: "✅" }),
            React.createElement(StatCard, { label: "القيمة الإجمالية", value: `${totalValue} ${currency.symbol}`, icon: "💰" })
          ),
          React.createElement(QualityBar, { quality: result.analysis_quality }),
          result.warnings.length > 0 && React.createElement("div", { className: "warnings-box" },
            React.createElement("div", { className: "warnings-title" }, "⚠ تحذيرات التحليل"),
            React.createElement("ul", { className: "warnings-list" }, result.warnings.map((w, i) => React.createElement("li", { key: i }, `• ${w}`)))
          ),
          React.createElement("div", { className: "divider" }),
          React.createElement("div", { className: "section-title" },
            React.createElement("span", null, `📋 المنتجات المكتشفة (${result.products.length})`),
            React.createElement("button", { className: "btn btn-secondary", style: { fontSize: "0.7rem", padding: "0.3rem 0.75rem" }, onClick: handleAddProduct }, "➕ إضافة يدوياً")
          ),
          React.createElement("div", { className: "products-list" },
            result.products.length === 0 ? React.createElement("p", { style: { color: "#475569", textAlign: "center", padding: "2rem" } }, "لم يتم اكتشاف أي منتجات") :
              result.products.map((item, idx) => React.createElement(ProductCard, { key: idx, item: item, index: idx, onChange: handleFieldChange, onDelete: handleDelete, currencySymbol: currency.symbol }))
          ),
          React.createElement("div", { className: "divider" }),
          React.createElement("div", { className: "export-section" },
            exportSuccess ? React.createElement("div", { className: "export-success" },
              React.createElement("div", { style: { fontSize: "2rem" } }, "🎉"),
              React.createElement("div", { style: { fontWeight: 600, color: "#34d399" } }, "تم الترحيل بنجاح!"),
              spreadsheetId && React.createElement("button", { className: "btn btn-primary", style: { marginTop: "1rem", fontSize: "0.85rem", padding: "0.4rem 1rem" }, onClick: () => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, "_blank") }, "📄 فتح جدول البيانات")
            ) : React.createElement(React.Fragment, null,
              !spreadsheetId && React.createElement("div", { style: { background: "rgba(245,158,11,0.07)", borderRadius: "12px", padding: "0.7rem 1rem", marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("span", { style: { fontSize: "0.78rem", color: "#d97706" } }, "⚠️ لم تُضف رابط Google Sheets بعد"),
                React.createElement("button", { className: "btn btn-secondary", style: { fontSize: "0.73rem", padding: "0.3rem 0.8rem" }, onClick: () => setShowSettings(true) }, "إضافة الآن ⚙️")
              ),
              React.createElement("button", { className: "btn btn-export", onClick: handleExport, disabled: exporting || result.products.length === 0 }, exporting ? "⏳ جاري الترحيل..." : `📊 تصدير إلى Google Sheets (${result.total_products_detected} منتج)`),
              React.createElement("button", { className: "btn btn-secondary", style: { width: "100%", marginTop: "0.6rem", padding: "0.85rem" }, onClick: handlePrintInvoice, disabled: result.products.length === 0 }, "🧾 إنشاء فاتورة PDF")
            ),
            React.createElement("button", { className: "btn btn-reset", onClick: handleReset }, "↩ مسح ورفع صور جديدة")
          )
        )
      )
    ),
    showSettings && React.createElement("div", { className: "settings-overlay", onClick: () => setShowSettings(false) },
      React.createElement("div", { className: "settings-modal", onClick: (e) => e.stopPropagation() },
        React.createElement("div", { className: "settings-title" }, "⚙️ الإعدادات"),
        React.createElement("label", { className: "settings-label" }, "العملة"),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "0.4rem", marginBottom: "1rem", maxHeight: "200px", overflowY: "auto" } },
          CURRENCIES.map(c => React.createElement("button", { key: c.code, onClick: () => setCurrency(c), style: { padding: "0.4rem", borderRadius: "8px", border: currency.code === c.code ? "1px solid #3b82f6" : "1px solid #333", background: currency.code === c.code ? "rgba(59,130,246,0.2)" : "transparent", color: "#fff", cursor: "pointer", textAlign: "right", display: "flex", alignItems: "center", gap: "0.5rem" } },
            React.createElement("span", null, c.flag),
            React.createElement("span", null, c.symbol),
            React.createElement("span", { style: { fontSize: "0.68rem", color: "#64748b" } }, c.name)
          ))
        ),
        React.createElement("label", { className: "settings-label" }, "Spreadsheet ID"),
        React.createElement("input", { className: "settings-input", placeholder: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", value: spreadsheetId, onChange: e => setSpreadsheetId(e.target.value), dir: "ltr" }),
        React.createElement("div", { className: "settings-actions" },
          React.createElement("button", { className: "btn btn-primary", onClick: handleSaveSettings, style: { flex: 1 } }, "💾 حفظ"),
          React.createElement("button", { className: "btn btn-secondary", onClick: () => setShowSettings(false) }, "إلغاء")
        )
      )
    )
  );
}