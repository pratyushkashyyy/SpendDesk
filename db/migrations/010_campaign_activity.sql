ALTER TABLE budget_states ADD COLUMN IF NOT EXISTS campaign_activity JSONB;
CREATE OR REPLACE FUNCTION observe_campaign_activity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE activity JSONB;
BEGIN
  IF NEW.source='ads' AND NEW.error IS NULL THEN
    activity := NEW.payload->'raw'->'campaignActivity';
    IF jsonb_typeof(activity)='object' AND activity->>'complete'='true' AND activity->>'at' IS NOT NULL THEN
      UPDATE budget_states SET campaign_activity=activity
      WHERE store_id=NEW.store_id AND (campaign_activity IS NULL OR campaign_activity->>'at'<activity->>'at');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_campaign_activity ON reports;
CREATE TRIGGER record_campaign_activity AFTER INSERT OR UPDATE OF payload ON reports FOR EACH ROW EXECUTE FUNCTION observe_campaign_activity();
DROP TRIGGER IF EXISTS record_campaign_activity ON report_ranges;
CREATE TRIGGER record_campaign_activity AFTER INSERT OR UPDATE OF payload ON report_ranges FOR EACH ROW EXECUTE FUNCTION observe_campaign_activity();
-- Existing stores need a one-time history import; subsequent hourly syncs maintain it.
UPDATE budget_states SET history_next_at=now() WHERE campaign_activity IS NULL;
