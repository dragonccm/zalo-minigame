-- Bỏ emoji: avatar người dùng và icon nhiệm vụ lưu bằng tên icon Lucide (vd 'smile', 'radio')
-- + thêm loại nhiệm vụ: live Facebook, Zalo OA
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check CHECK (type IN
  ('tiktok_live', 'tiktok_video', 'facebook_post', 'facebook_live', 'facebook_page', 'youtube', 'instagram', 'zalo', 'link'));
ALTER TABLE users ALTER COLUMN avatar SET DEFAULT 'smile';
UPDATE users SET avatar = CASE avatar
    WHEN '🙂' THEN 'smile' WHEN '😎' THEN 'glasses' WHEN '🤖' THEN 'bot' WHEN '👾' THEN 'ghost'
    WHEN '🦊' THEN 'squirrel' WHEN '🐱' THEN 'cat' WHEN '🐼' THEN 'rabbit' WHEN '🦄' THEN 'sparkles'
    WHEN '🐲' THEN 'bird' WHEN '🚀' THEN 'rocket' WHEN '⚡' THEN 'zap' WHEN '🔥' THEN 'flame'
    WHEN '🎮' THEN 'gamepad-2' WHEN '👑' THEN 'crown' WHEN '🧙' THEN 'wand-sparkles' WHEN '🥷' THEN 'swords'
    WHEN '🛡️' THEN 'shield' WHEN '🛡' THEN 'shield' ELSE 'smile' END
  WHERE avatar !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
UPDATE tasks SET icon = CASE type
    WHEN 'tiktok_live' THEN 'radio' WHEN 'tiktok_video' THEN 'music-2' WHEN 'facebook_post' THEN 'newspaper'
    WHEN 'facebook_page' THEN 'thumbs-up' WHEN 'youtube' THEN 'circle-play' WHEN 'instagram' THEN 'camera' ELSE 'link' END
  WHERE icon !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
