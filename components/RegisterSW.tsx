"use client";

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    // Chỉ đăng ký ở production — service worker sẽ phá HMR khi dev.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
