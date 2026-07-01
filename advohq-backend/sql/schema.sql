-- ════════════════════════════════════════════════
--  AdvoHQ · PostgreSQL Schema
--  Compatible with Neon (serverless Postgres)
--  Run once on a fresh database
-- ════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ──────────────────────────────────────
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member'   -- 'admin' | 'member'
                CHECK (role IN ('admin','member')),
  avatar_initials TEXT GENERATED ALWAYS AS (
    upper(left(full_name, 1))
  ) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── FOLDERS ────────────────────────────────────
CREATE TABLE folders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  parent_id    UUID REFERENCES folders(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── CASES ──────────────────────────────────────
--   Mirrors the localStorage "files" array in advohq-home.html
CREATE TABLE cases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  client_name   TEXT,
  file_type     TEXT NOT NULL DEFAULT 'pdf'
                CHECK (file_type IN ('pdf','docx','xlsx','pptx','img','txt','folder')),

  -- Stage tracking (matches STAGES array in frontend)
  stage_id      SMALLINT NOT NULL DEFAULT 0,    -- 0-7 predefined
  custom_stage  TEXT,                           -- if stage_id = -1

  assigned_to   TEXT,
  next_date     DATE,                           -- "Next Date" column
  end_date      DATE,                           -- deadline
  end_time      TIME,

  case_no       TEXT,                           -- from the case info panel
  hall          TEXT,
  court         TEXT,
  notes         TEXT,

  tags          TEXT[] DEFAULT '{}',
  folder_id     UUID REFERENCES folders(id) ON DELETE SET NULL,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  is_trashed    BOOLEAN NOT NULL DEFAULT false,
  trashed_at    TIMESTAMPTZ,

  file_size     BIGINT,                         -- bytes
  s3_key        TEXT,                           -- AWS S3 object key

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── EVENTS / SCHEDULE ──────────────────────────
--   Mirrors the schedule page (hearings, meetings, deadlines, filings)
CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID REFERENCES cases(id) ON DELETE CASCADE,
  case_name    TEXT,                           -- denormalised for quick display
  event_type   TEXT NOT NULL DEFAULT 'hearing'
               CHECK (event_type IN ('hearing','meeting','deadline','filing','other')),
  title        TEXT NOT NULL,
  event_date   DATE NOT NULL,
  event_time   TIME,
  court        TEXT,
  judge        TEXT,
  notes        TEXT,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── FILE ANNOTATIONS ───────────────────────────
--   Highlights / comments added in advohq-file.html
CREATE TABLE annotations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_number  SMALLINT NOT NULL DEFAULT 1,
  ann_type     TEXT NOT NULL DEFAULT 'highlight'
               CHECK (ann_type IN ('highlight','comment','underline')),
  color        TEXT NOT NULL DEFAULT '#FFD700',
  content      TEXT,                          -- comment text
  -- Bounding box (% of page, for canvas rendering)
  x            FLOAT,
  y            FLOAT,
  width        FLOAT,
  height       FLOAT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── REFRESH TOKENS ─────────────────────────────
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── INDEXES ────────────────────────────────────
CREATE INDEX idx_cases_owner     ON cases(owner_id);
CREATE INDEX idx_cases_trashed   ON cases(is_trashed);
CREATE INDEX idx_cases_folder    ON cases(folder_id);
CREATE INDEX idx_folders_owner   ON folders(owner_id);
CREATE INDEX idx_folders_parent  ON folders(parent_id);
CREATE INDEX idx_events_date     ON events(event_date);
CREATE INDEX idx_events_owner    ON events(owner_id);
CREATE INDEX idx_events_case     ON events(case_id);
CREATE INDEX idx_annotations_case ON annotations(case_id);
CREATE INDEX idx_refresh_tokens   ON refresh_tokens(user_id);

-- ── AUTO-UPDATE updated_at ─────────────────────
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_upd   BEFORE UPDATE ON users   FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_cases_upd   BEFORE UPDATE ON cases   FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_folders_upd BEFORE UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_events_upd  BEFORE UPDATE ON events  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ── SEED: default admin user ───────────────────
--   Password: "advohq2025"  (bcrypt, cost 12)
--   Change immediately after first login!
INSERT INTO users (username, email, password_hash, full_name, role) VALUES
  ('admin', 'admin@advohq.app',
   '$2b$12$8z5r3zKq.5e/sWqgbnsTQuzJL.HoxRYQT3MmhNi3/x7RWK7Gqm4wO',
   'Admin User', 'admin');
