-- Older workers wrote planned quota pauses as source failures. Remove only
-- those known markers when a saved payload exists, preserving real errors,
-- payloads and original timestamps. Current quota state is shown separately.
UPDATE reports SET error=NULL WHERE payload IS NOT NULL AND error IN (
  'Google API background sync paused at 80% of the rolling daily budget. Saved reports remain available; manual refreshes can use the reserved allowance.',
  'Google API daily quota is exhausted. Google requests are paused until allowance becomes available; saved reports remain available.',
  'Google API requests are cooling down after a rate limit. Saved reports remain available; try again after the cooldown.'
);
UPDATE report_ranges SET error=NULL WHERE payload IS NOT NULL AND error IN (
  'Google API background sync paused at 80% of the rolling daily budget. Saved reports remain available; manual refreshes can use the reserved allowance.',
  'Google API daily quota is exhausted. Google requests are paused until allowance becomes available; saved reports remain available.',
  'Google API requests are cooling down after a rate limit. Saved reports remain available; try again after the cooldown.'
);
