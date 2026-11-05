'use strict';
// Ma trận quyền: vai trò → danh sách năng lực. Đổi quyền của một vai trò chỉ cần sửa ở đây.
// user: người chơi thường. moderator: duyệt & quản lý game, nhiệm vụ, xem người dùng/nhật ký, cấm người chơi thường.
// admin: toàn quyền, gồm đổi vai trò và cài đặt hệ thống.
const CAPS = [
  'view_dashboard',  // xem thống kê tổng quan
  'review_games',    // duyệt / từ chối bản gửi game
  'manage_games',    // gỡ / bật lại game đã xuất bản
  'manage_tasks',    // tạo, sửa, bật/tắt nhiệm vụ thưởng
  'view_users',      // xem danh sách người dùng
  'ban_users',       // khoá / mở khoá tài khoản (không khoá admin)
  'view_audit',      // xem nhật ký thao tác
  'manage_roles',    // đổi vai trò người dùng
  'manage_settings', // chế độ thử nghiệm, cài đặt thưởng
];
const ROLE_CAPS = {
  user: [],
  moderator: ['view_dashboard', 'review_games', 'manage_games', 'manage_tasks', 'view_users', 'ban_users', 'view_audit'],
  admin: CAPS,
};
const ROLES = Object.keys(ROLE_CAPS);

const capsOf = role => ROLE_CAPS[role] || [];
const can = (user, cap) => !!user && capsOf(user.role).includes(cap);

module.exports = { CAPS, ROLES, ROLE_CAPS, capsOf, can };
