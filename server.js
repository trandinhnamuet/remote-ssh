/* Custom server: Next.js + WebSocket (ws) + ssh2.
 * WS endpoints:
 *   /ws/ssh      — interactive shell, binary frames for terminal I/O (low latency)
 *   /ws/claude   — runs Claude CLI on the remote host via exec, streams NDJSON events
 *   /ws/schedule — manages daily Claude runs via the remote host's own crontab
 */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer } = require("ws");
const { Client } = require("ssh2");

const dev = process.env.NODE_ENV !== "production" && !process.argv.includes("--prod");
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function buildSshConfig(msg) {
  const cfg = {
    host: msg.host,
    port: Number(msg.port) || 22,
    username: msg.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 4,
    tryKeyboard: true,
  };
  if (msg.auth === "key" && msg.privateKey) {
    cfg.privateKey = msg.privateKey;
    if (msg.passphrase) cfg.passphrase = msg.passphrase;
  } else {
    cfg.password = msg.password || "";
  }
  return cfg;
}

function attachCommonSsh(conn, msg, sendJson, ws) {
  conn.on("keyboard-interactive", (name, instructions, lang, prompts, finish) => {
    finish(prompts.map(() => msg.password || ""));
  });
  conn.on("error", (err) => {
    sendJson({ type: "error", message: err.level === "client-authentication" ? "AUTH_FAILED" : err.message });
    try { ws.close(); } catch {}
  });
  conn.on("close", () => {
    try { ws.close(); } catch {}
  });
}

/* ---------- Interactive terminal ---------- */
function handleTerminal(ws) {
  let conn = null;
  let stream = null;
  const sendJson = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      if (stream) stream.write(data);
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "connect" && !conn) {
      conn = new Client();
      attachCommonSsh(conn, msg, sendJson, ws);
      conn.on("banner", (b) => sendJson({ type: "banner", data: b }));
      conn.on("ready", () => {
        conn.shell(
          { term: "xterm-256color", cols: msg.cols || 80, rows: msg.rows || 24 },
          (err, s) => {
            if (err) {
              sendJson({ type: "error", message: err.message });
              try { ws.close(); } catch {}
              return;
            }
            stream = s;
            s.setNoDelay?.(true);
            sendJson({ type: "ready" });
            // Terminal output goes out as raw binary frames — no JSON/base64 overhead.
            s.on("data", (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
            s.stderr.on("data", (d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
            s.on("close", () => {
              sendJson({ type: "exit" });
              try { ws.close(); } catch {}
              try { conn.end(); } catch {}
            });
          }
        );
      });
      try { conn.connect(buildSshConfig(msg)); }
      catch (e) { sendJson({ type: "error", message: e.message }); try { ws.close(); } catch {} }
    } else if (msg.type === "data") {
      if (stream) stream.write(msg.data);
    } else if (msg.type === "resize") {
      if (stream) stream.setWindow(msg.rows || 24, msg.cols || 80, 0, 0);
    }
  });

  ws.on("close", () => {
    try { if (stream) stream.close(); } catch {}
    try { if (conn) conn.end(); } catch {}
  });
}

/* ---------- Claude CLI runner ---------- */
function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// PATH setup covers the common install locations (native installer, npm -g, nvm).
const CLAUDE_ENV_PREFIX = [
  'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/bin:/usr/local/bin:$PATH"',
  'if ! command -v claude >/dev/null 2>&1; then [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
].join("; ");

function buildClaudeCommand(msg) {
  const parts = [CLAUDE_ENV_PREFIX];
  if (msg.cwd) parts.push(`cd ${shq(msg.cwd)} || exit 90`);
  const flags = ["-p", "--verbose", "--output-format", "stream-json"];
  if (msg.sessionId) flags.push("--resume", shq(msg.sessionId));
  if (msg.bypass) flags.push("--dangerously-skip-permissions");
  else flags.push("--permission-mode", "acceptEdits");
  if (msg.model) flags.push("--model", shq(msg.model));
  parts.push(`claude ${flags.join(" ")}`);
  const inner = parts.join("; ");
  return `bash -c ${shq(inner)}`;
}

function handleClaude(ws) {
  let conn = null;
  let stream = null;
  const sendJson = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if ((msg.type === "run" || msg.type === "check") && !conn) {
      conn = new Client();
      attachCommonSsh(conn, msg, sendJson, ws);
      conn.on("ready", () => {
        const isCheck = msg.type === "check";
        const cmd = isCheck
          ? `bash -c ${shq(CLAUDE_ENV_PREFIX + "; claude --version 2>&1")}`
          : buildClaudeCommand(msg);
        conn.exec(cmd, (err, s) => {
          if (err) {
            sendJson({ type: "error", message: err.message });
            try { ws.close(); } catch {}
            return;
          }
          stream = s;
          sendJson({ type: "started" });
          if (!isCheck) {
            s.write(msg.prompt || "");
            s.end(); // EOF -> claude reads the prompt from stdin
          }
          let outBuf = "";
          let errBuf = "";
          let checkOut = "";
          s.on("data", (d) => {
            if (isCheck) { checkOut += d.toString(); return; }
            outBuf += d.toString();
            let idx;
            while ((idx = outBuf.indexOf("\n")) >= 0) {
              const line = outBuf.slice(0, idx).trim();
              outBuf = outBuf.slice(idx + 1);
              if (!line) continue;
              try { sendJson({ type: "event", event: JSON.parse(line) }); }
              catch { sendJson({ type: "raw", data: line }); }
            }
          });
          s.stderr.on("data", (d) => { errBuf += d.toString(); });
          s.on("close", (code) => {
            if (isCheck) {
              sendJson({ type: "check-result", code: code ?? -1, output: checkOut.trim() });
            } else {
              if (outBuf.trim()) {
                try { sendJson({ type: "event", event: JSON.parse(outBuf.trim()) }); }
                catch { sendJson({ type: "raw", data: outBuf.trim() }); }
              }
              sendJson({ type: "done", code: code ?? -1, stderr: errBuf.slice(0, 4000) });
            }
            try { ws.close(); } catch {}
            try { conn.end(); } catch {}
          });
        });
      });
      try { conn.connect(buildSshConfig(msg)); }
      catch (e) { sendJson({ type: "error", message: e.message }); try { ws.close(); } catch {} }
    } else if (msg.type === "stop") {
      try { if (stream) stream.signal("INT"); } catch {}
      try { if (stream) stream.close(); } catch {}
    }
  });

  ws.on("close", () => {
    try { if (stream) stream.close(); } catch {}
    try { if (conn) conn.end(); } catch {}
  });
}

/* ---------- Scheduled Claude runs (remote crontab) ----------
 * The schedule has to fire when the user's phone is closed, so it lives in the
 * target host's own crontab — not a timer in the browser or in this process.
 * Source of truth on the host: ~/.remote-ssh/schedules.json (+ one .prompt/.log per
 * schedule). The crontab block below is regenerated from that list on every save.
 */
const CRON_DIR = '"$HOME/.remote-ssh"';
const MARK_START = "# >>> remote-ssh schedules >>>";
const MARK_END = "# <<< remote-ssh schedules <<<";

function b64(s) {
  return Buffer.from(String(s), "utf8").toString("base64");
}

// Schedule ids land in filenames and in a shell script, so keep them strictly alphanumeric.
function safeId(id) {
  return /^[a-z0-9]{4,32}$/i.test(String(id || "")) ? String(id) : null;
}

/**
 * Vixie cron (Debian/Ubuntu) silently IGNORES CRON_TZ — verified on the box: a job set
 * with CRON_TZ=Asia/Ho_Chi_Minh never fired at the Vietnamese time, because cron read the
 * fields as server-local (UTC) time. A 05:30 VN schedule was really running at 12:30 VN.
 *
 * So don't ask cron to do timezones. Fire the job every hour instead and let the job itself
 * check the Vietnamese hour and bail out otherwise. The minute field still has to be
 * server-local (see MINUTE_SHIFT in buildSaveScript) for hosts whose UTC offset is not a
 * whole hour. This stays correct no matter what timezone the host is in, and survives the
 * host switching to/from DST without anyone re-saving the schedule.
 */
function vnHourGuard(hour) {
  const hh = String(hour).padStart(2, "0");
  // `date -Is` -> 2026-07-14T05:30:00+07:00; chars 12-13 are the hour. Avoids `%`, which
  // cron would otherwise treat as a newline inside the command.
  return `[ "$(TZ=Asia/Ho_Chi_Minh date -Is | cut -c12-13)" = "${hh}" ] || exit 0`;
}

function buildScheduleCommand(s, model, withGuard) {
  // Fresh session every run: no --resume, so yesterday's context never leaks in.
  const flags = ["-p", "--permission-mode", "acceptEdits"];
  const tools = ["Read", "Glob", "Grep", "Edit", "Write", "TodoWrite"];
  if (s.allowBash) tools.push("Bash");
  flags.push("--allowedTools", shq(tools.join(" ")));
  // File tools are confined to the cwd below (no --add-dir is passed). Bash is the one
  // tool that could step outside it, so it is opt-in per schedule.
  if (!s.allowBash) flags.push("--disallowedTools", shq("Bash"));
  if (model) flags.push("--model", shq(model));

  const log = `"$HOME/.remote-ssh/${s.id}.log"`;
  // Everything (including the cd) runs inside the log redirect. An earlier version put
  // `cd || exit` outside it, so a missing directory killed the run before the log file
  // was ever created — the failure was completely silent.
  const body = [
    'echo "===== $(date -Is) ====="',
    `if cd "$TARGET" 2>/dev/null; then cat "$HOME/.remote-ssh/${s.id}.prompt" | claude ${flags.join(" ")}; else echo "LỖI: không vào được thư mục $TARGET — thư mục không tồn tại?"; fi`,
    "echo",
  ].join("; ");
  const steps = [
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/bin:/usr/local/bin:$PATH"',
  ];
  if (withGuard) steps.push(vnHourGuard(s.hour));
  steps.push(
    'mkdir -p "$HOME/.remote-ssh"',
    `TARGET=${shq(s.cwd)}`,
    `{ ${body}; } >> ${log} 2>&1`,
    `tail -n 3000 ${log} > ${log}.tmp && mv ${log}.tmp ${log}`
  );
  return `bash -lc ${shq(steps.join("; "))}`;
}

function buildCronBlock(schedules, model) {
  const lines = [MARK_START, "# Giờ trong UI là giờ VN; job tự kiểm tra giờ VN (cron bỏ qua CRON_TZ)."];
  for (const s of schedules) {
    if (!s.enabled) continue;
    // Minute is filled in by the save script, which knows the host's real UTC offset.
    lines.push(`__MIN_${s.id}__ * * * * ${buildScheduleCommand(s, model, true)}`);
  }
  lines.push(MARK_END);
  return lines.join("\n") + "\n";
}

function buildSaveScript(schedules, model) {
  const lines = ["set -e", `mkdir -p ${CRON_DIR}`];
  for (const s of schedules) {
    lines.push(`echo ${shq(b64(s.prompt))} | base64 -d > "$HOME/.remote-ssh/${s.id}.prompt"`);
  }
  lines.push(`echo ${shq(b64(JSON.stringify(schedules)))} | base64 -d > "$HOME/.remote-ssh/schedules.json"`);

  // Cron's minute field is server-local. Vietnam is UTC+7 (no DST), so shift each minute by
  // the host offset's sub-hour part — 0 on a UTC host, 30 on e.g. an Asia/Kolkata one.
  lines.push(
    'OFF=$(date +%z)',
    'OFF_MIN=$(( 10#${OFF:1:2} * 60 + 10#${OFF:3:2} ))',
    '[ "${OFF:0:1}" = "-" ] && OFF_MIN=$(( -OFF_MIN ))',
    'MINUTE_SHIFT=$(( ((OFF_MIN - 420) % 60 + 60) % 60 ))',
    // A no-op expression so `sed $SED_ARGS` still has a script when no schedule is enabled.
    "SED_ARGS='-e s/__noop__/__noop__/'"
  );
  for (const s of schedules) {
    if (!s.enabled) continue;
    lines.push(
      `SED_ARGS="$SED_ARGS -e s/__MIN_${s.id}__/$(( (${s.minute} + MINUTE_SHIFT) % 60 ))/"`
    );
  }
  lines.push(
    `NEW=$(echo ${shq(b64(buildCronBlock(schedules, model)))} | base64 -d | sed $SED_ARGS)`
  );
  lines.push(
    `{ crontab -l 2>/dev/null | sed '/${MARK_START}/,/${MARK_END}/d'; echo "$NEW"; } | crontab -`
  );
  lines.push("echo SAVED_OK");
  return `bash -c ${shq(lines.join("\n"))}`;
}

function handleSchedule(ws) {
  let conn = null;
  const sendJson = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const runCmd = (cmd, onDone) => {
    conn.exec(cmd, (err, s) => {
      if (err) {
        sendJson({ type: "error", message: err.message });
        try { ws.close(); } catch {}
        return;
      }
      let out = "";
      let errOut = "";
      s.on("data", (d) => { out += d.toString(); });
      s.stderr.on("data", (d) => { errOut += d.toString(); });
      s.on("close", (code) => {
        onDone(code ?? -1, out, errOut);
        try { ws.close(); } catch {}
        try { conn.end(); } catch {}
      });
    });
  };

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (conn) return;

    const kinds = ["list", "save", "log", "run-now", "check-dir", "mkdir"];
    if (!kinds.includes(msg.type)) return;

    conn = new Client();
    attachCommonSsh(conn, msg, sendJson, ws);
    conn.on("ready", () => {
      if (msg.type === "list") {
        runCmd(`cat "$HOME/.remote-ssh/schedules.json" 2>/dev/null || echo "[]"`, (code, out) => {
          let schedules = [];
          try { schedules = JSON.parse(out.trim() || "[]"); } catch {}
          sendJson({ type: "list-result", schedules: Array.isArray(schedules) ? schedules : [] });
        });
        return;
      }

      if (msg.type === "check-dir" || msg.type === "mkdir") {
        const path = String(msg.path || "");
        if (!path) {
          sendJson({ type: "error", message: "Thiếu đường dẫn." });
          try { ws.close(); } catch {}
          return;
        }
        const cmd =
          msg.type === "mkdir"
            ? `bash -lc ${shq(`mkdir -p ${shq(path)} && echo EXISTS`)}`
            : `bash -lc ${shq(`[ -d ${shq(path)} ] && echo EXISTS || echo MISSING`)}`;
        runCmd(cmd, (code, out, errOut) => {
          if (out.includes("EXISTS")) sendJson({ type: "dir-result", exists: true });
          else if (out.includes("MISSING")) sendJson({ type: "dir-result", exists: false });
          else sendJson({ type: "error", message: (errOut || out || "Không kiểm tra được thư mục").trim().slice(0, 300) });
        });
        return;
      }

      if (msg.type === "save") {
        const list = Array.isArray(msg.schedules) ? msg.schedules : [];
        const clean = [];
        for (const s of list) {
          const id = safeId(s.id);
          if (!id || !s.cwd || !String(s.prompt || "").trim()) continue;
          clean.push({
            id,
            name: String(s.name || "").slice(0, 80),
            hour: Math.min(23, Math.max(0, parseInt(s.hour, 10) || 0)),
            minute: Math.min(59, Math.max(0, parseInt(s.minute, 10) || 0)),
            prompt: String(s.prompt),
            cwd: String(s.cwd),
            allowBash: !!s.allowBash,
            enabled: s.enabled !== false,
          });
        }
        runCmd(buildSaveScript(clean, msg.model), (code, out, errOut) => {
          if (code === 0 && out.includes("SAVED_OK")) {
            sendJson({ type: "saved", schedules: clean });
          } else {
            sendJson({ type: "error", message: (errOut || out || "Lưu lịch thất bại").trim().slice(0, 500) });
          }
        });
        return;
      }

      const id = safeId(msg.scheduleId);
      if (!id) {
        sendJson({ type: "error", message: "ID lịch không hợp lệ." });
        try { ws.close(); } catch {}
        return;
      }

      if (msg.type === "log") {
        runCmd(`tail -c 20000 "$HOME/.remote-ssh/${id}.log" 2>/dev/null || echo "(chưa có log — lịch chưa chạy lần nào)"`,
          (code, out) => sendJson({ type: "log-result", text: out })
        );
        return;
      }

      if (msg.type === "run-now") {
        const s = (Array.isArray(msg.schedules) ? msg.schedules : []).find((x) => safeId(x.id) === id);
        if (!s || !s.cwd) {
          sendJson({ type: "error", message: "Không tìm thấy lịch." });
          try { ws.close(); } catch {}
          return;
        }
        const cmd = buildScheduleCommand({ ...s, id }, msg.model);
        // Detach so the SSH channel can close while Claude keeps working.
        runCmd(`nohup ${cmd} >/dev/null 2>&1 & echo STARTED`, (code, out, errOut) => {
          if (out.includes("STARTED")) sendJson({ type: "run-started" });
          else sendJson({ type: "error", message: (errOut || out || "Không chạy được").trim().slice(0, 500) });
        });
      }
    });

    try { conn.connect(buildSshConfig(msg)); }
    catch (e) { sendJson({ type: "error", message: e.message }); try { ws.close(); } catch {} }
  });

  ws.on("close", () => {
    try { if (conn) conn.end(); } catch {}
  });
}

/* ---------- Boot ---------- */
app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const wssTerm = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const wssClaude = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const wssSchedule = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  wssTerm.on("connection", handleTerminal);
  wssClaude.on("connection", handleClaude);
  wssSchedule.on("connection", handleSchedule);

  const nextUpgrade = app.getUpgradeHandler();
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "", true);
    if (pathname === "/ws/ssh") {
      wssTerm.handleUpgrade(req, socket, head, (ws) => wssTerm.emit("connection", ws, req));
    } else if (pathname === "/ws/claude") {
      wssClaude.handleUpgrade(req, socket, head, (ws) => wssClaude.emit("connection", ws, req));
    } else if (pathname === "/ws/schedule") {
      wssSchedule.handleUpgrade(req, socket, head, (ws) => wssSchedule.emit("connection", ws, req));
    } else {
      // Let Next handle its own upgrades (HMR in dev)
      nextUpgrade(req, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (${dev ? "dev" : "prod"})`);
  });
});
