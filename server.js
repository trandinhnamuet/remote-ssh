/* Custom server: Next.js + WebSocket (ws) + ssh2.
 * Two WS endpoints:
 *   /ws/ssh    — interactive shell, binary frames for terminal I/O (low latency)
 *   /ws/claude — runs Claude CLI on the remote host via exec, streams NDJSON events
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

/* ---------- Boot ---------- */
app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const wssTerm = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const wssClaude = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  wssTerm.on("connection", handleTerminal);
  wssClaude.on("connection", handleClaude);

  const nextUpgrade = app.getUpgradeHandler();
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "", true);
    if (pathname === "/ws/ssh") {
      wssTerm.handleUpgrade(req, socket, head, (ws) => wssTerm.emit("connection", ws, req));
    } else if (pathname === "/ws/claude") {
      wssClaude.handleUpgrade(req, socket, head, (ws) => wssClaude.emit("connection", ws, req));
    } else {
      // Let Next handle its own upgrades (HMR in dev)
      nextUpgrade(req, socket, head);
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (${dev ? "dev" : "prod"})`);
  });
});
