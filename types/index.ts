// app/types.ts

export interface ProductItem {
    product_name: string;
    brand: string | null;
    category: string;
    unit_price?: number | null;
    current_market_price?: number | null;
    price_currency?: string;
    price_confidence?: string;
    price_source?: string;
    quantity: number;
    barcode_serial?: string | null;
    confidence: 'high' | 'medium' | 'low';
    notes?: string;
  }
  
  export interface InventoryAnalysisResult {
    success?: boolean;
    business_type: string;
    analysis_quality: 'excellent' | 'good' | 'fair' | 'poor';
    detected_items_count: number;
    products: ProductItem[];
    warnings?: string[];
    suggestions?: string[];
    total_estimated_value?: number;
    currency_info?: {
      code: string;
      symbol: string;
      name: string;
      exchange_rate_to_usd: number;
    };
  }