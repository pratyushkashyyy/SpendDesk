ALTER TABLE google_connections DROP CONSTRAINT IF EXISTS google_connections_group_id_check;
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_group_id_check;
ALTER TABLE oauth_states ALTER COLUMN group_id DROP NOT NULL;
CREATE SEQUENCE IF NOT EXISTS google_connection_id_seq;
SELECT setval('google_connection_id_seq', GREATEST(COALESCE((SELECT max(group_id) FROM google_connections),0), COALESCE((SELECT max(group_id) FROM stores),0),1));
ALTER TABLE google_connections ALTER COLUMN group_id SET DEFAULT nextval('google_connection_id_seq');
CREATE UNIQUE INDEX IF NOT EXISTS google_connections_email_unique ON google_connections(lower(email));
