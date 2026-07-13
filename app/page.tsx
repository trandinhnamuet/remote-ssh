"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ServerEntry,
  loadServers,
  saveServers,
  upsertServer,
  deleteServer,
} from "@/lib/servers";
import { useDragReorder } from "@/lib/useDragReorder";
import ServerForm from "@/components/ServerForm";
import ScheduleModal from "@/components/ScheduleModal";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  const router = useRouter();
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<ServerEntry | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read after hydration
    setServers(loadServers());
    setLoaded(true);
  }, []);

  const commitOrder = useCallback((next: ServerEntry[]) => saveServers(next), []);
  const { dragId, ghost, registerCard, onPointerDown, shouldSuppressClick } =
    useDragReorder(servers, setServers, commitOrder);

  const refresh = () => setServers(loadServers());

  const onSave = (s: ServerEntry) => {
    upsertServer(s);
    setAdding(false);
    setEditing(null);
    refresh();
  };

  const onDelete = (s: ServerEntry) => {
    if (confirm(`Xóa server "${s.name}"?`)) {
      deleteServer(s.id);
      setMenuFor(null);
      refresh();
    }
  };

  const open = (path: string) => {
    if (shouldSuppressClick()) return; // vừa thả tay sau khi kéo, không mở
    router.push(path);
  };

  const dragged = dragId ? servers.find((s) => s.id === dragId) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-28">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-mono text-lg font-bold text-accent-fg">
            &gt;_
          </div>
          <div>
            <h1 className="text-lg font-bold leading-5">Remote SSH</h1>
            <p className="text-xs text-muted">Điều khiển server từ điện thoại</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {loaded && servers.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <div className="text-5xl">🖥️</div>
          <p className="font-medium">Chưa có server nào</p>
          <p className="max-w-xs text-sm text-muted">
            Bấm <span className="font-semibold text-accent">+ Thêm server</span> để lưu
            thông tin SSH (username, IP, mật khẩu hoặc key).
          </p>
        </div>
      )}

      {servers.length > 1 && (
        <p className="mb-2 text-center text-[11px] text-muted">
          Giữ một card rồi kéo để sắp xếp lại thứ tự
        </p>
      )}

      <div className="space-y-3">
        {servers.map((s) => (
          <div
            key={s.id}
            ref={(el) => registerCard(s.id, el)}
            onPointerDown={(e) => onPointerDown(e, s)}
            onContextMenu={(e) => e.preventDefault()}
            className={`touch-pan-y select-none [-webkit-touch-callout:none] transition-opacity ${
              dragId === s.id ? "opacity-0" : "opacity-100"
            }`}
          >
            <ServerCard
              s={s}
              menuOpen={menuFor === s.id}
              onMenuToggle={() => setMenuFor(menuFor === s.id ? null : s.id)}
              onOpen={open}
              onEdit={() => {
                setEditing(s);
                setMenuFor(null);
              }}
              onSchedule={() => {
                setScheduleFor(s);
                setMenuFor(null);
              }}
              onDelete={() => onDelete(s)}
            />
          </div>
        ))}
      </div>

      {/* Bóng của card đang được kéo — bám theo ngón tay */}
      {dragged && ghost && (
        <div
          className="pointer-events-none fixed z-40 rotate-1 scale-[1.03] opacity-95 drop-shadow-2xl"
          style={{ left: ghost.x, top: ghost.y, width: ghost.w }}
        >
          <ServerCard s={dragged} dragging />
        </div>
      )}

      <button
        onClick={() => setAdding(true)}
        className="fixed bottom-6 right-1/2 z-30 translate-x-1/2 rounded-full bg-accent px-6 py-3.5 font-semibold text-accent-fg shadow-lg shadow-accent/25 active:scale-95 transition-transform sm:right-[max(1.5rem,calc(50%-21rem))] sm:translate-x-0"
      >
        + Thêm server
      </button>

      {(adding || editing) && (
        <ServerForm
          initial={editing ?? undefined}
          onSave={onSave}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      {scheduleFor && (
        <ScheduleModal server={scheduleFor} onClose={() => setScheduleFor(null)} />
      )}

      {menuFor && (
        <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
      )}
    </main>
  );
}

function ServerCard({
  s,
  menuOpen,
  onMenuToggle,
  onOpen,
  onEdit,
  onSchedule,
  onDelete,
  dragging,
}: {
  s: ServerEntry;
  menuOpen?: boolean;
  onMenuToggle?: () => void;
  onOpen?: (path: string) => void;
  onEdit?: () => void;
  onSchedule?: () => void;
  onDelete?: () => void;
  dragging?: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border bg-surface p-3.5 shadow-sm ${
        dragging ? "border-accent" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpen?.(s.hasClaude ? `/claude/${s.id}` : `/terminal/${s.id}`)}
        >
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{s.name}</span>
            {s.hasClaude && (
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                ✳️ Claude
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">
            {s.username}@{s.host}
            {s.port !== 22 ? `:${s.port}` : ""} ·{" "}
            {s.auth === "key" ? "🔑 key" : "🔒 mật khẩu"}
          </p>
        </button>
        <button
          data-no-drag
          className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-muted"
          onClick={onMenuToggle}
          aria-label="Menu"
        >
          ⋯
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onOpen?.(`/terminal/${s.id}`)}
          className="flex-1 rounded-lg bg-surface-2 py-2 text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          💻 Terminal
        </button>
        {s.hasClaude && (
          <button
            onClick={() => onOpen?.(`/claude/${s.id}`)}
            className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg active:scale-[0.98] transition-transform"
          >
            ✳️ Claude CLI
          </button>
        )}
      </div>

      {menuOpen && (
        <div
          data-no-drag
          className="absolute right-2 top-10 z-20 w-52 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          <button className="block w-full px-4 py-2.5 text-left text-sm" onClick={onEdit}>
            ✏️ Sửa
          </button>
          {s.hasClaude && (
            <button
              className="block w-full px-4 py-2.5 text-left text-sm"
              onClick={onSchedule}
            >
              ⏰ Hẹn giờ nhắn tin
            </button>
          )}
          <button
            className="block w-full px-4 py-2.5 text-left text-sm text-danger"
            onClick={onDelete}
          >
            🗑️ Xóa
          </button>
        </div>
      )}
    </div>
  );
}
