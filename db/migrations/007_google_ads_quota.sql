CREATE TABLE IF NOT EXISTS google_ads_quota_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  daily_limit INTEGER NOT NULL DEFAULT 2880 CHECK (daily_limit > 0),
  spacing_ms INTEGER NOT NULL DEFAULT 1000 CHECK (spacing_ms >= 0)
);
INSERT INTO google_ads_quota_policy(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS google_ads_quota_state (
  scope TEXT PRIMARY KEY,
  tracked_since TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  next_request_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  cooldown_until TIMESTAMPTZ,
  exhausted_until TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS google_ads_operations (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL REFERENCES google_ads_quota_state(scope),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  operations INTEGER NOT NULL CHECK (operations IN (0,1)),
  background BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS google_ads_operations_window ON google_ads_operations(scope,requested_at);

-- One server-side transaction avoids both cross-process races and pool deadlocks:
-- callers can use an already-reserved report/product connection.
CREATE OR REPLACE FUNCTION reserve_google_ads_request(p_scope TEXT, p_background BOOLEAN, p_charge BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  state google_ads_quota_state%ROWTYPE;
  policy google_ads_quota_policy%ROWTYPE;
  current_time_at TIMESTAMPTZ;
  used INTEGER;
  event_id BIGINT;
  resume_at TIMESTAMPTZ;
BEGIN
  INSERT INTO google_ads_quota_state(scope) VALUES(p_scope) ON CONFLICT DO NOTHING;
  SELECT * INTO state FROM google_ads_quota_state WHERE scope=p_scope FOR UPDATE;
  SELECT * INTO policy FROM google_ads_quota_policy WHERE singleton=TRUE;
  current_time_at := clock_timestamp();
  DELETE FROM google_ads_operations WHERE scope=p_scope AND requested_at <= current_time_at - INTERVAL '24 hours';
  SELECT COALESCE(SUM(operations),0)::integer INTO used FROM google_ads_operations WHERE scope=p_scope;
  IF state.exhausted_until > current_time_at THEN
    RETURN jsonb_build_object('reason','exhausted','resumeAt',state.exhausted_until);
  END IF;
  IF used >= policy.daily_limit OR (p_background AND used >= CEIL(policy.daily_limit * 0.8)) THEN
    -- Find the event whose expiry releases enough room, including any manual reserve usage.
    SELECT requested_at + INTERVAL '24 hours' INTO resume_at FROM (
      SELECT requested_at, SUM(operations) OVER (ORDER BY requested_at,id) AS released
      FROM google_ads_operations WHERE scope=p_scope
    ) history WHERE released > used - CASE WHEN p_background THEN CEIL(policy.daily_limit * 0.8) ELSE policy.daily_limit END
    ORDER BY requested_at LIMIT 1;
    RETURN jsonb_build_object('reason',CASE WHEN p_background AND used < policy.daily_limit THEN 'background' ELSE 'exhausted' END,'resumeAt',resume_at);
  END IF;
  IF state.cooldown_until > current_time_at THEN
    RETURN jsonb_build_object('reason','cooldown','resumeAt',state.cooldown_until);
  END IF;
  IF state.next_request_at > current_time_at THEN
    RETURN jsonb_build_object('reason','spacing','waitMs',CEIL(EXTRACT(EPOCH FROM state.next_request_at-current_time_at)*1000));
  END IF;
  INSERT INTO google_ads_operations(scope,operations,background)
    VALUES(p_scope,CASE WHEN p_charge THEN 1 ELSE 0 END,p_background) RETURNING id INTO event_id;
  UPDATE google_ads_quota_state SET next_request_at=current_time_at + policy.spacing_ms * INTERVAL '1 millisecond' WHERE scope=p_scope;
  RETURN jsonb_build_object('reason','allowed','eventId',event_id,'used',used+CASE WHEN p_charge THEN 1 ELSE 0 END);
END $$;
