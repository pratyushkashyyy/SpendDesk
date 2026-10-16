CREATE TABLE IF NOT EXISTS budget_states (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  budgets JSONB NOT NULL,
  signature JSONB NOT NULL,
  total NUMERIC,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  history_checked_at TIMESTAMPTZ,
  history_next_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  history_error TEXT
);
CREATE TABLE IF NOT EXISTS budget_observed_changes (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  previous_at TIMESTAMPTZ NOT NULL,
  previous_budgets JSONB NOT NULL,
  budgets JSONB NOT NULL,
  previous_total NUMERIC,
  total NUMERIC,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  PRIMARY KEY(store_id,observed_at)
);
CREATE TABLE IF NOT EXISTS google_budget_events (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  budget_id TEXT NOT NULL,
  previous_amount NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  PRIMARY KEY(store_id,event_id)
);
CREATE INDEX IF NOT EXISTS google_budget_events_recent ON google_budget_events(store_id,changed_at DESC);

CREATE OR REPLACE FUNCTION capture_budget_configuration(store UUID, report JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  at_time TIMESTAMPTZ;
  config JSONB;
  sig JSONB;
  total_amount NUMERIC;
  old budget_states%ROWTYPE;
BEGIN
  IF report IS NULL OR jsonb_typeof(report->'budgets') IS DISTINCT FROM 'array' OR
     report->>'currency' IS NULL OR report->>'timezone' IS NULL THEN RETURN; END IF;
  BEGIN
    at_time := (report->>'fetchedAt')::timestamptz;
    IF at_time IS NULL OR at_time > clock_timestamp()+INTERVAL '5 minutes' THEN RETURN; END IF;
    -- Budgets are current configuration even when the selected report is historical.
    SELECT COALESCE(jsonb_agg(b ORDER BY b->>'id'),'[]'::jsonb),
      COALESCE(jsonb_object_agg(b->>'id',jsonb_build_object('amount',b->'amount','period',b->'period')),'{}'::jsonb),
      CASE WHEN COUNT(*) FILTER(WHERE jsonb_typeof(b->'amount') IS DISTINCT FROM 'number' OR b->>'period' IS DISTINCT FROM 'DAILY')>0 THEN NULL
           ELSE COALESCE(SUM((b->>'amount')::numeric),0) END
      INTO config,sig,total_amount
      FROM (SELECT DISTINCT ON (b->>'id') b FROM jsonb_array_elements(report->'budgets') b WHERE b->>'id' IS NOT NULL ORDER BY b->>'id') items;
  EXCEPTION WHEN invalid_datetime_format OR invalid_parameter_value OR datetime_field_overflow OR invalid_text_representation THEN RETURN;
  END;
  -- Serialize all report/range writes for one store without depending on report date order.
  PERFORM pg_advisory_xact_lock(734058,hashtext(store::text));
  SELECT * INTO old FROM budget_states WHERE store_id=store FOR UPDATE;
  IF FOUND THEN
    IF at_time <= old.confirmed_at THEN RETURN; END IF;
    IF old.signature IS DISTINCT FROM sig OR old.currency IS DISTINCT FROM report->>'currency' THEN
      INSERT INTO budget_observed_changes(store_id,observed_at,previous_at,previous_budgets,budgets,previous_total,total,currency,timezone)
      VALUES(store,at_time,old.confirmed_at,old.budgets,config,CASE WHEN old.currency=report->>'currency' THEN old.total ELSE NULL END,total_amount,report->>'currency',report->>'timezone') ON CONFLICT DO NOTHING;
      UPDATE budget_states SET changed_at=at_time,history_next_at=LEAST(history_next_at,at_time+INTERVAL '3 minutes') WHERE store_id=store;
    END IF;
    UPDATE budget_states SET budgets=config,signature=sig,total=total_amount,currency=report->>'currency',timezone=report->>'timezone',confirmed_at=at_time WHERE store_id=store;
  ELSE
    INSERT INTO budget_states(store_id,budgets,signature,total,currency,timezone,changed_at,confirmed_at)
    VALUES(store,config,sig,total_amount,report->>'currency',report->>'timezone',at_time,at_time);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION observe_budget_configuration() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source='ads' AND NEW.error IS NULL THEN PERFORM capture_budget_configuration(NEW.store_id,NEW.payload); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_budget_configuration ON reports;
CREATE TRIGGER record_budget_configuration AFTER INSERT OR UPDATE OF payload ON reports FOR EACH ROW EXECUTE FUNCTION observe_budget_configuration();
DROP TRIGGER IF EXISTS record_range_budget_configuration ON report_ranges;
CREATE TRIGGER record_range_budget_configuration AFTER INSERT OR UPDATE OF payload ON report_ranges FOR EACH ROW EXECUTE FUNCTION observe_budget_configuration();
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT store_id,payload FROM (
    SELECT store_id,payload FROM reports WHERE source='ads' AND payload IS NOT NULL AND error IS NULL
    UNION ALL SELECT store_id,payload FROM report_ranges WHERE source='ads' AND payload IS NOT NULL AND error IS NULL
  ) saved ORDER BY payload->>'fetchedAt' ASC LOOP
    PERFORM capture_budget_configuration(r.store_id,r.payload);
  END LOOP;
END $$;
