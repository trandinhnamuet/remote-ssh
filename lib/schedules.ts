import { ServerEntry } from "./servers";

export interface Schedule {
  id: string;
  name: string;
  hour: number; // 0-23, giờ Việt Nam
  minute: number; // 0-59
  prompt: string;
  cwd: string;
  allowBash: boolean;
  enabled: boolean;
}

type Req =
  | { type: "list" }
  | { type: "save"; schedules: Schedule[] }
  | { type: "log"; scheduleId: string }
  | { type: "run-now"; scheduleId: string; schedules: Schedule[] }
  | { type: "check-dir"; path: string }
  | { type: "mkdir"; path: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One request per WebSocket — the server closes the connection after replying. */
export function scheduleRequest(s: ServerEntry, req: Req): Promise<any> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/schedule`);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error("Hết thời gian chờ server."));
      }
    }, 30000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          ...req,
          host: s.host,
          port: s.port,
          username: s.username,
          auth: s.auth,
          password: s.password,
          privateKey: s.privateKey,
          passphrase: s.passphrase,
          model: s.claudeModel || undefined,
        })
      );
    };
    ws.onmessage = (e) => {
      if (settled) return;
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "error") {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              msg.message === "AUTH_FAILED"
                ? "Xác thực SSH thất bại — kiểm tra mật khẩu/key."
                : msg.message
            )
          );
        } else {
          settled = true;
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {}
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Mất kết nối tới server trung gian."));
    };
    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Kết nối bị đóng."));
    };
  });
}

export function timeLabel(s: Schedule) {
  return `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
}

/** Bao lâu nữa tới lần chạy kế tiếp, tính theo giờ VN (cron dùng CRON_TZ=Asia/Ho_Chi_Minh). */
export function nextRunLabel(s: Schedule): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const nowH = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const nowM = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  let diff = s.hour * 60 + s.minute - (nowH * 60 + nowM);
  if (diff <= 0) diff += 24 * 60; // đã qua hôm nay -> chạy vào ngày mai

  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h > 0 ? `${h} giờ ${m} phút nữa` : `${m} phút nữa`;
}
