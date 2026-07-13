"use client";

import { useEffect, useState } from "react";

export function getTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the class set by the pre-hydration theme script
    setTheme(getTheme());
  }, []);

  const toggle = () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("remote-ssh.theme", next);
    } catch {}
    setTheme(next);
    window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  };

  return (
    <button
      onClick={toggle}
      aria-label="Đổi giao diện sáng/tối"
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-lg active:scale-95 transition-transform"
    >
      {theme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
