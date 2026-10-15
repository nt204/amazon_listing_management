-- db/migrations/089_accounting_orders.sql
CREATE TABLE IF NOT EXISTS accounting_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  date DATE,
  amazon_order_id TEXT NOT NULL,
  merchant_order_id TEXT,
  purchase_date TIMESTAMPTZ,
  last_updated_date TIMESTAMPTZ,
  order_status TEXT,
  fulfillment_channel TEXT,
  sales_channel TEXT,
  order_channel TEXT,
  url TEXT,
  ship_service_level TEXT,
  product_name TEXT,
  sku TEXT NOT NULL,
  asin TEXT,
  item_status TEXT,
  quantity INTEGER DEFAULT 1,
  currency TEXT DEFAULT 'USD',
  item_price NUMERIC(12, 2),
  item_tax NUMERIC(12, 2),
  shipping_price NUMERIC(12, 2),
  shipping_tax NUMERIC(12, 2),
  gift_wrap_price NUMERIC(12, 2),
  gift_wrap_tax NUMERIC(12, 2),
  item_promotion_discount NUMERIC(12, 2),
  ship_promotion_discount NUMERIC(12, 2),
  ship_city TEXT,
  ship_state TEXT,
  ship_postal_code TEXT,
  ship_country TEXT,
  promotion_ids TEXT,
  is_business_order BOOLEAN DEFAULT FALSE,
  purchase_order_number TEXT,
  price_designation TEXT,
  customized_url TEXT,
  customized_page TEXT,
  signature_confirmation_recommended BOOLEAN DEFAULT FALSE,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_orders_store_order_sku UNIQUE (store_id, amazon_order_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_accounting_orders_store ON accounting_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_accounting_orders_purchase_date ON accounting_orders(store_id, purchase_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_accounting_orders_date ON accounting_orders(store_id, date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_accounting_orders_order_id ON accounting_orders(store_id, amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_accounting_orders_sku ON accounting_orders(store_id, sku);
CREATE INDEX IF NOT EXISTS idx_accounting_orders_asin ON accounting_orders(store_id, asin);
CREATE INDEX IF NOT EXISTS idx_accounting_orders_status ON accounting_orders(store_id, order_status);
