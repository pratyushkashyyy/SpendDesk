CREATE TABLE IF NOT EXISTS store_product_snapshots (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payload JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,start_date,end_date)
);
CREATE TABLE IF NOT EXISTS product_campaign_links (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  PRIMARY KEY (store_id,product_id,campaign_id)
);
