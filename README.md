# Remote SSH — điều khiển server Ubuntu từ điện thoại

Web app SSH client tối ưu cho mobile: terminal xterm.js tốc độ cao qua WebSocket, quản lý nhiều server (lưu localStorage), và giao diện chat riêng để giao việc cho **Claude CLI** trên server.

## Chạy

```bash
npm install
npm run dev     # phát triển (http://localhost:3000)

npm run build
npm start       # production (nhanh hơn, dùng hằng ngày)
```

Server lắng nghe trên `0.0.0.0:3000` — từ điện thoại cùng mạng Wi-Fi, mở `http://<IP-máy-tính>:3000`.

## Kiến trúc

```
Điện thoại (trình duyệt)                    Máy chạy app này              Server Ubuntu
┌─────────────────────────┐    WebSocket   ┌────────────────┐    SSH     ┌────────────┐
│ xterm.js / Claude chat  │ ◄────────────► │ server.js       │ ◄────────► │ sshd       │
│ localStorage (thông tin │  binary frames │ (Next.js + ws   │   ssh2     │ claude CLI │
│ server, lịch sử chat)   │                │  + ssh2)        │            │            │
└─────────────────────────┘                └────────────────┘            └────────────┘
```

- `server.js` — custom server: Next.js + 2 endpoint WebSocket
  - `/ws/ssh` — shell tương tác; dữ liệu terminal đi bằng binary frame, không nén → độ trễ thấp nhất
  - `/ws/claude` — chạy `claude -p --output-format stream-json` trên server qua SSH exec, stream từng sự kiện về UI
- `lib/servers.ts` — lưu/đọc danh sách server + lịch sử chat trong localStorage
- `app/page.tsx` — danh sách server, thêm/sửa/xóa
- `app/terminal/[id]` — terminal xterm.js (WebGL renderer, dark/light, thanh phím Esc/Tab/Ctrl/mũi tên)
- `app/claude/[id]` — chat giao việc cho Claude CLI, hiển thị tool đang chạy, chi phí, thời gian; tự resume phiên hội thoại (`--resume`)

## Dùng từ xa (không cùng Wi-Fi)

Muốn dùng mọi nơi chỉ với điện thoại, deploy app này lên một VPS (ví dụ chính 1 server Ubuntu của bạn):

```bash
# trên VPS
git clone <repo> && cd remote-ssh
npm install && npm run build
npm start   # hoặc chạy bằng pm2: pm2 start server.js --name remote-ssh -- --prod
```

Nên đặt sau reverse proxy có HTTPS (Caddy/nginx + certbot) vì mật khẩu SSH đi qua kết nối này. Caddy tự lo WebSocket + HTTPS:

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

## Cài Claude CLI trên server Ubuntu

```bash
curl -fsSL https://claude.ai/install.sh | bash
# hoặc: npm install -g @anthropic-ai/claude-code
```

Đăng nhập lần đầu (cần tương tác): mở tab **Terminal** của app, chạy `claude` và làm theo hướng dẫn. Sau đó bật cờ **"Server có cài Claude CLI"** cho server này để dùng giao diện chat.

Trong màn hình chat (⚙️): đặt **thư mục làm việc** (project mà Claude sẽ thao tác) và bật/tắt **bypass permissions** (bật = Claude tự chạy mọi lệnh không hỏi — cần thiết khi giao việc từ xa).

## Lưu ý bảo mật

- Thông tin server (kể cả mật khẩu/private key) lưu **nguyên văn trong localStorage** của trình duyệt và gửi tới `server.js` khi kết nối. Chỉ chạy app này trên máy/VPS bạn tin tưởng, và luôn dùng HTTPS khi ra internet.
- App không có đăng nhập — ai truy cập được URL đều dùng được. Khi deploy công khai, chặn bằng Caddy `basic_auth`, VPN (Tailscale) hoặc firewall.
