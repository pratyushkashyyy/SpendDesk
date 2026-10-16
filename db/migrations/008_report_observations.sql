CREATE TABLE IF NOT EXISTS report_observations (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ads','shop')),
  report_date DATE NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (store_id,source,report_date,observed_at)
);
CREATE INDEX IF NOT EXISTS report_observations_recent ON report_observations(observed_at);

CREATE OR REPLACE FUNCTION observe_current_report() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  observation_time TIMESTAMPTZ;
  source_zone TEXT;
BEGIN
  IF NEW.payload IS NULL OR NEW.error IS NOT NULL OR NEW.payload->>'date' IS DISTINCT FROM NEW.report_date::text THEN RETURN NEW; END IF;
  source_zone := NEW.payload->>'timezone';
  BEGIN
    observation_time := (NEW.payload->>'fetchedAt')::timestamptz;
    -- A historical day refreshed today is NOT an observation made on that day.
    IF observation_time IS NULL OR source_zone IS NULL OR
       (observation_time AT TIME ZONE source_zone)::date <> NEW.report_date THEN RETURN NEW; END IF;
  EXCEPTION WHEN invalid_datetime_format OR invalid_parameter_value OR datetime_field_overflow THEN
    RETURN NEW;
  END;
  INSERT INTO report_observations(store_id,source,report_date,observed_at,timezone,payload)
    VALUES(NEW.store_id,NEW.source,NEW.report_date,observation_time,source_zone,NEW.payload - 'raw')
    ON CONFLICT DO NOTHING;
  DELETE FROM report_observations WHERE store_id=NEW.store_id AND source=NEW.source AND observed_at<clock_timestamp()-INTERVAL '8 days';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_report_observation ON reports;
CREATE TRIGGER record_report_observation AFTER INSERT OR UPDATE OF payload ON reports
  FOR EACH ROW EXECUTE FUNCTION observe_current_report();

-- Seed only genuine same-day observations still present in existing snapshots.
-- Trigger validation excludes historical backfills and malformed source metadata.
UPDATE reports SET payload=payload WHERE payload IS NOT NULL;
