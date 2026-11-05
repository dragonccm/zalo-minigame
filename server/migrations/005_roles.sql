-- Vai trò: thêm "moderator" (duyệt game, quản lý nhiệm vụ, cấm người chơi). Quyền chi tiết nằm trong server/permissions.js.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'moderator', 'admin'));
