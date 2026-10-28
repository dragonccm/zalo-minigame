# Zalo Graph proxy (chạy ở Việt Nam)

Zalo trả lỗi `-501 Personal information is limited due to IP address not inside Vietnam` cho **mọi** lời gọi
`graph.zalo.me` từ IP nước ngoài — kể cả chỉ xin `id`. Máy chủ GameHub đặt ở nước ngoài nên không xác minh được đăng nhập Zalo.

Proxy này chạy trên một máy có **IP Việt Nam** và chỉ chuyển tiếp đúng một lời gọi: `GET /me?fields=id`.
Không lưu, không ghi log token. Không có `x-proxy-key` đúng → 403.

## Chạy trên máy ở Việt Nam

```bash
openssl rand -hex 32            # tạo PROXY_KEY
docker build -t zalo-proxy .
docker run -d --restart unless-stopped -p 8787:8787 -e PROXY_KEY=<khoá> zalo-proxy
```

Đặt sau HTTPS (Cloudflare Tunnel, Caddy, Nginx…), ví dụ `https://zalo-proxy.ten-mien.vn`.

## Trên máy chủ GameHub (Dokploy)

```
ZALO_GRAPH_URL=https://zalo-proxy.ten-mien.vn/me
ZALO_PROXY_KEY=<cùng khoá>
```

Kiểm tra: `curl https://zalo-proxy.ten-mien.vn/me -H "x-proxy-key: <khoá>" -H "access_token: x"` phải trả `{"error":452,...}` (token sai)
chứ không phải `-501`.
