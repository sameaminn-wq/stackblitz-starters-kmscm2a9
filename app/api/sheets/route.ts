
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
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
 * توليد تقرير PDF احترافي من بيانات الجرد.
 * @param products - قائمة المنتجات المراد تضمينها في التقرير.
 * @param exportDetails - تفاصيل إضافية للتصدير مثل عنوان الفاتورة.
 * @returns Buffer يحتوي على بيانات ملف PDF.
 */
async function generatePdfReport(products: ProductItem[], exportDetails: ExportRequest): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  // تحميل الخطوط العربية
  // ملاحظة: pdf-lib لا يدعم الخطوط العربية بشكل مباشر بدون مكتبات إضافية أو تضمين خطوط مخصصة.
  // لاستخدام الخطوط العربية بشكل صحيح، ستحتاج إلى تضمين خط يدعم اللغة العربية (مثل NotoSansArabic-Regular.ttf)
  // وتحويل النص إلى أشكال (glyphs) قبل الرسم. هذا يتطلب تعقيداً إضافياً.
  // حالياً، سيتم استخدام خطوط لاتينية قياسية، وقد تظهر الحروف العربية بشكل منفصل أو غير صحيح.
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fallbackFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  let page = pdfDoc.addPage([842, 595]);

  const { width, height } = page.getSize();
  let y = height - 50;
  const margin = 24;
  const fontSize = 8;
  const headerFontSize = 14;

  // عنوان التقرير
  page.drawText(exportDetails.invoiceTitle || "تقرير جرد المخزون", {
    x: margin,
    y: y,
    font: font,
    size: headerFontSize,
    color: rgb(0, 0.53, 0.71), // أزرق داكن
  });
  y -= 30;

  // تفاصيل إضافية
  if (exportDetails.invoiceNumber) {
    page.drawText(`رقم الفاتورة: ${exportDetails.invoiceNumber}`, { x: margin, y: y, font: fallbackFont, size: fontSize });
    y -= 20;
  }
  if (exportDetails.customerName) {
    page.drawText(`العميل: ${exportDetails.customerName}`, { x: margin, y: y, font: fallbackFont, size: fontSize });
    y -= 20;
  }
  page.drawText(`التاريخ: ${new Date().toLocaleDateString()}`, { x: margin, y: y, font: fallbackFont, size: fontSize });
  y -= 40;

  // رأس الجدول
  const tableHeaders = ["#", "اسم المنتج", "الماركة", "التصنيف", "الكمية", "سعر الوحدة", "الإجمالي", "الباركود", "الثقة", "ملاحظات"];
  const columnWidths = [22, 112, 68, 68, 38, 58, 58, 72, 42, 100];
  let x = margin;

  for (let i = 0; i < tableHeaders.length; i++) {
    page.drawText(tableHeaders[i], { x: x, y: y, font: font, size: fontSize, color: rgb(0, 0, 0) });
    x += columnWidths[i];
  }
  y -= 15;
  page.drawLine({ start: { x: margin, y: y }, end: { x: width - margin, y: y }, color: rgb(0, 0, 0), thickness: 1 });
  y -= 10;

  // بيانات المنتجات
  let totalAmount = 0;
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const price = product.unit_price || 0;
    const qty = product.quantity || 0;
    const total = price * qty;
    totalAmount += total;

    x = margin;
    page.drawText((i + 1).toString(), { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[0];
    page.drawText(product.product_name || "", { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[1];
    page.drawText(product.brand || "", { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[2];
    page.drawText(product.category || "", { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[3];
    page.drawText(qty.toString(), { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[4];
    page.drawText(price.toFixed(2), { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[5];
    page.drawText(total.toFixed(2), { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[6];
    page.drawText(product.barcode_serial || "", { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[7];
    page.drawText(product.confidence || "", { x: x, y: y, font: fallbackFont, size: fontSize });
    x += columnWidths[8];
    page.drawText(product.notes || "", { x: x, y: y, font: fallbackFont, size: fontSize });
    y -= 20;

    if (y < margin) {
      page = pdfDoc.addPage([842, 595]);
      y = height - margin;
      // إعادة رسم رأس الجدول للصفحة الجديدة
      x = margin;
      for (let j = 0; j < tableHeaders.length; j++) {
        page.drawText(tableHeaders[j], { x: x, y: y, font: font, size: fontSize, color: rgb(0, 0, 0) });
        x += columnWidths[j];
      }
      y -= 15;
      page.drawLine({ start: { x: margin, y: y }, end: { x: width - margin, y: y }, color: rgb(0, 0, 0), thickness: 1 });
      y -= 10;
    }
  }

  // الإجمالي الكلي
  y -= 20;
  page.drawText(`الإجمالي الكلي: ${totalAmount.toFixed(2)} ${exportDetails.currency || "USD"}`, {
    x: width - margin - 150,
    y: y,
    font: font,
    size: fontSize + 2,
    color: rgb(0, 0, 0),
  });

  return Buffer.from(await pdfDoc.save());
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
  worksheet.addRow(headers);
  worksheet.getRow(worksheet.lastRow.number).font = { name: "Arial", size: 12, bold: true };
  worksheet.getRow(worksheet.lastRow.number).eachCell((cell) => {
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
    column.eachCell({ includeEmpty: true }, cell => {
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

    if (!exportType || (exportType !== "pdf" && exportType !== "excel")) {
      return NextResponse.json({ success: false, error: "نوع التصدير غير صالح (يجب أن يكون 'pdf' أو 'excel')." }, { status: 400 });
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

    let fileBuffer: Buffer;
    let fileName: string;
    let contentType: string;

    if (exportType === "pdf") {
      fileBuffer = await generatePdfReport(products, exportDetails);
      fileName = `inventory_report_${Date.now()}.pdf`;
      contentType = "application/pdf";
    } else { // exportType === "excel"
      fileBuffer = await generateExcelReport(products, exportDetails);
      fileName = `inventory_report_${Date.now()}.xlsx`;
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

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
    supported_formats: ["pdf", "excel"],
    usage: "POST with { products, exportType, ...optionalDetails } to generate reports."
  });
}