CREATE TABLE IF NOT EXISTS mcp_oauth (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('client','code','access','refresh')),
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_expiry ON mcp_oauth(expires_at);
