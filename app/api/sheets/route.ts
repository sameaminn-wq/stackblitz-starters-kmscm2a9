import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import ExcelJS from "exceljs";

// استيراد الأنواع من الملف الصحيح
import { ProductItem, ExportRequest, Confidence } from "../../../types";

// ============================================================
// واجهات إضافية للتوافق مع الـ API
// ============================================================

interface ExportRequestBody {
  products: ProductItem[];
  exportType: "pdf" | "excel";
  invoiceTitle?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
  companyName?: string;
  companyLogo?: string;
  taxPercent?: number;
  discountPercent?: number;
}

// ============================================================
// وظائف مساعدة لتوليد التقارير
// ============================================================

// وظيفة للتحقق من صحة ProductItem (متوافقة مع الـ types الجديد)
function isValidProductItem(item: any): item is ProductItem {
  return (
    typeof item === 'object' && item !== null &&
    typeof item.product_name === 'string' &&
    (item.brand === null || typeof item.brand === 'string') &&
    typeof item.category === 'string' &&
    (item.unit_price === null || (typeof item.unit_price === 'number' && item.unit_price >= 0)) &&
    (typeof item.quantity === 'number' && item.quantity >= 0) &&
    (item.barcode === null || typeof item.barcode === 'string') &&
    (item.barcode_serial === null || typeof item.barcode_serial === 'string') &&
    (['high', 'medium', 'low'] as Confidence[]).includes(item.confidence) &&
    typeof item.notes === 'string'
  );
}

/**
 * توليد تقرير PDF احترافي مع دعم أفضل للعربية
 */
async function generatePdfReport(
  products: ProductItem[], 
  exportDetails: ExportRequestBody
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fallbackFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const fontSize = 10;
  const headerFontSize = 16;

  // العناوين (بالعربية)
  const tableHeaders = ["#", "المنتج", "الماركة", "التصنيف", "الكمية", "السعر", "الإجمالي", "الباركود", "الثقة", "ملاحظات"];
  const columnWidths = [25, 90, 60, 60, 40, 55, 60, 70, 45, 70];

  // دالة رسم رأس الجدول
  const drawHeader = (currentPage: any, currentY: number) => {
    let xPos = margin;
    for (let j = 0; j < tableHeaders.length; j++) {
      currentPage.drawText(tableHeaders[j], { 
        x: xPos, 
        y: currentY, 
        font: font, 
        size: fontSize,
        color: rgb(0.2, 0.2, 0.8)
      });
      xPos += columnWidths[j];
    }
    const lineY = currentY - 5;
    currentPage.drawLine({ 
      start: { x: margin, y: lineY }, 
      end: { x: width - margin, y: lineY }, 
      thickness: 1,
      color: rgb(0.4, 0.4, 0.4)
    });
    return lineY - 18;
  };

  // عنوان التقرير
  const title = exportDetails.invoiceTitle || "تقرير جرد المخزون";
  const titleWidth = title.length * (headerFontSize / 2);
  page.drawText(title, {
    x: (width - titleWidth) / 2,
    y: y,
    font: font,
    size: headerFontSize,
    color: rgb(0, 0.4, 0.6)
  });
  y -= 30;

  // معلومات التقرير
  const infoTexts = [
    `التاريخ: ${new Date().toLocaleDateString("ar-EG")}`,
    `رقم الفاتورة: ${exportDetails.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`}`,
  ];
  
  if (exportDetails.customerName) {
    infoTexts.push(`العميل: ${exportDetails.customerName}`);
  }
  if (exportDetails.companyName) {
    infoTexts.push(`الشركة: ${exportDetails.companyName}`);
  }
  if (exportDetails.currency) {
    infoTexts.push(`العملة: ${exportDetails.currency}`);
  }

  for (const text of infoTexts) {
    page.drawText(text, { x: margin, y: y, font: fallbackFont, size: fontSize - 1, color: rgb(0.4, 0.4, 0.4) });
    y -= 15;
  }
  y -= 10;

  // رسم أول رأس جدول
  y = drawHeader(page, y);

  // حلقة رسم المنتجات
  let totalAmount = 0;
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const price = product.unit_price || 0;
    const qty = product.quantity || 0;
    const total = price * qty;
    totalAmount += total;

    // التحقق من المساحة للصفحة الجديدة
    if (y < margin + 30) {
      page = pdfDoc.addPage();
      y = height - margin;
      y = drawHeader(page, y);
    }

    let xPos = margin;
    const confidenceLabel = {
      high: "عالية",
      medium: "متوسطة",
      low: "منخفضة"
    }[product.confidence] || product.confidence;

    const rowData = [
      (i + 1).toString(),
      String(product.product_name || "").substring(0, 25),
      String(product.brand || "").substring(0, 15),
      String(product.category || "").substring(0, 15),
      qty.toString(),
      price.toFixed(2),
      total.toFixed(2),
      String(product.barcode || product.barcode_serial || "").substring(0, 15),
      confidenceLabel,
      String(product.notes || "").substring(0, 25)
    ];

    // رسم الصف
    for (let j = 0; j < rowData.length; j++) {
      page.drawText(rowData[j], { 
        x: xPos, 
        y: y, 
        font: fallbackFont, 
        size: fontSize - 1,
        color: i % 2 === 0 ? rgb(0, 0, 0) : rgb(0.2, 0.2, 0.2)
      });
      xPos += columnWidths[j];
    }
    y -= 16;
  }

  // قسم الإجمالي
  if (y < margin + 60) {
    page = pdfDoc.addPage();
    y = height - margin;
  }

  y -= 25;
  
  // رسم خط فاصل
  page.drawLine({ 
    start: { x: margin, y: y + 10 }, 
    end: { x: width - margin, y: y + 10 }, 
    thickness: 1,
    color: rgb(0.4, 0.4, 0.4)
  });
  
  // حساب الخصم والضريبة إذا وجدت
  let discountAmount = 0;
  let taxAmount = 0;
  let finalTotal = totalAmount;
  
  if (exportDetails.discountPercent && exportDetails.discountPercent > 0) {
    discountAmount = totalAmount * (exportDetails.discountPercent / 100);
    finalTotal -= discountAmount;
  }
  
  if (exportDetails.taxPercent && exportDetails.taxPercent > 0) {
    taxAmount = finalTotal * (exportDetails.taxPercent / 100);
    finalTotal += taxAmount;
  }
  
  // عرض تفاصيل الإجمالي
  let summaryY = y + 5;
  const summaryX = width - margin - 200;
  
  page.drawText(`المجموع الفرعي: ${totalAmount.toFixed(2)}`, {
    x: summaryX,
    y: summaryY,
    font: font,
    size: fontSize,
  });
  summaryY -= 18;
  
  if (discountAmount > 0) {
    page.drawText(`الخصم (${exportDetails.discountPercent}%): -${discountAmount.toFixed(2)}`, {
      x: summaryX,
      y: summaryY,
      font: fallbackFont,
      size: fontSize - 1,
      color: rgb(0.8, 0.2, 0.2)
    });
    summaryY -= 18;
  }
  
  if (taxAmount > 0) {
    page.drawText(`الضريبة (${exportDetails.taxPercent}%): +${taxAmount.toFixed(2)}`, {
      x: summaryX,
      y: summaryY,
      font: fallbackFont,
      size: fontSize - 1,
    });
    summaryY -= 18;
  }
  
  summaryY -= 8;
  page.drawLine({ 
    start: { x: summaryX, y: summaryY + 5 }, 
    end: { x: width - margin, y: summaryY + 5 }, 
    thickness: 1.5 
  });
  
  page.drawText(`الإجمالي النهائي: ${finalTotal.toFixed(2)} ${exportDetails.currency || "EGP"}`, {
    x: summaryX,
    y: summaryY - 5,
    font: font,
    size: fontSize + 2,
    color: rgb(0, 0.5, 0.3)
  });

  // تذييل الصفحة
  const footerY = 30;
  page.drawText(`تم إنشاء هذا التقرير بواسطة نظام الجرد الذكي - ${new Date().toLocaleString("ar-EG")}`, {
    x: margin,
    y: footerY,
    font: fallbackFont,
    size: 7,
    color: rgb(0.6, 0.6, 0.6)
  });

  return Buffer.from(await pdfDoc.save());
}

/**
 * توليد تقرير Excel احترافي
 */
async function generateExcelReport(
  products: ProductItem[], 
  exportDetails: ExportRequestBody
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(exportDetails.invoiceTitle || "تقرير جرد المخزون", {
    properties: { tabColor: { argb: "FF3B82F6" } }
  });

  // إعدادات RTL للورقة
  worksheet.views = [{ rightToLeft: true }];

  // عنوان التقرير
  worksheet.mergeCells("A1:J1");
  worksheet.getCell("A1").value = exportDetails.invoiceTitle || "تقرير جرد المخزون";
  worksheet.getCell("A1").font = { name: "Cairo", size: 18, bold: true };
  worksheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };

  // معلومات التقرير
  let currentRow = 2;
  
  if (exportDetails.companyName) {
    worksheet.mergeCells(`A${currentRow}:J${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = exportDetails.companyName;
    worksheet.getCell(`A${currentRow}`).font = { name: "Cairo", size: 12, bold: true };
    worksheet.getCell(`A${currentRow}`).alignment = { horizontal: "center" };
    currentRow++;
  }
  
  currentRow++;
  
  const infoData = [
    ["رقم الفاتورة:", exportDetails.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`],
    ["التاريخ:", new Date().toLocaleDateString("ar-EG")],
  ];
  
  if (exportDetails.customerName) {
    infoData.push(["العميل:", exportDetails.customerName]);
  }
  if (exportDetails.currency) {
    infoData.push(["العملة:", exportDetails.currency]);
  }
  
  for (const [label, value] of infoData) {
    worksheet.getCell(`A${currentRow}`).value = label;
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.getCell(`B${currentRow}`).value = value;
    currentRow++;
  }
  
  currentRow++;

  // صف الرأس
  const headers = ["#", "اسم المنتج", "الماركة", "التصنيف", "الكمية", "سعر الوحدة", "الإجمالي", "الباركود", "الثقة", "ملاحظات"];
  const headerRow = worksheet.addRow(headers);
  
  // تنسيق الرأس
  headerRow.font = { name: "Cairo", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.eachCell((cell) => {
    cell.border = { 
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } }
    };
  });

  // بيانات المنتجات
  let totalAmount = 0;
  products.forEach((product, index) => {
    const price = product.unit_price || 0;
    const qty = product.quantity || 0;
    const total = price * qty;
    totalAmount += total;

    const confidenceLabel = {
      high: "عالية",
      medium: "متوسطة",
      low: "منخفضة"
    }[product.confidence] || product.confidence;

    const row = worksheet.addRow([
      index + 1,
      product.product_name || "",
      product.brand || "",
      product.category || "",
      qty,
      price,
      total,
      product.barcode || product.barcode_serial || "",
      confidenceLabel,
      product.notes || ""
    ]);
    
    // تنسيق الصفوف المتناوبة
    if (index % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });
    }
    
    row.eachCell((cell) => {
      cell.border = { 
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } }
      };
    });
  });

  // صف فارغ
  worksheet.addRow([]);
  
  // الحسابات النهائية
  const calculationRow = worksheet.addRow([]);
  let calcRowIndex = worksheet.rowCount;
  
  let finalTotal = totalAmount;
  if (exportDetails.discountPercent && exportDetails.discountPercent > 0) {
    const discountAmount = totalAmount * (exportDetails.discountPercent / 100);
    finalTotal -= discountAmount;
    worksheet.getCell(`G${calcRowIndex}`).value = `الخصم (${exportDetails.discountPercent}%):`;
    worksheet.getCell(`H${calcRowIndex}`).value = `-${discountAmount.toFixed(2)}`;
    worksheet.getCell(`H${calcRowIndex}`).font = { color: { argb: "FFEF4444" } };
    calcRowIndex++;
  }
  
  if (exportDetails.taxPercent && exportDetails.taxPercent > 0) {
    const taxAmount = finalTotal * (exportDetails.taxPercent / 100);
    finalTotal += taxAmount;
    worksheet.getCell(`G${calcRowIndex}`).value = `الضريبة (${exportDetails.taxPercent}%):`;
    worksheet.getCell(`H${calcRowIndex}`).value = `+${taxAmount.toFixed(2)}`;
    calcRowIndex++;
  }
  
  calcRowIndex++;
  worksheet.getCell(`G${calcRowIndex}`).value = "الإجمالي النهائي:";
  worksheet.getCell(`G${calcRowIndex}`).font = { bold: true, size: 12 };
  worksheet.getCell(`H${calcRowIndex}`).value = `${finalTotal.toFixed(2)} ${exportDetails.currency || "EGP"}`;
  worksheet.getCell(`H${calcRowIndex}`).font = { bold: true, size: 12, color: { argb: "FF10B981" } };

  // ضبط عرض الأعمدة تلقائياً
  worksheet.columns.forEach((column) => {
    if (!column) return;
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? String(cell.value).length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 12 ? 12 : maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// POST Handler - المحرك الرئيسي للتصدير
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body: ExportRequestBody = await request.json();
    const { products, exportType, invoiceTitle, invoiceNumber, customerName, currency, companyName, taxPercent, discountPercent } = body;

    // 1. التحقق من صحة المنتجات
    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { success: false, error: "لا توجد منتجات للتصدير." }, 
        { status: 400 }
      );
    }

    const invalidProducts = products.filter(item => !isValidProductItem(item));
    if (invalidProducts.length > 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: "بعض المنتجات غير صالحة للتصدير.", 
          invalidCount: invalidProducts.length 
        }, 
        { status: 400 }
      );
    }

    if (!exportType || (exportType !== "pdf" && exportType !== "excel")) {
      return NextResponse.json(
        { success: false, error: "نوع التصدير غير صالح (يجب أن يكون 'pdf' أو 'excel')." }, 
        { status: 400 }
      );
    }

    // 2. إعداد بيانات التصدير
    const exportDetails: ExportRequestBody = {
      products,
      exportType,
      invoiceTitle: invoiceTitle || "تقرير جرد المخزون",
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      customerName,
      currency: currency || "EGP",
      companyName,
      taxPercent: taxPercent || 0,
      discountPercent: discountPercent || 0,
    };

    let fileBuffer: Buffer;
    let fileName: string;
    let contentType: string;

    if (exportType === "pdf") {
      fileBuffer = await generatePdfReport(products, exportDetails);
      fileName = `inventory_report_${Date.now()}.pdf`;
      contentType = "application/pdf";
    } else {
      fileBuffer = await generateExcelReport(products, exportDetails);
      fileName = `inventory_report_${Date.now()}.xlsx`;
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

    // إرسال الملف
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
      },
    });

  } catch (error: any) {
    console.error("Export API Error:", error.message, error.stack);
    
    // معالجة أخطاء محددة
    if (error.message?.includes("products")) {
      return NextResponse.json(
        { success: false, error: "خطأ في بيانات المنتجات. تأكد من إرسال مصفوفة صحيحة." },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: "حدث خطأ غير متوقع أثناء عملية التصدير. يرجى المحاولة مرة أخرى لاحقاً."
      }, 
      { status: 500 }
    );
  }
}

// ============================================================
// GET Handler - معلومات الـ API
// ============================================================

export async function GET() {
  return NextResponse.json({
    status: "online",
    endpoint: "/api/export",
    message: "Inventory Export API is running",
    version: "2.0.0",
    supported_formats: ["pdf", "excel"],
    supported_fields: [
      "product_name", "brand", "category", "quantity", 
      "unit_price", "barcode", "barcode_serial", "confidence", "notes"
    ],
    usage: {
      method: "POST",
      body: {
        products: "ProductItem[] (required)",
        exportType: "'pdf' | 'excel' (required)",
        invoiceTitle: "string (optional)",
        invoiceNumber: "string (optional)",
        customerName: "string (optional)",
        companyName: "string (optional)",
        currency: "string (optional, default: EGP)",
        taxPercent: "number (optional)",
        discountPercent: "number (optional)"
      }
    },
    example: {
      exportType: "pdf",
      products: [
        {
          product_name: "منتج مثال",
          brand: "ماركة مثال",
          category: "تصنيف مثال",
          quantity: 5,
          unit_price: 100,
          barcode: "123456789",
          barcode_serial: "123456789",
          confidence: "high",
          notes: "ملاحظات"
        }
      ],
      customerName: "أحمد محمد",
      companyName: "شركة مثال",
      currency: "EGP"
    }
  });
}