-- Đăng nhập bằng Zalo (Zalo Mini App): liên kết tài khoản với ID người dùng Zalo của app.
-- Tài khoản tạo qua Zalo không có mật khẩu (pass_hash = '!').
ALTER TABLE users ADD COLUMN zalo_id TEXT;
CREATE UNIQUE INDEX users_zalo_id ON users (zalo_id) WHERE zalo_id IS NOT NULL;
