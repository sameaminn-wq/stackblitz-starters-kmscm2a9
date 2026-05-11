
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import ExcelJS from "exceljs";

// إذا كان ملف types.ts في مجلد app الرئيسي، استخدم 3 نقاط للخروج:
import { ProductItem, ExportRequest, Confidence } from "../../../types";

// ============================================================
// وظائف مساعدة لتوليد التقارير (Helper Functions for Report Generation)
// ============================================================

// وظيفة للتحقق من صحة ProductItem
function isValidProductItem(item: any): item is ProductItem {
  return (
    typeof item === 'object' && item !== null &&
    typeof item.product_name === 'string' &&
    (item.brand === null || typeof item.brand === 'string') &&
    typeof item.category === 'string' &&
    (item.unit_price === null || (typeof item.unit_price === 'number' && item.unit_price >= 0)) &&
    (typeof item.quantity === 'number' && item.quantity >= 0) &&
    (item.barcode_serial === null || typeof item.barcode_serial === 'string') &&
    (['high', 'medium', 'low'] as Confidence[]).includes(item.confidence) &&
    typeof item.notes === 'string'
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
  // 1. تعريف الخطوط والإعدادات الأساسية
const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
const fallbackFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);

let page = pdfDoc.addPage();
const { width, height } = page.getSize();
const margin = 50;
let y = height - margin;

const fontSize = 10; // تقليل الخط قليلاً ليعطي مظهراً أرشق
const headerFontSize = 18;

// 2. مصفوفة العناوين والعروض (دقة بكسل)
const tableHeaders = ["#", "المنتج", "الماركة", "التصنيف", "الكمية", "السعر", "الإجمالي", "الباركود", "ملاحظات"];
const columnWidths = [25, 110, 70, 70, 40, 60, 60, 80, 80];

// ──────────────────────────────────────────────────────────────
// وظيفة مساعدة لرسم "رأس الجدول" (تمنع التكرار)
// ──────────────────────────────────────────────────────────────
const drawHeader = (currentPage: any, currentY: number) => {
  let xPos = margin;
  for (let j = 0; j < tableHeaders.length; j++) {
    currentPage.drawText(tableHeaders[j], { x: xPos, y: currentY, font: font, size: fontSize });
    xPos += columnWidths[j];
  }
  const lineY = currentY - 5;
  currentPage.drawLine({ start: { x: margin, y: lineY }, end: { x: width - margin, y: lineY }, thickness: 1 });
  return lineY - 15; // إرجاع الموقع الجديد لـ y
};

// 3. رسم عنوان التقرير والتفاصيل العلوية
page.drawText(exportDetails.invoiceTitle || "تقرير جرد المخزون", {
  x: margin, y: y, font: font, size: headerFontSize, color: rgb(0, 0.53, 0.71)
});
y -= 25;

page.drawText(`التاريخ: ${new Date().toLocaleDateString()} | رقم: ${exportDetails.invoiceNumber || "N/A"}`, {
  x: margin, y: y, font: fallbackFont, size: fontSize - 1, color: rgb(0.3, 0.3, 0.3)
});
y -= 35;

// رسم أول رأس جدول
y = drawHeader(page, y);

// 4. حلقة رسم المنتجات مع معالجة النصوص الطويلة
let totalAmount = 0;
for (let i = 0; i < products.length; i++) {
  const product = products[i];
  const price = Number(product.unit_price) || 0;
  const qty = Number(product.quantity) || 0;
  const total = price * qty;
  totalAmount += total;

  // التحقق من المساحة (Pagination)
  if (y < margin + 20) {
    page = pdfDoc.addPage();
    y = height - margin;
    y = drawHeader(page, y);
  }

  let xPos = margin;
  const rowData = [
    (i + 1).toString(),
    String(product.product_name || "").substring(0, 25), // قص النص الطويل
    String(product.brand || "").substring(0, 15),
    String(product.category || "").substring(0, 15),
    qty.toString(),
    price.toFixed(2),
    total.toFixed(2),
    String(product.barcode || "").substring(0, 12),
    String(product.notes || "").substring(0, 20)
  ];

  // رسم الصف الحالي بآلية ديناميكية
  for (let j = 0; j < rowData.length; j++) {
    page.drawText(rowData[j], { x: xPos, y: y, font: fallbackFont, size: fontSize - 1 });
    xPos += columnWidths[j];
  }
  y -= 18; // المسافة بين الصفوف
}

// 5. قسم الإجمالي النهائي (مع حماية الصفحة)
if (y < margin + 50) {
  page = pdfDoc.addPage();
  y = height - margin;
}

y -= 20;
page.drawLine({ start: { x: width - 200, y: y + 10 }, end: { x: width - margin, y: y + 10 }, thickness: 1.5 });
page.drawText(`الإجمالي الكلي: ${totalAmount.toFixed(2)} ${exportDetails.currency || "EGP"}`, {
  x: width - margin - 180,
  y: y - 5,
  font: font,
  size: fontSize + 2,
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
  const worksheet = workbook.addWorksheet(exportDetails.invoiceTitle || "تقرير جرد المخزون");

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
    const { products, exportType, invoiceTitle, invoiceNumber, customerName, currency }: ExportRequest & { exportType: "pdf" | "excel" } = await request.json();

    // 1. التحقق من صحة المنتجات المدخلة (Input Validation)
    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ success: false, error: "لا توجد منتجات للتصدير." }, { status: 400 });
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
      invoiceTitle: invoiceTitle || "تقرير جرد المخزون",
      invoiceNumber,
      customerName,
      currency,
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