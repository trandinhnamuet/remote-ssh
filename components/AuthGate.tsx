"use client";

import { useEffect, useState } from "react";
import { SiteAuth, loadSiteAuth, saveSiteAuth, verifySiteAuth } from "@/lib/siteAuth";

type Status = "checking" | "ok" | "needLogin";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Probe with whatever is saved (possibly nothing) — if the server has no site
    // password configured (local dev), this succeeds immediately and no form ever shows.
    const saved = loadSiteAuth();
    verifySiteAuth(saved ?? { username: "", password: "" }).then((ok) => {
      if (cancelled) return;
      setStatus(ok ? "ok" : "needLogin");
    });

    const onCleared = () => setStatus("needLogin");
    window.addEventListener("site-auth-cleared", onCleared);
    return () => {
      cancelled = true;
      window.removeEventListener("site-auth-cleared", onCleared);
    };
  }, []);

  const submit = async () => {
    if (!username.trim() || !password) {
      setErr("Nhập đủ tên đăng nhập và mật khẩu.");
      return;
    }
    setBusy(true);
    setErr("");
    const candidate: SiteAuth = { username: username.trim(), password };
    const ok = await verifySiteAuth(candidate);
    setBusy(false);
    if (ok) {
      saveSiteAuth(candidate);
      setStatus("ok");
    } else {
      setErr("Sai tên đăng nhập hoặc mật khẩu.");
    }
  };

  if (status === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }

  if (status === "needLogin") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-xs">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent font-mono text-xl font-bold text-accent-fg">
              &gt;_
            </div>
            <h1 className="text-lg font-bold">Remote SSH</h1>
            <p className="text-sm text-muted">Đăng nhập để dùng ứng dụng</p>
          </div>

          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 outline-none placeholder:text-muted/70 focus:border-accent"
              placeholder="Tên đăng nhập"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <input
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 outline-none placeholder:text-muted/70 focus:border-accent"
              placeholder="Mật khẩu"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {err && <p className="text-sm text-danger">{err}</p>}
            <button
              onClick={submit}
              disabled={busy}
              className="w-full rounded-lg bg-accent py-2.5 font-semibold text-accent-fg disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {busy ? "Đang kiểm tra…" : "Đăng nhập"}
            </button>
          </div>

          <p className="mt-4 text-center text-[11px] leading-4 text-muted">
            Đăng nhập một lần — trình duyệt này sẽ nhớ, không hỏi lại.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
