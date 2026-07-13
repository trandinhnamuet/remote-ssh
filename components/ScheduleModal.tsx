"use client";

import { useCallback, useEffect, useState } from "react";
import { ServerEntry, newId } from "@/lib/servers";
import { Schedule, nextRunLabel, scheduleRequest, timeLabel } from "@/lib/schedules";

const field =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-foreground placeholder:text-muted/70 outline-none focus:border-accent";

export default function ScheduleModal({
  server,
  onClose,
}: {
  server: ServerEntry;
  onClose: () => void;
}) {
  const [list, setList] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [logFor, setLogFor] = useState<{ name: string; text: string } | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await scheduleRequest(server, { type: "list" });
      setList(r.schedules ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the schedule list from the remote host on mount
    load();
  }, [load]);

  const persist = useCallback(
    async (next: Schedule[], label: string) => {
      setBusy(label);
      setErr("");
      try {
        const r = await scheduleRequest(server, { type: "save", schedules: next });
        setList(r.schedules ?? next);
        setEditing(null);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy("");
      }
    },
    [server]
  );

  const save = async (s: Schedule) => {
    // A missing directory used to make the cron job die silently, so refuse to save one.
    setBusy("Đang kiểm tra thư mục…");
    setErr("");
    try {
      const r = await scheduleRequest(server, { type: "check-dir", path: s.cwd });
      if (!r.exists) {
        setBusy("");
        if (!confirm(`Thư mục "${s.cwd}" chưa tồn tại trên server.\n\nTạo mới thư mục này?`)) {
          setErr(`Chưa lưu: thư mục "${s.cwd}" không tồn tại. Sửa lại đường dẫn hoặc cho phép tạo mới.`);
          return;
        }
        setBusy("Đang tạo thư mục…");
        await scheduleRequest(server, { type: "mkdir", path: s.cwd });
      }
    } catch (e) {
      setBusy("");
      setErr((e as Error).message);
      return;
    }
    const i = list.findIndex((x) => x.id === s.id);
    const next = i >= 0 ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
    persist(next, "Đang lưu vào crontab…");
  };

  const remove = (s: Schedule) => {
    if (!confirm(`Xóa lịch "${s.name || timeLabel(s)}"?`)) return;
    persist(
      list.filter((x) => x.id !== s.id),
      "Đang xóa…"
    );
  };

  const toggle = (s: Schedule) =>
    persist(
      list.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
      s.enabled ? "Đang tắt…" : "Đang bật…"
    );

  const runNow = async (s: Schedule) => {
    setErr("");
    try {
      setBusy("Đang khởi chạy…");
      await scheduleRequest(server, { type: "run-now", scheduleId: s.id, schedules: list });
      // Poll the log so a failure (missing dir, claude not installed) surfaces here
      // instead of leaving the user to guess whether anything happened.
      for (let i = 0; i < 20; i++) {
        setBusy(`Claude đang chạy… (${i * 5}s)`);
        await new Promise((r) => setTimeout(r, 5000));
        const r = await scheduleRequest(server, { type: "log", scheduleId: s.id });
        const text: string = r.text || "";
        if (text.includes("LỖI:") || /command not found/i.test(text)) {
          setBusy("");
          setLogFor({ name: s.name || timeLabel(s), text });
          setErr("Lần chạy thử này lỗi — xem log bên dưới.");
          return;
        }
        // Claude finished: the run appends a trailing blank line after its output.
        if (text.trim() && text.trim().split("\n").length > 1) {
          setBusy("");
          setLogFor({ name: s.name || timeLabel(s), text });
          return;
        }
      }
      setBusy("");
      setErr("Chạy quá 100s vẫn chưa xong — bấm 📄 Log sau ít phút để xem kết quả.");
    } catch (e) {
      setBusy("");
      setErr((e as Error).message);
    }
  };

  const showLog = async (s: Schedule) => {
    setBusy("Đang tải log…");
    setErr("");
    try {
      const r = await scheduleRequest(server, { type: "log", scheduleId: s.id });
      setLogFor({ name: s.name || timeLabel(s), text: r.text || "(trống)" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface sm:max-w-lg sm:rounded-2xl sm:border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">⏰ Hẹn giờ nhắn tin</h2>
            <p className="truncate text-xs text-muted">{server.name} · giờ Việt Nam</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-muted">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 safe-bottom">
          {busy && <p className="mb-3 text-sm text-accent">{busy}</p>}
          {err && (
            <p className="mb-3 whitespace-pre-wrap rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {err}
            </p>
          )}

          {logFor ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">📄 Log: {logFor.name}</p>
                <button onClick={() => setLogFor(null)} className="text-sm text-muted">
                  ← Quay lại
                </button>
              </div>
              <pre className="max-h-[60dvh] overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px] leading-4 whitespace-pre-wrap break-words">
                {logFor.text}
              </pre>
            </div>
          ) : editing ? (
            <ScheduleForm
              initial={editing}
              defaultCwd={server.claudeCwd ?? ""}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              {loading ? (
                <p className="py-8 text-center text-sm text-muted">Đang đọc crontab trên server…</p>
              ) : list.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-3xl">⏰</p>
                  <p className="mt-2 text-sm text-muted">
                    Chưa có lịch nào. Tạo lịch để mỗi ngày Claude tự nhận việc đúng giờ,
                    kể cả khi bạn không mở app.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {list.map((s) => (
                    <div key={s.id} className="rounded-xl border border-border bg-surface-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2">
                            <span className="font-mono text-lg font-bold">{timeLabel(s)}</span>
                            <span className="truncate text-sm font-medium">{s.name}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.prompt}</p>
                          <p className="mt-1 truncate font-mono text-[10px] text-muted">
                            📁 {s.cwd} · {s.allowBash ? "⚠️ Bash bật" : "🔒 chỉ đọc/sửa file"}
                          </p>
                          {s.enabled && (
                            <p className="mt-0.5 text-[10px] text-accent">
                              ⏳ chạy sau {nextRunLabel(s)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => toggle(s)}
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            s.enabled
                              ? "bg-accent/15 text-accent"
                              : "bg-border text-muted"
                          }`}
                        >
                          {s.enabled ? "BẬT" : "TẮT"}
                        </button>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <Mini onClick={() => setEditing(s)}>✏️ Sửa</Mini>
                        <Mini onClick={() => showLog(s)}>📄 Log</Mini>
                        <Mini onClick={() => runNow(s)}>▶️ Chạy thử</Mini>
                        <Mini danger onClick={() => remove(s)}>
                          🗑️ Xóa
                        </Mini>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && (
                <button
                  onClick={() =>
                    setEditing({
                      id: newId(),
                      name: "",
                      hour: 8,
                      minute: 0,
                      prompt: "",
                      cwd: server.claudeCwd ?? "",
                      allowBash: false,
                      enabled: true,
                    })
                  }
                  className="mt-4 w-full rounded-lg bg-accent py-2.5 font-semibold text-accent-fg active:scale-[0.98] transition-transform"
                >
                  + Thêm lịch
                </button>
              )}

              <p className="mt-3 text-[11px] leading-4 text-muted">
                Lịch được ghi vào crontab của chính server (múi giờ Asia/Ho_Chi_Minh) nên
                chạy độc lập, không cần mở app. Mỗi lần chạy là một session Claude mới —
                không mang theo ngữ cảnh hội thoại cũ.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border border-border px-2.5 py-1.5 text-xs font-medium ${
        danger ? "text-danger" : "text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ScheduleForm({
  initial,
  defaultCwd,
  onSave,
  onCancel,
}: {
  initial: Schedule;
  defaultCwd: string;
  onSave: (s: Schedule) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [time, setTime] = useState(
    `${String(initial.hour).padStart(2, "0")}:${String(initial.minute).padStart(2, "0")}`
  );
  const [prompt, setPrompt] = useState(initial.prompt);
  const [cwd, setCwd] = useState(initial.cwd || defaultCwd);
  const [allowBash, setAllowBash] = useState(initial.allowBash);
  const [err, setErr] = useState("");

  const submit = () => {
    const [h, m] = time.split(":").map((x) => parseInt(x, 10));
    if (isNaN(h) || isNaN(m)) {
      setErr("Giờ không hợp lệ.");
      return;
    }
    if (!prompt.trim()) {
      setErr("Cần nhập nội dung tin nhắn.");
      return;
    }
    if (!cwd.trim()) {
      setErr("Cần chỉ định thư mục làm việc — Claude chỉ được đọc/sửa trong thư mục này.");
      return;
    }
    onSave({
      ...initial,
      name: name.trim() || `Lịch ${time}`,
      hour: h,
      minute: m,
      prompt: prompt.trim(),
      cwd: cwd.trim(),
      allowBash,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-muted">Giờ (VN) *</label>
          <input
            type="time"
            className={field}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted">Tên gợi nhớ</label>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Báo cáo sáng"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Nội dung tin nhắn *</label>
        <textarea
          className={`${field} h-28`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="VD: Đọc log lỗi trong thư mục này, tóm tắt các lỗi mới trong 24h qua và ghi vào bao-cao.md"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          Thư mục được chỉ định *
        </label>
        <input
          className={`${field} font-mono text-sm`}
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/home/ubuntu/myapp"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <p className="mt-1 text-[11px] leading-4 text-muted">
          Claude chỉ đọc/sửa file trong thư mục này (không truyền --add-dir nên các thư mục
          khác nằm ngoài phạm vi).
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <label className="flex items-start justify-between gap-3">
          <span className="text-sm">
            Cho phép chạy lệnh shell (Bash)
            <span className="mt-0.5 block text-[11px] leading-4 text-muted">
              ⚠️ Bật thì Claude làm được nhiều việc hơn (systemctl, df, apt…), nhưng Bash
              chạy được lệnh đọc cả ngoài thư mục đã chỉ định. Tắt để giữ đúng phạm vi.
            </span>
          </span>
          <input
            type="checkbox"
            checked={allowBash}
            onChange={(e) => setAllowBash(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
        </label>
      </div>

      {err && <p className="text-sm text-danger">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-border py-2.5 font-medium text-muted"
        >
          Hủy
        </button>
        <button
          onClick={submit}
          className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-accent-fg active:scale-[0.98] transition-transform"
        >
          Lưu lịch
        </button>
      </div>
    </div>
  );
}
