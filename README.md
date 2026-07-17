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
- `/ws/schedule` (trong `server.js`) — hẹn giờ nhắn Claude hằng ngày bằng crontab của chính server đích (không phải hẹn giờ trong trình duyệt), mỗi lần chạy là session mới, giới hạn trong 1 thư mục
- `components/ScheduleModal.tsx`, `lib/schedules.ts` — UI quản lý lịch (menu ⋯ trên card server)
- `lib/useDragReorder.ts` — giữ ~400ms để kéo sắp xếp lại thứ tự card server
- `components/AuthGate.tsx`, `lib/siteAuth.ts` — đăng nhập app (xem mục Đăng nhập ứng dụng bên dưới)

## Cài như app trên điện thoại (PWA)

Mở https://ssh.ics.vn rồi:

- **Android/Chrome**: menu ⋮ → *Cài đặt ứng dụng* (hoặc banner tự hiện)
- **iOS/Safari**: nút Chia sẻ → *Thêm vào Màn hình chính*

App chạy toàn màn hình (không thanh địa chỉ), icon là dấu nhắc `>_` nền xanh giống icon trên header.

- `app/manifest.ts` — web manifest (standalone, portrait, theme màu tối)
- `app/icon.svg`, `app/apple-icon.png`, `app/favicon.ico`, `public/icons/*` — bộ icon, gồm bản `maskable` cho Android
- `public/sw.js` — service worker **network-first**: luôn ưu tiên bản mới từ mạng (app điều khiển server thật, phục vụ UI cũ từ cache còn tệ hơn báo lỗi), cache chỉ làm phương án dự phòng khi mất mạng. Chỉ đăng ký ở production.

## Đăng nhập ứng dụng

App có màn đăng nhập riêng (không phải hộp thoại mật khẩu mặc định của trình duyệt). Đăng nhập một lần, trình duyệt **nhớ mãi** (lưu trong localStorage) — không hỏi lại mỗi lần mở app.

Vì sao không dùng nginx Basic Auth như trước: hộp thoại mật khẩu mặc định của trình duyệt không cho JavaScript đọc lại nội dung đã gõ, nên không thể lưu vào localStorage được. Đã thử "làm nóng" cache Basic Auth bằng `fetch()` kèm header — không có tác dụng với WebSocket (đã kiểm chứng thực tế: `fetch` xác thực thành công nhưng WebSocket mở ngay sau đó vẫn bị đóng, vì trình duyệt không dùng lại cache đó cho WS). Nên xác thực giờ nằm hoàn toàn trong app:

- Mỗi kết nối WebSocket (`/ws/ssh`, `/ws/claude`, `/ws/schedule`) bắt buộc gửi `{type:"auth", username, password}` làm tin nhắn đầu tiên; server (`server.js`) so khớp với biến môi trường `SITE_USER`/`SITE_PASSWORD` (constant-time compare) trước khi xử lý bất kỳ điều gì khác.
- Không set 2 biến đó → tắt hẳn cơ chế đăng nhập (tiện cho `npm run dev` cục bộ), giống cách `MSG_API_TOKEN` của `/api/msg` hoạt động.
- `components/AuthGate.tsx` bọc toàn bộ app: kiểm tra localStorage, nếu chưa có/sai thì hiện màn đăng nhập; xác thực bằng cách mở tạm 1 kết nối `/ws/ssh` gửi frame `auth` rồi đóng ngay (không SSH thật, không tốn gì).
- Nếu server đổi mật khẩu mà trình duyệt còn lưu mật khẩu cũ, lần kết nối kế tiếp sẽ nhận `UNAUTHORIZED` → app tự xóa localStorage và quay lại màn đăng nhập (tự phục hồi, không bị kẹt).
- Nút 🔒 ở trang chủ để đăng xuất thủ công (hữu ích khi dùng máy chung).

### Đổi mật khẩu đăng nhập app

Sửa `SITE_USER`/`SITE_PASSWORD` trong `~/web/ecosystem.config.js` (khối `env` của app `remote-ssh`), rồi:

```bash
cd ~/web && pm2 restart ecosystem.config.js --only remote-ssh --update-env
```

⚠️ **Bẫy pm2**: `pm2 restart remote-ssh --update-env` (theo tên, không trỏ vào file) **không** đọc lại `ecosystem.config.js` — cờ `--update-env` chỉ áp dụng biến môi trường của chính shell đang gõ lệnh. Phải restart **trỏ thẳng vào file** như trên thì biến mới mới được nạp.

## Đã deploy: https://ssh.ics.vn

Chạy trên server ICS (161.118.203.249), có HTTPS. nginx chỉ lo TLS + reverse proxy, không còn xác thực (xem mục Đăng nhập ứng dụng ở trên).

| | |
|---|---|
| Thư mục | `/home/ubuntu/web/remote-ssh` |
| Process | pm2 `remote-ssh` (khai báo trong `~/web/ecosystem.config.js`) |
| Cổng | `127.0.0.1:3100` — chỉ nghe localhost, ra ngoài qua nginx |
| nginx | `/etc/nginx/sites-available/ssh.ics.vn` (WebSocket + `proxy_read_timeout 86400s`) |
| SSL | Let's Encrypt, tự gia hạn bằng `certbot.timer` |

### Cập nhật code lên server

`~/web/remote-ssh` trên server là git clone thật của repo này (branch `main`), không phải copy rời rạc — code ở máy dev, GitHub và server đồng bộ qua cùng một lịch sử commit.

```bash
# máy dev: commit & push như bình thường
git push origin main

# trên server
cd ~/web/remote-ssh && git pull && npm ci && npm run build
cd ~/web && pm2 restart ecosystem.config.js --only remote-ssh --update-env
```

### Deploy chỗ khác

App cần một Node process chạy liên tục (WebSocket + SSH session dài) nên **không chạy được trên Vercel**. Dùng VPS + pm2, hoặc Railway/Render/Fly.io.

## Cài Claude CLI trên server Ubuntu

```bash
curl -fsSL https://claude.ai/install.sh | bash
# hoặc: npm install -g @anthropic-ai/claude-code
```

Đăng nhập lần đầu (cần tương tác): mở tab **Terminal** của app, chạy `claude` và làm theo hướng dẫn. Sau đó bật cờ **"Server có cài Claude CLI"** cho server này để dùng giao diện chat.

Trong màn hình chat (⚙️): đặt **thư mục làm việc** (project mà Claude sẽ thao tác) và bật/tắt **bypass permissions** (bật = Claude tự chạy mọi lệnh không hỏi — cần thiết khi giao việc từ xa).

## Lưu ý bảo mật

- Thông tin server (kể cả mật khẩu/private key) lưu **nguyên văn trong localStorage** của trình duyệt và gửi tới `server.js` khi kết nối. Chỉ chạy app này trên máy/VPS bạn tin tưởng, và luôn dùng HTTPS khi ra internet.
- Trang chủ và các asset tĩnh (PWA icon, manifest…) không cần đăng nhập mới xem được — chỉ là vỏ UI trống, không có gì bí mật. Phần thật sự nhạy cảm (WebSocket SSH/Claude/schedule) luôn yêu cầu `SITE_USER`/`SITE_PASSWORD` như trên.
