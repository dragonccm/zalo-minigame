# GameHub — cổng game HTML5 (kiểu Zingplay / game .io)

Người chơi vào web, chơi nhiều game (một mình hoặc **online nhiều người**), **đăng nhập để lưu thành tích, hồ sơ, tiến trình, lịch sử trận**.
Nhà phát triển **upload game theo chuẩn riêng**, **admin xem thử và duyệt** rồi game mới được xuất bản.

## Chạy

```bash
cd gamehub
npm install
cp .env.example .env          # sửa ADMIN_PASS, APP_SECRET
npm run db:up                 # PostgreSQL 17 trong Docker (container gamehub-postgres, cổng 127.0.0.1:55440)
npm start                     # http://localhost:8080
```
Lần chạy đầu tự tạo bảng (migrations), tài khoản admin, cài game có sẵn và 2 nhiệm vụ mẫu.
Không muốn dùng Docker? Bỏ trống `DATABASE_URL` → dùng **PGlite** (PostgreSQL nhúng, lưu ở `data/pgdata`) — cùng SQL, hợp để phát triển.

| Biến (.env) | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | (trống = PGlite) | chuỗi kết nối PostgreSQL |
| `DB_POOL_MAX` | 10 | số kết nối tối đa |
| `APP_SECRET` | ngẫu nhiên mỗi lần chạy | bí mật ký token (vé realtime, xem thử, token nhiệm vụ) — **đặt cố định khi chạy thật** |
| `ADMIN_USER` / `ADMIN_PASS` | admin / ngẫu nhiên | admin tạo ở lần chạy đầu |
| `PORT` | 8080 | cổng |
| `COOKIE_SECURE` / `TRUST_PROXY` | 0 | đặt `1` khi chạy HTTPS / sau reverse proxy |
| `UPLOADS_PER_HOUR` | 10 | giới hạn upload / người / giờ |

## Tính năng

**Game có sẵn** (`seed-games/`, tự cài khi khởi động — đổi `version` trong `gamehub.json` để cài lại):

| Game | Kiểu | Điểm nổi bật |
|---|---|---|
| **Cubes 2048 Arena** | .io 3D | online nhiều người (máy chủ chạy logic), bot, skin, nhiệm vụ thưởng |
| **Cờ Vua** | cờ bàn | đủ luật (perft chuẩn), AI 5 cấp trong Web Worker, **online 1-1** có đồng hồ (máy chủ kiểm tra nước đi — `server/rooms/chess.js` dùng chung `chess-rules.js`), hai người một máy, gợi ý qua nhiệm vụ |
| **Diều Chiến** | arcade | chọi diều: kéo/nhả dây, chéo dây để cứa đứt dây đối thủ, bot AI, màn chơi tăng dần, đồ nhặt, đàn chim, cửa hàng nâng cấp & mẫu diều |

- **Tài khoản & hồ sơ**: đăng ký/đăng nhập (scrypt bất đồng bộ, phiên cookie HttpOnly), avatar, giới thiệu, cấp độ/XP, đổi mật khẩu; hồ sơ công khai có điểm cao nhất, thành tựu, game hay chơi, **lịch sử trận online**.
- **Portal**: trang chủ lọc thể loại/tìm kiếm, trang chơi (iframe sandbox, toàn màn hình), bảng xếp hạng ngày/tuần/tất cả, thành tựu.
- **Chuẩn game** (`gamehub.json` + SDK `postMessage`): điểm, thành tựu, lưu game lên tài khoản, thống kê lượt chơi, **nhiệm vụ nhận thưởng**, **multiplayer** — xem trang *Tài liệu* (`public/docs.html`).
- **Multiplayer realtime** (WebSocket `/rt`):
  - *relay* — game nào đăng lên cũng dùng được: phòng công khai/phòng riêng có mã, tin nhắn, trạng thái phòng, host tự chuyển.
  - *authoritative* — máy chủ chạy logic game (chỉ game hệ thống). **Cubes 2048** chơi online: máy chủ mô phỏng đấu trường 20 lần/giây (va chạm, bot, điểm), client nội suy/dự đoán, **máy chủ tự ghi điểm** nên không gian lận được; phần thưởng nhiệm vụ (hồi sinh, khởi đầu mạnh, siêu sức mạnh) được máy chủ xác minh bằng token dùng 1 lần. Trong lúc người chơi làm nhiệm vụ, nhân vật **tàng hình + bất tử** (đứng yên, không va chạm, người khác không thấy); máy chủ chỉ cho bật khi portal đã báo có phiên nhiệm vụ thật, hết phiên là tự hiện lại kèm 4 giây khiên.
- **Nhiệm vụ nhận thưởng** (thay cho quảng cáo thưởng): admin tạo nhiệm vụ ở *Quản trị › Nhiệm vụ* — có **mẫu nhanh** (live/video TikTok, bài viết/live/fanpage Facebook, YouTube, Instagram, Zalo OA, website), chọn icon, nhân bản, bật/tắt, hạn kết thúc, mã xác nhận; game gọi `GameHub.requestReward()`. Lần chạy đầu có sẵn 6 nhiệm vụ mẫu.
  - **Chế độ thử nghiệm** (công tắc trong trang đó): bỏ cooldown và mọi giới hạn lượt, mỗi nhiệm vụ chỉ chờ tối đa 5 giây — dùng khi đang làm game, nhớ tắt khi chạy thật.
  - Hết lượt mọi nhiệm vụ trong ngày → game báo "đã làm hết nhiệm vụ hôm nay" (`tasks_done`), khác với "chưa có nhiệm vụ" (`no_tasks`).
- **Icon**: toàn bộ giao diện dùng icon SVG [Lucide](https://lucide.dev) (ISC), không dùng emoji. Danh sách icon ở `tools/build-icons.js` → `npm run icons` sinh `public/icons.js` và `seed-games/cubes-2048/icons.js`. Avatar, icon thành tựu (`gamehub.json`) và icon nhiệm vụ lưu bằng **tên icon**.
- **Upload & duyệt**: kiểm tra gói tự động → hàng đợi → admin xem file, chơi thử (có nhật ký lệnh SDK), duyệt/từ chối kèm lý do; lưu **lịch sử phiên bản** đã xuất bản.
- **Quản trị**: thống kê (kể cả người/phòng đang online), hàng đợi, game, nhiệm vụ, người dùng, **nhật ký thao tác (audit log)**.

## Cơ sở dữ liệu (PostgreSQL)

Schema ở `server/migrations/*.sql`, tự áp dụng khi khởi động (bảng `schema_migrations`). Muốn đổi schema: thêm file `002_ten.sql` — **không sửa file đã chạy**.

| Nhóm | Bảng |
|---|---|
| Tài khoản | `users` (username không phân biệt hoa thường), `sessions` |
| Game | `games` (manifest JSONB), `game_versions`, `submissions` (tối đa 1 bản chờ duyệt / slug) |
| Người chơi | `scores` (`source` = client / server), `user_achievements`, `saves` (JSONB), `plays` |
| Nhiệm vụ | `tasks`, `task_runs` (`consumed_at` chống dùng lại token) , `settings` |
| Multiplayer | `rooms`, `matches` (mỗi "mạng"/ván trong phòng: điểm, số đối thủ nuốt, hạng trong phòng, kết thúc: chết / rời / phòng đóng / thắng / thua / hòa) |
| Quản trị | `audit_log` |

Có ràng buộc `CHECK`, khóa ngoại `ON DELETE`, chỉ mục cho bảng xếp hạng / lịch sử. Toàn bộ truy vấn dùng tham số (`$1`), ghi nhiều bảng trong transaction.

**Sao lưu / khôi phục**
```bash
npm run backup                                   # -> backups/db-<thời gian>.dump + files-<thời gian>.tar.gz
docker exec -i gamehub-postgres pg_restore -U gamehub -d gamehub --clean --if-exists < backups/db-XXXX.dump
tar xzf backups/files-XXXX.tar.gz -C data
```
`npm run db:reset -- --yes` xóa sạch dữ liệu (chỉ dùng khi phát triển).

## Kiến trúc

```
Trình duyệt ── portal (public/, SPA) ─────────── fetch + cookie ──► /api/*  ──┐
   │ iframe sandbox (origin null)                                              ├─► PostgreSQL
   │   game ⇄ postMessage ⇄ GameHost (app.js) ── vé ký HMAC (60s, 1 lần) ─┐    │
   │   game ── WebSocket /rt?ticket=… ────────────────────────────────────┴► realtime (phòng relay / authoritative)
   └── /g/<slug>/*  file game đã duyệt (CSP sandbox)
```
```
server/
  index.js      HTTP, file tĩnh, CSP, khởi động/tắt an toàn (đóng phòng, lưu trận, đóng DB)
  env.js        đọc .env, khóa con cho từng loại token
  db.js         pg pool | PGlite, transaction, migrations
  migrations/   schema SQL
  api.js        REST API + dịch vụ cho phòng (lưu điểm phía server, dùng token thưởng, vé realtime)
  seed.js       admin, game có sẵn, nhiệm vụ mẫu
  realtime/     WebSocket: ghép phòng, giới hạn tần suất, phòng relay
  rooms/        logic phòng authoritative của game hệ thống (cubes-2048.js, chess.js)
  zip.js, validate.js
sdk/gamehub-sdk.js · public/ · seed-games/ · sample-game/ · tools/
```

## Bảo mật

| Rủi ro | Biện pháp |
|---|---|
| Game đánh cắp phiên / gọi API thay người chơi | iframe sandbox **không** `allow-same-origin` + header `CSP: sandbox`; mọi lệnh đi qua portal |
| Game gửi dữ liệu ra ngoài | CSP `connect-src 'self'` (+ WebSocket tới chính máy chủ GameHub) |
| Giả mạo kết nối multiplayer | vé ký HMAC, hết hạn 60 giây, **dùng 1 lần**; người chơi khách định danh bằng hash IP |
| Gian lận điểm (online) | máy chủ tính điểm; client chỉ gửi hướng lái/tăng tốc (đã kiểm tra hợp lệ) |
| Dùng lại phần thưởng | token nhiệm vụ HMAC + `consumed_at` trong DB |
| Spam realtime | ~40 tin/giây/người, tin ≤ 16KB, ping/pong ngắt kết nối chết |
| Upload độc hại, CSRF, brute-force | allowlist file, chống zip-slip/zip-bomb; header `X-GH` + `SameSite`; rate limit |

> Điểm của game **chơi đơn** vẫn do client gửi nên không tuyệt đối đáng tin (có `scoring.max`, giới hạn tần suất). Game cần chống gian lận thật sự nên dùng chế độ authoritative.

## Kiểm thử

```bash
npm run db:reset -- --yes && GAMEHUB_TEST=1 UPLOADS_PER_HOUR=100 npm start &
npm test             # 99 kiểm tra API (auth, điểm, thành tựu, upload độc hại, duyệt, sandbox, nhiệm vụ…)
npm run test:mp      # 52 kiểm tra multiplayer qua WebSocket thật (vé, phòng Cubes, phần thưởng, tàng hình khi làm nhiệm vụ, phòng riêng, relay)
npm run test:ui      # 49 kiểm tra giao diện bằng Chrome headless (SDK trong iframe, nhiệm vụ, chơi online, admin, mobile)
```
`GAMEHUB_TEST=1` bật lệnh `debug_kill` trong phòng Cubes để test luồng "chết → máy chủ lưu điểm" — **không bật khi chạy thật**.

## Triển khai lên VPS bằng k3s

Có sẵn `Dockerfile` và thư mục `k8s/` (Postgres, GameHub 1 bản + PVC, Ingress Traefik + HTTPS, sao lưu hằng đêm).
Health check: `GET /healthz` (sống + DB trả lời).

```bash
# 1. Build image (trên máy dev) rồi chuyển sang VPS — không cần registry
docker build -t gamehub:1.0.0 .
docker save gamehub:1.0.0 | ssh user@vps sudo k3s ctr images import -

# 2. Trên VPS: cert-manager (1 lần) + ClusterIssuer (sửa email trong file)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.2/cert-manager.yaml
kubectl apply -f k8s/cluster-issuer.yaml

# 3. Bí mật + tên miền: điền k8s/secret.yaml, sửa game.example.com trong k8s/ingress.yaml
cp k8s/secret.example.yaml k8s/secret.yaml

# 4. Triển khai
kubectl apply -k k8s/
kubectl -n gamehub get pods -w
kubectl -n gamehub logs deploy/gamehub
```

Cập nhật bản mới: build với tag mới (`gamehub:1.0.1`), import sang VPS, sửa `newTag` trong `k8s/kustomization.yaml`,
`kubectl apply -k k8s/`. Pod cũ tắt trước (lưu kết quả các trận đang chơi) rồi pod mới bật — người đang trong phòng online bị ngắt vài giây.
Dùng registry (GHCR/Docker Hub) thì đổi `newName` và thêm `imagePullSecrets` nếu là repo riêng tư.

Lưu ý:
- **Chỉ 1 replica** — phòng multiplayer nằm trong RAM tiến trình.
- `data/` (game đã duyệt, bài nộp) nằm trên PVC `gamehub-data`; mất PVC là mất game upload.
- Sao lưu nằm trên PVC `gamehub-backups` (cùng VPS) — chép ra ngoài định kỳ. Khôi phục DB: `pg_restore -h postgres -U gamehub -d gamehub --clean <file>.dump`.
- Trước khi mở cho người thật: **tắt chế độ thử nghiệm** phần thưởng trong Admin → Nhiệm vụ.

## Zalo Mini App

Máy chủ đã sẵn sàng cho Mini App:
- `POST /api/auth/zalo { accessToken }`: client lấy token bằng `getAccessToken()` của `zmp-sdk`. Máy chủ hỏi Graph API của Zalo (chỉ lấy id + tên, ký `appsecret_proof` bằng `ZALO_APP_SECRET`), tạo hoặc tìm tài khoản theo `zalo_id`, rồi trả `{ user, token }`.
- Mọi API nhận `Authorization: Bearer <token>` thay cookie, vì webview chặn cookie khác tên miền.
- `CORS_ORIGINS` (vd `https://h5.zdn.vn`): cho phép gọi API và nhúng game (`frame-ancestors`) từ Mini App.

Bản thử nghiệm kỹ thuật nằm ở [`zalo-miniapp/`](zalo-miniapp/README.md). Test: `node tools/zalo-test.js` (xem đầu file để biết biến môi trường cần cho server thử).

## Triển khai thật — cần làm thêm

1. Phục vụ `/g/*` từ **domain riêng** cho game (lớp bảo vệ thứ hai ngoài sandbox).
2. HTTPS (`COOKIE_SECURE=1`), reverse proxy hỗ trợ WebSocket (`Upgrade`) cho `/rt`, `TRUST_PROXY=1`.
3. PostgreSQL có sao lưu định kỳ (`npm run backup` theo cron) hoặc dịch vụ quản lý (RDS, Cloud SQL, Supabase…); file game → S3/R2 + CDN.
4. Nhiều tiến trình/máy: phòng multiplayer đang nằm trong RAM của một tiến trình — khi cần mở rộng, gán phòng theo máy (sticky) hoặc dùng Redis để điều phối.
5. Email xác minh, quên mật khẩu, đăng nhập Google/Facebook/Zalo; quét mã độc gói upload.
