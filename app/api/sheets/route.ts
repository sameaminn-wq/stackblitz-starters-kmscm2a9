
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { ProductItem, ExportRequest, Confidence } from "../../../types";

// ============================================================
// وظائف مساعدة لتوليد التقارير (Helper Functions for Report Generation)
// ============================================================

// وظيفة للتحقق من صحة ProductItem
function isValidProductItem(item: unknown): item is ProductItem {
  if (typeof item !== "object" || item === null) return false;
  const product = item as Record<string, unknown>;
  return (
    Number.isInteger(product.id) &&
    typeof product.product_name === "string" && product.product_name.length <= 300 &&
    (product.brand === null || (typeof product.brand === "string" && product.brand.length <= 150)) &&
    typeof product.category === "string" && product.category.length <= 150 &&
    (product.unit_price === null || (typeof product.unit_price === "number" && Number.isFinite(product.unit_price) && product.unit_price >= 0)) &&
    typeof product.quantity === "number" && Number.isFinite(product.quantity) && product.quantity >= 0 &&
    (product.barcode_serial === null || (typeof product.barcode_serial === "string" && product.barcode_serial.length <= 100)) &&
    (["high", "medium", "low"] as Confidence[]).includes(product.confidence as Confidence) &&
    typeof product.notes === "string" && product.notes.length <= 800 &&
    Number.isInteger(product.fallback_level) && Number(product.fallback_level) >= 1 && Number(product.fallback_level) <= 5 &&
    ["ocr_only", "visual_match", "barcode_match", "multimodal_match"].includes(String(product.detection_method)) &&
    typeof product.confidence_score === "number" && Number.isFinite(product.confidence_score) && product.confidence_score >= 0 && product.confidence_score <= 1 &&
    typeof product.image_region === "string" && product.image_region.length <= 40 &&
    typeof product.is_estimated === "boolean" &&
    Array.isArray(product.compliance_flags) && product.compliance_flags.length <= 20 &&
    product.compliance_flags.every((flag) => typeof flag === "string" && flag.length <= 80)
  );
}

/**
 * توليد تقرير Excel احترافي من بيانات الجرد.
 * @param products - قائمة المنتجات المراد تضمينها في التقرير.
 * @param exportDetails - تفاصيل إضافية للتصدير مثل عنوان الفاتورة.
 * @returns Buffer يحتوي على بيانات ملف Excel.
 */
async function generateExcelReport(products: ProductItem[], exportDetails: ExportRequest): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheetName = (exportDetails.invoiceTitle || "تقرير جرد المخزون").replace(/[:\\/?*\[\]]/g, " ").slice(0, 31) || "Inventory";
  const worksheet = workbook.addWorksheet(sheetName);

  // إضافة رأس التقرير
  worksheet.mergeCells("A1:J1");
  worksheet.getCell("A1").value = exportDetails.invoiceTitle || "تقرير جرد المخزون";
  worksheet.getCell("A1").font = { name: "Arial", size: 16, bold: true };
  worksheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };

  worksheet.addRow([]); // صف فارغ

  if (exportDetails.invoiceNumber) {
    worksheet.addRow([`رقم الفاتورة: ${exportDetails.invoiceNumber}`]);
  }
  if (exportDetails.customerName) {
    worksheet.addRow([`العميل: ${exportDetails.customerName}`]);
  }
  worksheet.addRow([`التاريخ: ${new Date().toLocaleDateString()}`]);
  worksheet.addRow([]); // صف فارغ

  // رأس الجدول
  const headers = ["#", "اسم المنتج", "الماركة", "التصنيف", "الكمية", "سعر الوحدة", "الإجمالي", "الباركود", "الثقة", "ملاحظات"];
  const headerRow = worksheet.addRow(headers);
  headerRow.font = { name: "Arial", size: 12, bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } }; // رمادي فاتح
    cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });

  // بيانات المنتجات
  let totalAmount = 0;
  products.forEach((product, index) => {
    const price = product.unit_price || 0;
    const qty = product.quantity || 0;
    const total = price * qty;
    totalAmount += total;

    const row = worksheet.addRow([
      index + 1,
      product.product_name || "",
      product.brand || "",
      product.category || "",
      qty,
      price,
      total,
      product.barcode_serial || "",
      product.confidence || "",
      product.notes || ""
    ]);
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
  });

  // الإجمالي الكلي
  worksheet.addRow([]); // صف فارغ
  const totalRow = worksheet.addRow(["", "", "", "", "", "الإجمالي الكلي:", totalAmount.toFixed(2), exportDetails.currency || "USD"]);
  totalRow.font = { name: "Arial", size: 12, bold: true };
  totalRow.getCell(6).alignment = { horizontal: "right" };

  // ضبط عرض الأعمدة
  worksheet.columns.forEach(column => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, cell => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// POST Handler - المحرك الرئيسي للتصدير
// ============================================================
/**
 * يتعامل مع طلبات POST لتصدير بيانات الجرد إلى PDF أو Excel.
 * @param request - كائن NextRequest الذي يحتوي على بيانات المنتجات ونوع التصدير.
 * @returns استجابة تحتوي على الملف المصدر أو رسالة خطأ.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 5 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "حجم طلب التصدير يتجاوز الحد المسموح." }, { status: 413 });
    }
    let payload: ExportRequest & { exportType?: string };
    try {
      payload = JSON.parse(rawBody) as ExportRequest & { exportType?: string };
    } catch {
      return NextResponse.json({ success: false, error: "بيانات التصدير ليست JSON صالحاً." }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ success: false, error: "بيانات التصدير غير صالحة." }, { status: 400 });
    }
    const { products, exportType, invoiceTitle, invoiceNumber, customerName, currency } = payload;

    // 1. التحقق من صحة المنتجات المدخلة (Input Validation)
    if (!products || !Array.isArray(products) || products.length === 0 || products.length > 300) {
      return NextResponse.json({ success: false, error: "يجب إرسال من 1 إلى 300 منتج للتصدير." }, { status: 400 });
    }

    const invalidProducts = products.filter(item => !isValidProductItem(item));
    if (invalidProducts.length > 0) {
      return NextResponse.json({ success: false, error: "تحقق من صحة بيانات المنتجات المدخلة. بعض المنتجات غير صالحة.", invalidProducts }, { status: 400 });
    }

    if (exportType !== "excel") {
      return NextResponse.json({ success: false, error: "التصدير عبر هذا المسار متاح بصيغة Excel حالياً. استخدم طباعة الفاتورة من الواجهة لحفظها PDF." }, { status: 400 });
    }

    // 2. تأمين بيانات التصدير (Sanitization is handled by pdf-lib and exceljs by default for text)
    // For production, consider storing products in a DB and exporting by ID rather than direct client input.
    const exportDetails: ExportRequest = {
      products,
      invoiceTitle: typeof invoiceTitle === "string" ? invoiceTitle.replace(/[\\\\/:*?\[\]]/g, " ").slice(0, 80) : "تقرير جرد المخزون",
      invoiceNumber: typeof invoiceNumber === "string" ? invoiceNumber.slice(0, 60) : undefined,
      customerName: typeof customerName === "string" ? customerName.slice(0, 150) : undefined,
      currency: typeof currency === "string" ? currency.slice(0, 12) : undefined,
    };

    const fileBuffer = await generateExcelReport(products, exportDetails);
    const fileName = `inventory_report_${Date.now()}.xlsx`;
    const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // إرسال الملف كاستجابة
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`, // لجعل المتصفح يقوم بتنزيل الملف
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
      },
    });

  } catch (error: any) {
    console.error("Export API Error:", error.message, error.stack);
    // 3. تحسين معالجة الأخطاء (Improved Error Handling)
    return NextResponse.json({ 
      success: false, 
      error: "حدث خطأ غير متوقع أثناء عملية التصدير. يرجى المحاولة مرة أخرى.",
      // لا تكشف عن تفاصيل الخطأ الداخلية في بيئة الإنتاج
      // detail: process.env.NODE_ENV === 'development' ? error.message : undefined 
    }, { status: 500 });
  }
}

/**
 * Health Check & API Status
 * يوفر معلومات حول حالة API ونوعه وإصداره.
 * @returns استجابة JSON تحتوي على معلومات الحالة.
 */
export async function GET() {
  return NextResponse.json({
    status: "online",
    endpoint: "/api/export",
    message: "Inventory Export API is running",
    version: "2026.4.30-export-v2", // تحديث رقم الإصدار
    supported_formats: ["excel"],
    usage: "POST with { products, exportType: \"excel\", ...optionalDetails } to generate an Excel report."
  });
}