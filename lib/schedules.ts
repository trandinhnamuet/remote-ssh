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
  | { type: "run-now"; scheduleId: string; schedules: Schedule[] };

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
