import { NextRequest, NextResponse } from "next/server";

// Types
type Confidence = "high" | "medium" | "low";

interface ProductItem {
  product_name: string;
  brand: string;
  category: string;
  unit_price: string;
  quantity: number | string;
  barcode: string;
  confidence: Confidence;
  notes: string;
}

interface ExportRequest {
  spreadsheetId: string;
  products: ProductItem[];
}

// Validate spreadsheet ID format
function isValidSpreadsheetId(id: string): boolean {
  // Google Sheets IDs are typically 44 characters alphanumeric
  return /^[a-zA-Z0-9_-]{20,60}$/.test(id);
}

// Convert products to Google Sheets rows
function productsToRows(products: ProductItem[]): (string | number)[][] {
  const headers = ["#", "اسم المنتج", "الماركة", "التصنيف", "الكمية", "سعر الوحدة", "الإجمالي", "الباركود", "الحالة", "ملاحظات"];
  
  const rows = products.map((product, index) => {
    const price = parseFloat(String(product.unit_price).replace(/[^\d.]/g, "")) || 0;
    const qty = Number(product.quantity) || 0;
    const total = price * qty;
    
    const confidenceLabel = {
      high: "✓ موافق",
      medium: "~ يحتاج مراجعة",
      low: "✗ غير موافق"
    }[product.confidence];

    return [
      index + 1,
      product.product_name || "",
      product.brand || "",
      product.category || "",
      qty,
      price,
      total,
      product.barcode || "",
      confidenceLabel,
      product.notes || ""
    ];
  });

  return [headers, ...rows];
}

// Main export function
async function exportToGoogleSheets(
  spreadsheetId: string,
  products: ProductItem[]
): Promise<{ success: boolean; spreadsheetUrl: string }> {
  // ============================================================
  // ⚠️ استبدل هذا بـ Google Sheets API الحقيقي
  // ============================================================

  // مثال: استخدام Google Sheets API
  // const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
  // 
  // const values = productsToRows(products);
  // 
  // await sheets.spreadsheets.values.append({
  //   spreadsheetId,
  //   range: 'Sheet1!A:J',
  //   valueInputOption: 'RAW',
  //   requestBody: { values }
  // });

  // ============================================================
  // Demo: محاكاة التصدير
  // ============================================================
  await new Promise(resolve => setTimeout(resolve, 1000));

  const rows = productsToRows(products);
  console.log(`[Sheets Export] Exporting ${rows.length} rows to spreadsheet: ${spreadsheetId}`);
  
  // يمكنك حفظ البيانات في قاعدة البيانات أو أي مكان آخر هنا
  // await saveToDatabase(products);

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return {
    success: true,
    spreadsheetUrl
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ExportRequest = await request.json();
    const { spreadsheetId, products } = body;

    // Validation
    if (!spreadsheetId) {
      return NextResponse.json(
        { success: false, error: "معرف جدول البيانات مطلوب" },
        { status: 400 }
      );
    }

    if (!isValidSpreadsheetId(spreadsheetId)) {
      return NextResponse.json(
        { success: false, error: "معرف جدول البيانات غير صالح" },
        { status: 400 }
      );
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { success: false, error: "لا توجد منتجات للتصدير" },
        { status: 400 }
      );
    }

    // Export to Google Sheets
    const result = await exportToGoogleSheets(spreadsheetId, products);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: "فشل التصدير إلى جدول البيانات" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `تم تصدير ${products.length} منتج بنجاح`,
      spreadsheetUrl: result.spreadsheetUrl,
      exportedCount: products.length
    });

  } catch (error) {
    console.error("Sheets Export Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "حدث خطأ أثناء التصدير",
        detail: error instanceof Error ? error.message : "خطأ غير معروف"
      },
      { status: 500 }
    );
  }
}

// GET for checking API status
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/sheets",
    message: "Google Sheets Export API is running",
    usage: "POST with { spreadsheetId, products } to export data"
  });
}
