"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const HOLD_MS = 400; // giữ bao lâu thì bắt đầu kéo
const MOVE_CANCEL_PX = 8; // nhúc nhích quá ngần này trước khi kích hoạt = user đang cuộn
const EDGE_PX = 90; // vào sát mép màn hình thì tự cuộn
const EDGE_SPEED = 12;

export interface Ghost {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Long-press để nhấc một item lên rồi kéo đổi chỗ. Dùng Pointer Events nên chạy
 * chung cho cả cảm ứng lẫn chuột.
 */
export function useDragReorder<T extends { id: string }>(
  items: T[],
  setItems: (updater: (prev: T[]) => T[]) => void,
  onCommit: (items: T[]) => void
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);

  // Thứ tự mới nhất, để lúc thả tay lưu được mà không phải gọi side-effect trong state updater.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const holdTimer = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const lastY = useRef(0);
  // Chặn click ngay sau khi thả, nếu không thì thả tay xong sẽ mở luôn server.
  const suppressClick = useRef(false);

  const pointer = useRef<{
    id: string;
    startX: number;
    startY: number;
    offX: number;
    offY: number;
    w: number;
    h: number;
    active: boolean;
  } | null>(null);

  const registerCard = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const stopAutoScroll = () => {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  };

  const cleanup = useCallback(() => {
    if (holdTimer.current != null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    stopAutoScroll();
    pointer.current = null;
    setDragId(null);
    setGhost(null);
    document.body.style.userSelect = "";
  }, []);

  /** Đổi chỗ item đang kéo tới vị trí tương ứng với toạ độ Y hiện tại của ngón tay. */
  const reorder = useCallback(
    (pointerY: number, id: string) => {
      setItems((prev) => {
        const from = prev.findIndex((x) => x.id === id);
        if (from < 0) return prev;

        let to = prev.length - 1;
        for (let i = 0; i < prev.length; i++) {
          const el = cardRefs.current.get(prev[i].id);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (pointerY < r.top + r.height / 2) {
            to = i;
            break;
          }
        }
        if (to === from) return prev;

        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [setItems]
  );

  useEffect(() => {
    // touchmove phải là non-passive mới preventDefault được để khoá cuộn trang khi đang kéo.
    const onTouchMove = (e: TouchEvent) => {
      if (pointer.current?.active) e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      const p = pointer.current;
      if (!p) return;

      if (!p.active) {
        // Chưa đủ thời gian giữ mà đã trượt -> user muốn cuộn, bỏ qua.
        if (
          Math.abs(e.clientY - p.startY) > MOVE_CANCEL_PX ||
          Math.abs(e.clientX - p.startX) > MOVE_CANCEL_PX
        ) {
          cleanup();
        }
        return;
      }

      lastY.current = e.clientY;
      setGhost({ x: e.clientX - p.offX, y: e.clientY - p.offY, w: p.w, h: p.h });
      reorder(e.clientY, p.id);
    };

    const onUp = () => {
      const p = pointer.current;
      if (p?.active) {
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 350);
        onCommit(itemsRef.current);
      }
      cleanup();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("touchmove", onTouchMove);
      cleanup();
    };
  }, [cleanup, reorder, onCommit]);

  const startAutoScroll = useCallback(() => {
    const loop = () => {
      const y = lastY.current;
      const h = window.innerHeight;
      let dy = 0;
      if (y < EDGE_PX) dy = -EDGE_SPEED * (1 - y / EDGE_PX);
      else if (y > h - EDGE_PX) dy = EDGE_SPEED * (1 - (h - y) / EDGE_PX);

      if (dy !== 0) {
        window.scrollBy(0, dy);
        const p = pointer.current;
        if (p?.active) reorder(y, p.id);
      }
      rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
  }, [reorder]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, item: T) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Nút bấm bên trong card (Terminal, Claude, ⋯) không được kích hoạt kéo.
      if ((e.target as HTMLElement).closest("[data-no-drag]")) return;

      const el = cardRefs.current.get(item.id);
      if (!el) return;
      const r = el.getBoundingClientRect();

      pointer.current = {
        id: item.id,
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
        w: r.width,
        h: r.height,
        active: false,
      };
      lastY.current = e.clientY;

      holdTimer.current = window.setTimeout(() => {
        const p = pointer.current;
        if (!p) return;
        p.active = true;
        navigator.vibrate?.(25);
        document.body.style.userSelect = "none";
        setDragId(p.id);
        setGhost({ x: p.startX - p.offX, y: p.startY - p.offY, w: p.w, h: p.h });
        startAutoScroll();
      }, HOLD_MS);
    },
    [startAutoScroll]
  );

  const shouldSuppressClick = useCallback(() => suppressClick.current, []);

  return { dragId, ghost, registerCard, onPointerDown, shouldSuppressClick };
}
