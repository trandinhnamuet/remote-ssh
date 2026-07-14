"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChatItem,
  ServerEntry,
  clearChat,
  getServer,
  loadChat,
  saveChat,
  updateServer,
} from "@/lib/servers";
import ThemeToggle from "@/components/ThemeToggle";

type RunState = "idle" | "connecting" | "running";

// Aliases accepted by `claude --model` (checked against `claude -p ... /model` output, CLI v2.1.207).
const MODEL_OPTIONS: { label: string; value: string }[] = [
  { label: "Mặc định", value: "" },
  { label: "Sonnet", value: "sonnet" },
  { label: "Opus", value: "opus" },
  { label: "Haiku", value: "haiku" },
  { label: "Fable", value: "fable" },
  { label: "Best (tự chọn model tốt nhất)", value: "best" },
  { label: "Opusplan (plan bằng Opus, code bằng Sonnet)", value: "opusplan" },
  { label: "Sonnet · 1M context", value: "sonnet[1m]" },
  { label: "Opus · 1M context", value: "opus[1m]" },
  { label: "Fable · 1M context", value: "fable[1m]" },
];
const CUSTOM_MODEL = "__custom__";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toolSummary(name: string, input: any): string {
  if (!input) return "";
  const s =
    input.command ??
    input.file_path ??
    input.pattern ??
    input.url ??
    input.description ??
    input.prompt ??
    "";
  const str = typeof s === "string" ? s : JSON.stringify(input);
  return str.length > 90 ? str.slice(0, 90) + "…" : str;
}

export default function ClaudePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [server, setServer] = useState<ServerEntry | null | undefined>(undefined);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [run, setRun] = useState<RunState>("idle");
  const [model, setModel] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [cwd, setCwd] = useState("");
  const [bypass, setBypass] = useState(true);
  const [modelChoice, setModelChoice] = useState("");
  const [checking, setChecking] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const retriedRef = useRef(false);
  const lastPromptRef = useRef("");

  useEffect(() => {
    const s = getServer(id) ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read after hydration
    setServer(s);
    if (s) {
      setItems(loadChat(id));
      setCwd(s.claudeCwd ?? "");
      setBypass(s.claudeBypass ?? true);
      setModelChoice(s.claudeModel ?? "");
    }
  }, [id]);

  const usage = useMemo(() => {
    let cost = 0;
    let turns = 0;
    let runs = 0;
    for (const it of items) {
      if (it.kind === "result") {
        runs += 1;
        if (it.costUsd) cost += it.costUsd;
        if (it.numTurns) turns += it.numTurns;
      }
    }
    return { cost, turns, runs };
  }, [items]);

  useEffect(() => {
    if (server) saveChat(id, items);
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, id, server]);

  useEffect(() => () => wsRef.current?.close(), []);

  function push(item: ChatItem) {
    setItems((prev) => [...prev, item]);
  }

  function markToolDone(toolId: string, isError: boolean) {
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "tool" && it.toolId === toolId ? { ...it, done: true, isError } : it
      )
    );
  }

  function connParams(s: ServerEntry) {
    return {
      host: s.host,
      port: s.port,
      username: s.username,
      auth: s.auth,
      password: s.password,
      privateKey: s.privateKey,
      passphrase: s.passphrase,
    };
  }

  function handleEvent(ev: any) {
    if (ev.type === "system" && ev.subtype === "init") {
      setRun("running");
      setModel(ev.model || "");
      if (ev.session_id) updateServer(id, { claudeSessionId: ev.session_id });
      return;
    }
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "text" && block.text?.trim()) {
          push({ kind: "assistant", text: block.text, ts: Date.now() });
        } else if (block.type === "tool_use") {
          push({
            kind: "tool",
            toolId: block.id,
            name: block.name,
            summary: toolSummary(block.name, block.input),
            done: false,
            ts: Date.now(),
          });
        }
      }
      return;
    }
    if (ev.type === "user" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          markToolDone(block.tool_use_id, !!block.is_error);
        }
      }
      return;
    }
    if (ev.type === "result") {
      if (ev.is_error && ev.result) {
        push({ kind: "error", text: String(ev.result).slice(0, 2000), ts: Date.now() });
      }
      push({
        kind: "result",
        ok: !ev.is_error,
        durationMs: ev.duration_ms,
        costUsd: ev.total_cost_usd,
        numTurns: ev.num_turns,
        ts: Date.now(),
      });
      if (ev.session_id) updateServer(id, { claudeSessionId: ev.session_id });
    }
  }

  function runPrompt(prompt: string, useSession: boolean) {
    const s = getServer(id);
    if (!s) return;
    setRun("connecting");
    lastPromptRef.current = prompt;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/claude`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "run",
          ...connParams(s),
          prompt,
          cwd: s.claudeCwd || undefined,
          sessionId: useSession ? s.claudeSessionId : undefined,
          bypass: s.claudeBypass ?? true,
          model: s.claudeModel || undefined,
        })
      );
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "started") setRun("running");
        else if (msg.type === "event") handleEvent(msg.event);
        else if (msg.type === "raw") {
          push({ kind: "info", text: msg.data, ts: Date.now() });
        } else if (msg.type === "error") {
          push({
            kind: "error",
            text:
              msg.message === "AUTH_FAILED"
                ? "Xác thực SSH thất bại — kiểm tra mật khẩu/key."
                : msg.message,
            ts: Date.now(),
          });
          setRun("idle");
        } else if (msg.type === "done") {
          setRun("idle");
          const err = String(msg.stderr || "");
          if (msg.code !== 0) {
            if (/no conversation found/i.test(err) && !retriedRef.current) {
              // stale session id -> retry once with a fresh session
              retriedRef.current = true;
              updateServer(id, { claudeSessionId: undefined });
              push({ kind: "info", text: "Phiên cũ đã hết hạn — tạo phiên mới…", ts: Date.now() });
              runPrompt(lastPromptRef.current, false);
              return;
            }
            if (msg.code === 127 || /not found/i.test(err)) {
              push({
                kind: "error",
                text:
                  "Không tìm thấy Claude CLI trên server. Cài bằng:\n\ncurl -fsSL https://claude.ai/install.sh | bash\n\nSau đó mở Terminal SSH, chạy `claude` một lần để đăng nhập.",
                ts: Date.now(),
              });
            } else if (msg.code === 90) {
              push({ kind: "error", text: `Không cd được vào thư mục làm việc "${s.claudeCwd}".`, ts: Date.now() });
            } else if (err.trim()) {
              push({ kind: "error", text: err.trim().slice(0, 2000), ts: Date.now() });
            }
          }
          retriedRef.current = false;
        }
      } catch {}
    };
    ws.onerror = () => {
      push({ kind: "error", text: "Mất kết nối tới server trung gian.", ts: Date.now() });
      setRun("idle");
    };
    ws.onclose = () => {
      setRun((r) => (r === "idle" ? r : "idle"));
    };
  }

  function send() {
    const text = input.trim();
    if (!text || run !== "idle") return;
    setInput("");
    retriedRef.current = false;
    push({ kind: "user", text, ts: Date.now() });
    runPrompt(text, true);
  }

  function stop() {
    try {
      wsRef.current?.send(JSON.stringify({ type: "stop" }));
    } catch {}
    setTimeout(() => wsRef.current?.close(), 300);
    push({ kind: "info", text: "Đã dừng.", ts: Date.now() });
    setRun("idle");
  }

  function newChat() {
    if (!confirm("Bắt đầu hội thoại mới? Lịch sử hiện tại sẽ bị xóa.")) return;
    clearChat(id);
    updateServer(id, { claudeSessionId: undefined });
    setItems([]);
    setModel("");
  }

  function checkCli() {
    const s = getServer(id);
    if (!s || checking) return;
    setChecking(true);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/claude`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "check", ...connParams(s) }));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "check-result") {
          setChecking(false);
          push({
            kind: "info",
            text:
              msg.code === 0
                ? `✅ Claude CLI sẵn sàng: ${msg.output}`
                : `❌ Chưa cài Claude CLI (${msg.output || "không tìm thấy"}).\nCài bằng: curl -fsSL https://claude.ai/install.sh | bash`,
            ts: Date.now(),
          });
        } else if (msg.type === "error") {
          setChecking(false);
          push({ kind: "error", text: `Không kiểm tra được: ${msg.message}`, ts: Date.now() });
        }
      } catch {}
    };
    ws.onerror = () => setChecking(false);
  }

  function saveSettings() {
    updateServer(id, { claudeCwd: cwd.trim() || undefined, claudeBypass: bypass, claudeModel: modelChoice || undefined });
    setShowSettings(false);
    const modelLabel = MODEL_OPTIONS.find((m) => m.value === modelChoice)?.label ?? modelChoice;
    push({
      kind: "info",
      text: `Đã lưu: thư mục "${cwd.trim() || "~"}", ${bypass ? "tự chạy lệnh" : "chỉ đọc/sửa file"}, model ${modelLabel}.`,
      ts: Date.now(),
    });
  }

  if (server === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p>Không tìm thấy server.</p>
        <button onClick={() => router.push("/")} className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-fg">
          Về trang chủ
        </button>
      </div>
    );
  }

  const busy = run !== "idle";

  return (
    <div className="fixed inset-0 flex flex-col bg-background" style={{ height: "var(--app-h, 100dvh)" }}>
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
        <button
          onClick={() => router.push("/")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-muted"
          aria-label="Quay lại"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-4">✳️ {server?.name}</p>
          <p className="truncate text-[10px] text-muted">
            {busy ? (
              <span className="text-accent">● đang chạy…</span>
            ) : (
              <span>
                sẵn sàng
                {(model || MODEL_OPTIONS.find((m) => m.value === modelChoice)?.label) &&
                  ` · ${model || MODEL_OPTIONS.find((m) => m.value === modelChoice)?.label}`}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => router.push(`/terminal/${id}`)}
          className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold"
        >
          💻 SSH
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted"
          aria-label="Cài đặt"
        >
          ⚙️
        </button>
        <ThemeToggle />
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="shrink-0 space-y-3 border-b border-border bg-surface px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Thư mục làm việc</label>
            <input
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="~ (home)"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <label className="flex items-start justify-between gap-3 text-sm">
            <span>
              Tự chạy lệnh, không hỏi
              <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                Tắt thì Claude chỉ đọc/sửa file, không chạy được lệnh shell.
              </span>
            </span>
            <input
              type="checkbox"
              checked={bypass}
              onChange={(e) => setBypass(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Model</label>
            <select
              value={MODEL_OPTIONS.some((m) => m.value === modelChoice) ? modelChoice : CUSTOM_MODEL}
              onChange={(e) => setModelChoice(e.target.value === CUSTOM_MODEL ? "custom" : e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Tùy chỉnh (nhập model ID)…</option>
            </select>
            {!MODEL_OPTIONS.some((m) => m.value === modelChoice) && (
              <input
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                value={modelChoice === "custom" ? "" : modelChoice}
                onChange={(e) => setModelChoice(e.target.value)}
                placeholder="VD: claude-opus-4-8"
                autoCapitalize="none"
                autoCorrect="off"
              />
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
            <p className="mb-1 font-medium text-muted">Usage phiên này (lưu trên máy này)</p>
            <p className="text-foreground/90">
              💰 ${usage.cost.toFixed(4)} · {usage.turns} lượt · {usage.runs} lần chạy
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={saveSettings} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg">
              Lưu
            </button>
            <button
              onClick={checkCli}
              disabled={checking}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {checking ? "Đang kiểm tra…" : "Kiểm tra CLI"}
            </button>
            <button onClick={newChat} className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger">
              Hội thoại mới
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 && (
          <div className="mt-14 flex flex-col items-center gap-2 px-6 text-center">
            <div className="text-4xl">✳️</div>
            <p className="font-medium">Giao việc cho Claude trên {server?.name}</p>
            <p className="text-sm text-muted">
              VD: “Kiểm tra dung lượng ổ đĩa và dọn log cũ”, “Xem service nào đang lỗi rồi
              fix”, “Deploy lại app trong ~/myapp”.
            </p>
          </div>
        )}
        <div className="mx-auto max-w-2xl space-y-2.5">
          {items.map((it, i) => (
            <ChatBubble key={i} item={it} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 px-1 py-1 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
              {run === "connecting" ? "Đang kết nối SSH…" : "Claude đang làm việc…"}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border bg-surface px-3 py-2 safe-bottom">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && window.innerWidth >= 640) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            placeholder="Nhắn việc cần làm cho Claude…"
            className="max-h-36 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 outline-none placeholder:text-muted/70 focus:border-accent"
          />
          {busy ? (
            <button
              onClick={stop}
              className="h-11 shrink-0 rounded-xl bg-danger px-4 font-semibold text-white active:scale-95 transition-transform"
            >
              ■ Dừng
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="h-11 shrink-0 rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-40 active:scale-95 transition-transform"
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] text-accent-fg">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="flex">
          <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-border bg-surface px-3.5 py-2.5 text-[15px]">
            {item.text}
          </div>
        </div>
      );
    case "tool":
      return (
        <div className="flex">
          <div
            className={`flex max-w-[92%] items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-xs ${
              item.isError
                ? "border-danger/40 bg-danger/10 text-danger"
                : "border-border bg-surface-2 text-muted"
            }`}
          >
            {item.done ? (
              <span>{item.isError ? "✗" : "✓"}</span>
            ) : (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted border-t-transparent" />
            )}
            <span className="font-semibold text-foreground/80">{item.name}</span>
            {item.summary && <span className="truncate">{item.summary}</span>}
          </div>
        </div>
      );
    case "info":
      return (
        <p className="whitespace-pre-wrap break-words px-1 text-center text-xs text-muted">
          {item.text}
        </p>
      );
    case "error":
      return (
        <div className="whitespace-pre-wrap break-words rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {item.text}
        </div>
      );
    case "result":
      return (
        <p className="px-1 text-center text-[11px] text-muted">
          {item.ok ? "✓" : "✗"}
          {item.durationMs != null && ` · ${(item.durationMs / 1000).toFixed(1)}s`}
          {item.numTurns != null && ` · ${item.numTurns} lượt`}
          {item.costUsd != null && ` · $${item.costUsd.toFixed(4)}`}
        </p>
      );
  }
}
