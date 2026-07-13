/* Service worker tối thiểu để app cài được như PWA.
 *
 * Chiến lược: network-first. App này điều khiển server thật qua WebSocket, nên phục vụ
 * một bản UI cũ từ cache sẽ tệ hơn là báo lỗi. Cache chỉ dùng làm phương án dự phòng khi
 * mất mạng, và chỉ chứa vỏ app (trang + static asset), không đụng tới dữ liệu server.
 */
const CACHE = "remote-ssh-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const cacheable =
    req.mode === "navigate" ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/");

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Không cache 401 (basic auth) hay lỗi — chỉ giữ phản hồi thành công.
        if (cacheable && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return new Response("Ngoại tuyến — cần mạng để kết nối tới server.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
  );
});
