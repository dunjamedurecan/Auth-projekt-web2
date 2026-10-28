CREATE TABLE IF NOT EXISTS passes (
  id         uuid PRIMARY KEY,
  name       text        NOT NULL,
  document   text        NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  status     text        NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'CANCELLED'))
);