#!/usr/bin/env bash
# Chạy toàn bộ dự án local bằng một lệnh.
#   ./run.sh          bật PostgreSQL (nếu có Docker), máy chủ GameHub (8080), bản thử Mini App (3000)
#   ./run.sh stop     tắt máy chủ và Mini App
#   ./run.sh status   xem đang chạy gì
#   ./run.sh --no-miniapp   chỉ chạy GameHub
# Log nằm trong thư mục .run/. Chạy nền nên đóng terminal không làm dừng dự án.
set -euo pipefail
cd "$(dirname "$0")"

RUN=.run
mkdir -p "$RUN"
GH_PID="$RUN/gamehub.pid"; MA_PID="$RUN/miniapp.pid"
GH_URL=http://localhost:8080; MA_URL=http://localhost:3000

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
wait_http() { for _ in $(seq 1 60); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; return 1; }

stop_all() {
  for f in "$GH_PID" "$MA_PID"; do
    if alive "$f"; then kill "$(cat "$f")" 2>/dev/null && say "đã dừng PID $(cat "$f")"; fi
    rm -f "$f"
  done
  # dọn tiến trình còn sót (ví dụ chạy tay trước đó)
  pkill -f "^node --disable-warning=ExperimentalWarning server/index.js" 2>/dev/null || true
  pkill -f "vite --port 3000 --strictPort" 2>/dev/null || true
  say "xong. PostgreSQL vẫn chạy (muốn tắt: docker stop gamehub-postgres)"
}

status() {
  alive "$GH_PID" && say "GameHub: đang chạy  $GH_URL" || say "GameHub: đã tắt"
  alive "$MA_PID" && say "Mini App dev: đang chạy  $MA_URL" || say "Mini App dev: đã tắt"
  curl -sf -o /dev/null "$GH_URL/healthz" && say "healthz: ok" || true
}

case "${1:-start}" in
  stop) stop_all; exit 0 ;;
  status) status; exit 0 ;;
esac
WITH_MINIAPP=1; [ "${1:-}" = "--no-miniapp" ] && WITH_MINIAPP=0

# 1. cấu hình
if [ ! -f .env ]; then
  cp .env.example .env
  warn "đã tạo .env từ .env.example — mở .env và đổi ADMIN_PASS, APP_SECRET"
fi
if grep -q "doi-mat-khau-nay\|hay-thay-bang" .env; then
  warn ".env còn mật khẩu/bí mật mẫu — nên đổi trước khi dùng lâu dài"
fi
# .env của dev cần cho bản thử Mini App gọi API
grep -q "^CORS_ORIGINS=" .env && ! grep -q "^CORS_ORIGINS=.*localhost:3000" .env \
  && sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:3000|' .env

# 2. thư viện
[ -d node_modules ] || { say "cài thư viện GameHub"; npm install --silent; }
if [ "$WITH_MINIAPP" = 1 ] && [ ! -d zalo-miniapp/node_modules ]; then
  say "cài thư viện Mini App"; (cd zalo-miniapp && npm install --silent)
fi

# 3. PostgreSQL (chỉ khi dùng DATABASE_URL và có Docker)
if grep -q "^DATABASE_URL=postgres" .env; then
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' | grep -qx gamehub-postgres; then
      say "PostgreSQL đã chạy"
    else
      say "bật PostgreSQL (Docker)"; docker compose up -d db >/dev/null
      for _ in $(seq 1 30); do docker inspect -f '{{.State.Health.Status}}' gamehub-postgres 2>/dev/null | grep -q healthy && break; sleep 1; done
    fi
  else
    warn "không có Docker — bỏ qua PostgreSQL; máy chủ sẽ không khởi động được nếu DB chưa chạy"
  fi
else
  say "DATABASE_URL trống → dùng PGlite (không cần Docker)"
fi

# 4. máy chủ GameHub
if alive "$GH_PID" || curl -sf -o /dev/null "$GH_URL/healthz"; then
  say "GameHub đã chạy sẵn ở $GH_URL"
else
  say "khởi động GameHub"
  setsid nohup node --disable-warning=ExperimentalWarning server/index.js < /dev/null > "$RUN/gamehub.log" 2>&1 &
  echo $! > "$GH_PID"
  wait_http "$GH_URL/healthz" || { warn "GameHub không lên được, xem $RUN/gamehub.log"; tail -n 15 "$RUN/gamehub.log"; exit 1; }
fi

# 5. bản thử Mini App
if [ "$WITH_MINIAPP" = 1 ]; then
  if alive "$MA_PID" || curl -sf -o /dev/null "$MA_URL"; then
    say "Mini App dev đã chạy sẵn ở $MA_URL"
  else
    say "khởi động Mini App dev"
    (cd zalo-miniapp && GAMEHUB_API="$GH_URL" setsid nohup npx vite --port 3000 --strictPort < /dev/null > "../$RUN/miniapp.log" 2>&1 &)
    sleep 1; pgrep -f "vite --port 3000" | head -n1 > "$MA_PID" || true
    wait_http "$MA_URL" || warn "Mini App chưa lên, xem $RUN/miniapp.log"
  fi
fi

echo
say "sẵn sàng:"
echo "   GameHub   $GH_URL"
[ "$WITH_MINIAPP" = 1 ] && echo "   Mini App  $MA_URL   (đăng nhập Zalo sẽ báo lỗi ở local — bình thường)"
echo "   log       $RUN/gamehub.log"
echo "   tắt       ./run.sh stop"
