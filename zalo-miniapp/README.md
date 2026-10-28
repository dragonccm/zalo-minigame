# GameHub — bản thử nghiệm Zalo Mini App

Mini App nhỏ để kiểm tra GameHub chạy được bên trong Zalo trước khi chuyển cả cổng game sang.
Mở app trong Zalo, bấm **Chạy kiểm tra**, đọc 5 dòng kết quả rồi bấm **Sao chép kết quả** để gửi lại.

| # | Kiểm tra | Nếu lỗi thì thường do |
|---|---|---|
| 1 | Gọi API máy chủ | `CORS_ORIGINS` của máy chủ thiếu nguồn của Mini App (xem dòng `origin` trong phần thông tin môi trường); tên miền API chưa khai báo trong trang quản lý Mini App |
| 2 | Đăng nhập bằng Zalo | Máy chủ thiếu/sai `ZALO_APP_SECRET`; Mini App chưa được cấp quyền; chạy ngoài Zalo (bình thường sẽ lỗi) |
| 3 | Giữ phiên bằng token | Máy chủ chưa phải bản có hỗ trợ `Authorization: Bearer` |
| 4 | WebSocket (chơi online) | Zalo chặn `wss://` tới tên miền chưa khai báo; proxy không chuyển tiếp WebSocket |
| 5 | Game trong iframe | Zalo không cho nhúng iframe; `CORS_ORIGINS` thiếu nguồn Mini App (máy chủ dùng nó làm `frame-ancestors`) |

## Chuẩn bị (làm một lần)

1. Tạo Zalo App ở <https://developers.zalo.me>, rồi tạo Mini App ở <https://mini.zalo.me> để có **Mini App ID**.
2. Máy chủ GameHub chạy HTTPS (vd bản k3s trong `../k8s`), có đặt:
   - `CORS_ORIGINS=https://h5.zdn.vn` (thêm `http://localhost:3000` khi dev). Nếu dòng `origin` trong kết quả kiểm tra khác, thêm đúng giá trị đó.
   - `ZALO_APP_SECRET=<khoá bí mật của Zalo App>`
3. Trong trang quản lý Mini App, khai báo tên miền máy chủ GameHub (cả `https://` và `wss://` nếu có mục riêng).
4. Cài công cụ: `npm install -g zmp-cli`, rồi `zmp login`.

## Chạy

Zalo **không dùng `index.html`** của dự án: nó tự sinh trang và nạp các file khai báo trong `app-config.json`
(`assets/app.css`, `assets/app.js`). Vì vậy `vite.config.js` build ra một file JS dạng IIFE tên cố định và giao diện được dựng bằng JS.
Chưa deploy mà mở Mini App trong Zalo sẽ thấy trang **404 Not Found (nginx)**.

```bash
cd zalo-miniapp
npm install

# xem trên trình duyệt máy tính (bước 2 lỗi vì không ở trong Zalo — bình thường)
GAMEHUB_API=http://localhost:8080 npm run dev

# đăng nhập tài khoản nhà phát triển (quét QR bằng Zalo) và nhập Mini App ID — lưu vào .env
npm run login

# build + đưa lên Zalo (mặc định trỏ tới https://gamecenter.logthinks.com)
npm run deploy          # bản Development
npm run deploy:test     # bản Testing
```

Đổi máy chủ: `GAMEHUB_API=https://... npm run deploy` (địa chỉ được gắn vào lúc build).
