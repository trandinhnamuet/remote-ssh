"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { ServerEntry, getServer } from "@/lib/servers";
import { getTheme } from "@/components/ThemeToggle";

const DARK_THEME = {
  background: "#0b0e14",
  foreground: "#d8dee9",
  cursor: "#34d399",
  cursorAccent: "#0b0e14",
  selectionBackground: "#2f3b52",
  black: "#1c2333",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d8dee9",
  brightBlack: "#5b6673",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fcd34d",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#eef1f5",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1a202c",
  cursor: "#059669",
  cursorAccent: "#ffffff",
  selectionBackground: "#c7d2fe",
  black: "#1a202c",
  red: "#dc2626",
  green: "#059669",
  yellow: "#b45309",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0e7490",
  white: "#94a3b8",
  brightBlack: "#64748b",
  brightRed: "#ef4444",
  brightGreen: "#10b981",
  brightYellow: "#d97706",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#f1f5f9",
};

type Status = "connecting" | "connected" | "closed" | "error";

const KEYS: { label: string; seq: string }[] = [
  { label: "Esc", seq: "\x1b" },
  { label: "Tab", seq: "\t" },
  { label: "^C", seq: "\x03" },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
  { label: "-", seq: "-" },
  { label: "/", seq: "/" },
  { label: "|", seq: "|" },
  { label: "~", seq: "~" },
];

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctrlRef = useRef(false);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [errMsg, setErrMsg] = useState("");
  const [server, setServer] = useState<ServerEntry | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "data", data }));
    }
  }, []);

  const pressKey = useCallback(
    (seq: string) => {
      if (seq === "\x1b[CTRL]") return;
      sendInput(seq);
      termRef.current?.focus();
    },
    [sendInput]
  );

  const toggleCtrl = useCallback(() => {
    ctrlRef.current = !ctrlRef.current;
    setCtrlOn(ctrlRef.current);
    termRef.current?.focus();
  }, []);

  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) sendInput(text);
    } catch {
      const text = prompt("Dán nội dung cần gửi:");
      if (text) sendInput(text);
    }
    termRef.current?.focus();
  }, [sendInput]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read after hydration
    setServer(getServer(id) ?? null);
  }, [id]);

  useEffect(() => {
    if (!server || !containerRef.current) return;
    let disposed = false;
    let term: Terminal;
    let fit: FitAddon;
    let ws: WebSocket;
    const cleanupFns: (() => void)[] = [];

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      try {
        await document.fonts.ready;
      } catch {}
      if (disposed || !containerRef.current) return;

      const fontFamily =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-geist-mono")
          .trim() || "monospace";
      const isMobile = window.innerWidth < 640;

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: `${fontFamily}, monospace`,
        fontSize: isMobile ? 13 : 14,
        lineHeight: 1.25,
        scrollback: 8000,
        theme: getTheme() === "dark" ? DARK_THEME : LIGHT_THEME,
        allowProposedApi: true,
        scrollOnUserInput: true,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // canvas fallback is fine
      }
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      // theme switching
      const onTheme = () => {
        term.options.theme = getTheme() === "dark" ? DARK_THEME : LIGHT_THEME;
      };
      window.addEventListener("themechange", onTheme);
      cleanupFns.push(() => window.removeEventListener("themechange", onTheme));

      // resize handling (desktop resize + mobile keyboard)
      const doFit = () => {
        try {
          fit.fit();
          const ws0 = wsRef.current;
          if (ws0 && ws0.readyState === WebSocket.OPEN) {
            ws0.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          }
        } catch {}
      };
      const ro = new ResizeObserver(() => doFit());
      if (wrapRef.current) ro.observe(wrapRef.current);
      cleanupFns.push(() => ro.disconnect());

      const vv = window.visualViewport;
      const onVV = () => {
        if (wrapRef.current && vv) {
          // keep the app exactly the size of the visible viewport (iOS keyboard)
          document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
          window.scrollTo(0, 0);
        }
      };
      if (vv) {
        vv.addEventListener("resize", onVV);
        onVV();
        cleanupFns.push(() => vv.removeEventListener("resize", onVV));
      }

      // input -> ws (with Ctrl modifier from the key bar)
      term.onData((data) => {
        if (ctrlRef.current && data.length === 1) {
          ctrlRef.current = false;
          setCtrlOn(false);
          const code = data.toUpperCase().charCodeAt(0);
          if (code >= 64 && code < 128) {
            sendInput(String.fromCharCode(code & 31));
            return;
          }
        }
        sendInput(data);
      });

      // connect
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/ssh`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "connect",
            host: server.host,
            port: server.port,
            username: server.username,
            auth: server.auth,
            password: server.password,
            privateKey: server.privateKey,
            passphrase: server.passphrase,
            cols: term.cols,
            rows: term.rows,
          })
        );
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "ready") {
              setStatus("connected");
              term.focus();
            } else if (msg.type === "banner") {
              term.write(String(msg.data).replace(/\n/g, "\r\n"));
            } else if (msg.type === "error") {
              setErrMsg(
                msg.message === "AUTH_FAILED"
                  ? "Xác thực thất bại — kiểm tra lại mật khẩu/key."
                  : msg.message
              );
              setStatus("error");
            } else if (msg.type === "exit") {
              setStatus("closed");
            }
          } catch {}
        } else {
          term.write(new Uint8Array(ev.data as ArrayBuffer));
        }
      };
      ws.onclose = () => {
        setStatus((s) => (s === "error" ? s : s === "connecting" ? "error" : "closed"));
        setErrMsg((m) => m || "Kết nối đã đóng.");
      };
      ws.onerror = () => {
        setErrMsg("Không kết nối được tới server trung gian.");
        setStatus("error");
      };
    })();

    return () => {
      disposed = true;
      cleanupFns.forEach((f) => f());
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      try { termRef.current?.dispose(); } catch {}
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, attempt]);

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

  return (
    <div
      className="fixed inset-0 flex flex-col bg-background"
      style={{ height: "var(--app-h, 100dvh)" }}
    >
      {/* Header */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
        <button
          onClick={() => router.push("/")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-muted"
          aria-label="Quay lại"
        >
          ←
        </button>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            status === "connected"
              ? "bg-accent"
              : status === "connecting"
              ? "animate-pulse bg-yellow-400"
              : "bg-danger"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-4">{server?.name}</p>
          <p className="truncate font-mono text-[10px] text-muted">
            {server ? `${server.username}@${server.host}` : ""}
          </p>
        </div>
        {server?.hasClaude && (
          <button
            onClick={() => router.push(`/claude/${id}`)}
            className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent"
          >
            ✳️ Claude
          </button>
        )}
      </header>

      {/* Terminal */}
      <div ref={wrapRef} className="term-wrap relative min-h-0 flex-1" style={{ background: "var(--term-bg)" }}>
        <div ref={containerRef} className="absolute inset-0" />
        {status !== "connected" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 p-6 text-center backdrop-blur-sm">
            {status === "connecting" ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
                <p className="text-sm text-muted">
                  Đang kết nối {server?.username}@{server?.host}…
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl">{status === "error" ? "⚠️" : "🔌"}</p>
                <p className="max-w-sm break-words text-sm">{errMsg || "Phiên đã kết thúc."}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push("/")}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted"
                  >
                    Trang chủ
                  </button>
                  <button
                    onClick={() => {
                      setErrMsg("");
                      setAttempt((a) => a + 1);
                    }}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
                  >
                    Kết nối lại
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Key bar */}
      <div className="shrink-0 border-t border-border bg-surface safe-bottom">
        <div className="flex items-center gap-1 overflow-x-auto px-1.5 py-1.5 [scrollbar-width:none]">
          <KeyBtn label="Ctrl" onPress={toggleCtrl} active={ctrlOn} />
          {KEYS.map((k) => (
            <KeyBtn key={k.label} label={k.label} onPress={() => pressKey(k.seq)} />
          ))}
          <KeyBtn label="📋 Dán" onPress={pasteClipboard} wide />
        </div>
      </div>
    </div>
  );
}

function KeyBtn({
  label,
  onPress,
  active,
  wide,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      // preventDefault keeps focus (and the soft keyboard) on the terminal
      onMouseDown={(e) => e.preventDefault()}
      onTouchEnd={(e) => {
        e.preventDefault();
        onPress();
      }}
      onClick={onPress}
      className={`shrink-0 rounded-md border px-3 py-2 font-mono text-[13px] font-semibold leading-none transition-colors ${
        wide ? "px-3.5" : "min-w-[2.6rem]"
      } ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-border bg-surface-2 text-foreground active:bg-border"
      }`}
    >
      {label}
    </button>
  );
}
