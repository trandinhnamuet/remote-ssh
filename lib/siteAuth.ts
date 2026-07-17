"use client";

/**
 * App-level login, replacing nginx Basic Auth. A browser's WebSocket API cannot set
 * custom headers, and warming the browser's Basic-Auth cache via fetch() does not carry
 * over to WebSocket requests (verified empirically) — only the native browser prompt
 * does, and that's exactly the prompt we're trying to stop asking for. So every WS
 * connection authenticates itself: send {type:"auth", username, password} as the first
 * message, before any real payload.
 */

const KEY = "remote-ssh.siteAuth";

export interface SiteAuth {
  username: string;
  password: string;
}

export function loadSiteAuth(): SiteAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.username === "string" && typeof v.password === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveSiteAuth(a: SiteAuth) {
  localStorage.setItem(KEY, JSON.stringify(a));
}

/** Clears saved credentials and tells any mounted AuthGate to show the login screen again. */
export function clearSiteAuth() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("site-auth-cleared"));
}

/** First frame every /ws/* connection must send before anything else. */
export function authFrame(a?: SiteAuth | null): string {
  const auth = a ?? loadSiteAuth();
  return JSON.stringify({ type: "auth", username: auth?.username ?? "", password: auth?.password ?? "" });
}

/**
 * Tries a set of credentials against the server without doing anything else (no SSH
 * connection is attempted — the auth gate replies before any message dispatch).
 */
export function verifySiteAuth(a: SiteAuth): Promise<boolean> {
  return new Promise((resolve) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/ssh`);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 10000);
    ws.onopen = () => ws.send(authFrame(a));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        clearTimeout(timer);
        finish(msg.type === "auth-ok");
      } catch {
        clearTimeout(timer);
        finish(false);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish(false);
    };
  });
}
