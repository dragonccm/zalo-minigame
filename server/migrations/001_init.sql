-- GameHub schema v1 (PostgreSQL)

-- ======================= người dùng & phiên =======================
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 24),
  pass_hash     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar        TEXT NOT NULL DEFAULT '🙂',
  bio           TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 200),
  xp            INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  banned        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_username_ci ON users (lower(username));
CREATE INDEX users_xp ON users (xp DESC) WHERE NOT banned;

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- ======================= game & duyệt game =======================
CREATE TABLE games (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  owner_id     BIGINT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  version      TEXT NOT NULL,
  manifest     JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'unpublished')),
  builtin      BOOLEAN NOT NULL DEFAULT false,
  plays        BIGINT NOT NULL DEFAULT 0 CHECK (plays >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_status ON games (status, plays DESC);

CREATE TABLE submissions (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT NOT NULL,
  owner_id     BIGINT NOT NULL REFERENCES users(id),
  version      TEXT NOT NULL,
  manifest     JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  report       JSONB NOT NULL DEFAULT '{}',
  note         TEXT NOT NULL DEFAULT '',
  reviewer_id  BIGINT REFERENCES users(id),
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  file_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX submissions_status ON submissions (status, id DESC);
CREATE INDEX submissions_owner ON submissions (owner_id, id DESC);
-- mỗi slug chỉ có tối đa 1 bản đang chờ duyệt
CREATE UNIQUE INDEX submissions_one_pending ON submissions (slug) WHERE status = 'pending';

-- lịch sử các phiên bản đã xuất bản (để tra cứu / quay lại)
CREATE TABLE game_versions (
  id             BIGSERIAL PRIMARY KEY,
  game_id        BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version        TEXT NOT NULL,
  manifest       JSONB NOT NULL,
  submission_id  BIGINT REFERENCES submissions(id),
  published_by   BIGINT REFERENCES users(id),
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, version)
);

-- ======================= dữ liệu người chơi =======================
CREATE TABLE scores (
  id          BIGSERIAL PRIMARY KEY,
  game_id     BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       DOUBLE PRECISION NOT NULL,
  meta        JSONB NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'server')),  -- server = do phòng multiplayer tính
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scores_game_user ON scores (game_id, user_id, score DESC);
CREATE INDEX scores_game_time ON scores (game_id, created_at);

CREATE TABLE user_achievements (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id      BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id, key)
);
CREATE INDEX user_achievements_game ON user_achievements (game_id);

CREATE TABLE saves (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id     BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  data        JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE plays (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  game_id       BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  duration_sec  INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0)
);
CREATE INDEX plays_user ON plays (user_id, started_at DESC);
CREATE INDEX plays_game ON plays (game_id, started_at);

-- ======================= cài đặt & nhiệm vụ nhận thưởng =======================
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id            BIGSERIAL PRIMARY KEY,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  type          TEXT NOT NULL CHECK (type IN ('tiktok_live', 'tiktok_video', 'facebook_post', 'facebook_page', 'youtube', 'instagram', 'link')),
  url           TEXT NOT NULL CHECK (url ~ '^https?://'),
  description   TEXT NOT NULL DEFAULT '',
  icon          TEXT NOT NULL DEFAULT '🔗',
  duration_sec  INTEGER NOT NULL DEFAULT 30 CHECK (duration_sec BETWEEN 0 AND 600),
  verify        TEXT NOT NULL DEFAULT 'time' CHECK (verify IN ('time', 'code')),
  code          TEXT NOT NULL DEFAULT '',
  daily_limit   INTEGER NOT NULL DEFAULT 3 CHECK (daily_limit BETWEEN 1 AND 50),
  priority      INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (verify = 'time' OR code <> '')
);

CREATE TABLE task_runs (
  id            BIGSERIAL PRIMARY KEY,
  task_id       BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  game_id       BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  placement     TEXT NOT NULL,
  viewer        TEXT NOT NULL,                -- u:<userId> hoặc g:<hash ip> (khách)
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'canceled')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  consumed_at   TIMESTAMPTZ                   -- phòng multiplayer đã dùng token thưởng này (chống dùng lại)
);
CREATE INDEX task_runs_viewer ON task_runs (viewer, completed_at) WHERE status = 'completed';
CREATE INDEX task_runs_task ON task_runs (task_id, started_at);

-- ======================= multiplayer =======================
CREATE TABLE rooms (
  id            TEXT PRIMARY KEY,
  game_id       BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('relay', 'authoritative')),
  code          TEXT,                          -- mã phòng riêng (null = phòng công khai)
  max_players   INTEGER NOT NULL,
  peak_players  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);
CREATE INDEX rooms_game ON rooms (game_id, created_at DESC);

-- mỗi "mạng" của người chơi trong một phòng (vào trận -> chết/rời phòng)
CREATE TABLE matches (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_id       BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  display_name  TEXT NOT NULL,
  score         DOUBLE PRECISION NOT NULL DEFAULT 0,
  kills         INTEGER NOT NULL DEFAULT 0,
  max_value     INTEGER NOT NULL DEFAULT 0,
  rank_in_room  INTEGER,
  end_reason    TEXT NOT NULL DEFAULT 'death' CHECK (end_reason IN ('death', 'left', 'room_closed')),
  killed_by     TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX matches_user ON matches (user_id, ended_at DESC);
CREATE INDEX matches_room ON matches (room_id);

-- ======================= nhật ký quản trị =======================
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time ON audit_log (created_at DESC);
