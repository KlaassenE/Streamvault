"use client";
import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
export function Appearance() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = document.cookie
      .split("; ")
      .find((v) => v.startsWith("streamvault_appearance="))
      ?.split("=")[1];
    if (saved) {
      const value =
        saved === "system"
          ? matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : saved;
      document.documentElement.dataset.theme = value;
      try {
        localStorage.setItem("streamvault-theme", value);
      } catch {}
    }
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? "dark" : "light";
        try {
          localStorage.setItem("streamvault-theme", next ? "dark" : "light");
        } catch {}
        document.cookie = `streamvault_appearance=${next ? "dark" : "light"}; Path=/; Max-Age=15552000; SameSite=Lax`;
      }}
    >
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </Button>
  );
}
export function SessionRenewal() {
  useEffect(() => {
    const renew = () => {
      if (document.hidden) return;
      let last = 0;
      try {
        last = Number(localStorage.getItem("streamvault-renewed")) || 0;
      } catch {}
      if (Date.now() - last < 86400000) return;
      fetch("/api/session", { method: "POST" })
        .then((response) => {
          if (response.ok) {
            try {
              localStorage.setItem("streamvault-renewed", String(Date.now()));
            } catch {}
          }
        })
        .catch(() => {});
    };
    renew();
    document.addEventListener("visibilitychange", renew);
    const timer = setInterval(renew, 86400000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", renew);
    };
  }, []);
  return null;
}

export function SearchShortcut() {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      event.preventDefault();
      document.querySelector<HTMLInputElement>(".search-field input")?.focus();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  return null;
}
