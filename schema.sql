CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'novo',
  criado_em TEXT NOT NULL,
  dados TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS pedidos_criado ON pedidos (criado_em);
