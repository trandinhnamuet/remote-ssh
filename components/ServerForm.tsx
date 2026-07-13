"use client";

import { useEffect, useState } from "react";
import { AuthMethod, ServerEntry, newId } from "@/lib/servers";

const field =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-foreground placeholder:text-muted/70 outline-none focus:border-accent";

export default function ServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ServerEntry;
  onSave: (s: ServerEntry) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [auth, setAuth] = useState<AuthMethod>(initial?.auth ?? "password");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [showPw, setShowPw] = useState(false);
  const [privateKey, setPrivateKey] = useState(initial?.privateKey ?? "");
  const [passphrase, setPassphrase] = useState(initial?.passphrase ?? "");
  const [hasClaude, setHasClaude] = useState(initial?.hasClaude ?? false);
  const [claudeCwd, setClaudeCwd] = useState(initial?.claudeCwd ?? "");
  const [err, setErr] = useState("");

  // Lock body scroll while the sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = () => {
    if (!host.trim() || !username.trim()) {
      setErr("Cần nhập host (IPv4) và username.");
      return;
    }
    if (auth === "password" && !password) {
      setErr("Cần nhập mật khẩu (hoặc chuyển sang SSH key).");
      return;
    }
    if (auth === "key" && !privateKey.trim()) {
      setErr("Cần dán nội dung private key.");
      return;
    }
    onSave({
      id: initial?.id ?? newId(),
      name: name.trim() || `${username.trim()}@${host.trim()}`,
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      auth,
      password: password || undefined,
      privateKey: auth === "key" ? privateKey : undefined,
      passphrase: auth === "key" && passphrase ? passphrase : undefined,
      hasClaude,
      claudeCwd: claudeCwd.trim() || undefined,
      claudeBypass: initial?.claudeBypass ?? true,
      claudeSessionId: initial?.claudeSessionId,
      createdAt: initial?.createdAt ?? Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface sm:max-w-lg sm:rounded-2xl sm:border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">
            {initial ? "Sửa server" : "Thêm server"}
          </h2>
          <button onClick={onCancel} className="rounded-lg px-2 py-1 text-muted">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 safe-bottom">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Tên gợi nhớ</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: VPS Production" />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted">Host / IPv4 *</label>
              <input
                className={field}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="103.15.xx.xx"
                inputMode="decimal"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium text-muted">Port</label>
              <input className={field} value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Username *</label>
            <input
              className={field}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root / ubuntu"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Xác thực</label>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-2 p-1">
              {(["password", "key"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAuth(m)}
                  className={`rounded-md py-2 text-sm font-medium transition-colors ${
                    auth === m ? "bg-accent text-accent-fg" : "text-muted"
                  }`}
                >
                  {m === "password" ? "Mật khẩu" : "SSH Key"}
                </button>
              ))}
            </div>
          </div>

          {auth === "password" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Mật khẩu *</label>
              <div className="relative">
                <input
                  className={`${field} pr-12`}
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoCapitalize="none"
                />
                <button
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm text-muted"
                >
                  {showPw ? "Ẩn" : "Hiện"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Private key (nội dung file) *</label>
                <textarea
                  className={`${field} h-28 font-mono text-xs`}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Passphrase (nếu key có)</label>
                <input
                  className={field}
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium">✳️ Server có cài Claude CLI</span>
              <input
                type="checkbox"
                checked={hasClaude}
                onChange={(e) => setHasClaude(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
            {hasClaude && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-muted">
                  Thư mục làm việc của Claude (mặc định: home)
                </label>
                <input
                  className={field}
                  value={claudeCwd}
                  onChange={(e) => setClaudeCwd(e.target.value)}
                  placeholder="/home/ubuntu/my-project"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            )}
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
              Lưu
            </button>
          </div>

          <p className="pt-1 text-[11px] leading-4 text-muted">
            Thông tin chỉ lưu trong localStorage của trình duyệt này và chỉ gửi tới server
            trung gian của bạn khi kết nối SSH.
          </p>
        </div>
      </div>
    </div>
  );
}
