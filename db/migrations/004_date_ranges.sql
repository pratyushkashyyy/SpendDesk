CREATE TABLE IF NOT EXISTS report_ranges (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ads','shop')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payload JSONB,
  error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,source,start_date,end_date)
);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='store_product_snapshots' AND column_name='report_date'
  ) THEN
    ALTER TABLE store_product_snapshots RENAME COLUMN report_date TO start_date;
    ALTER TABLE store_product_snapshots ADD COLUMN end_date DATE;
    UPDATE store_product_snapshots SET end_date=start_date WHERE end_date IS NULL;
    ALTER TABLE store_product_snapshots ALTER COLUMN end_date SET NOT NULL;
    ALTER TABLE store_product_snapshots DROP CONSTRAINT store_product_snapshots_pkey;
    ALTER TABLE store_product_snapshots ADD PRIMARY KEY (store_id,start_date,end_date);
  END IF;
END $$;
