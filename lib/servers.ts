export type AuthMethod = "password" | "key";

export interface ServerEntry {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  hasClaude: boolean;
  claudeCwd?: string;
  claudeBypass?: boolean;
  claudeSessionId?: string;
  createdAt: number;
}

const KEY = "remote-ssh.servers";

export function loadServers(): ServerEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveServers(list: ServerEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getServer(id: string): ServerEntry | undefined {
  return loadServers().find((s) => s.id === id);
}

export function upsertServer(entry: ServerEntry) {
  const list = loadServers();
  const i = list.findIndex((s) => s.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  saveServers(list);
}

export function updateServer(id: string, patch: Partial<ServerEntry>) {
  const list = loadServers();
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
    saveServers(list);
  }
}

export function deleteServer(id: string) {
  saveServers(loadServers().filter((s) => s.id !== id));
  localStorage.removeItem(chatKey(id));
}

export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

/* ---------- Claude chat history ---------- */

export type ChatItem =
  | { kind: "user"; text: string; ts: number }
  | { kind: "assistant"; text: string; ts: number }
  | { kind: "tool"; toolId: string; name: string; summary: string; done: boolean; isError?: boolean; ts: number }
  | { kind: "info"; text: string; ts: number }
  | { kind: "error"; text: string; ts: number }
  | { kind: "result"; ok: boolean; durationMs?: number; costUsd?: number; numTurns?: number; ts: number };

function chatKey(id: string) {
  return `remote-ssh.chat.${id}`;
}

export function loadChat(id: string): ChatItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(chatKey(id));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveChat(id: string, items: ChatItem[]) {
  // Cap history so localStorage doesn't grow unbounded
  const capped = items.length > 400 ? items.slice(items.length - 400) : items;
  try {
    localStorage.setItem(chatKey(id), JSON.stringify(capped));
  } catch {
    // quota exceeded — drop oldest half and retry once
    try {
      localStorage.setItem(chatKey(id), JSON.stringify(capped.slice(Math.floor(capped.length / 2))));
    } catch {}
  }
}

export function clearChat(id: string) {
  localStorage.removeItem(chatKey(id));
}
