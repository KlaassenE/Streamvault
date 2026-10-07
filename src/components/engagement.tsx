"use client";
import { useState, useRef, useEffect } from "react";
import { ThumbsUp, Bookmark, Link2, Bell, BellRing, Check } from "lucide-react";
import { Button } from "./ui/button";
export function EngagementButton({
  kind,
  id,
  initial,
  label,
  activeLabel,
  icon,
  iconOnly = false,
}: {
  kind: string;
  id: string;
  initial: boolean;
  label: string;
  activeLabel?: string;
  icon?: "like" | "save";
  iconOnly?: boolean;
}) {
  const [active, setActive] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span>
      <Button
        variant={active ? "default" : "outline"}
        disabled={busy}
        className={iconOnly ? "round-action" : undefined}
        aria-label={active && activeLabel ? activeLabel : label}
        title={active && activeLabel ? activeLabel : label}
        aria-pressed={active}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/engagement", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind, id, active: !active }),
            });
            if (!response.ok) throw new Error((await response.json()).error);
            setActive(!active);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "Could not save.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {icon === "like" ? (
          <ThumbsUp size={15} />
        ) : icon === "save" ? (
          <Bookmark size={15} />
        ) : kind === "subscribe" ? (
          active ? (
            <BellRing size={18} />
          ) : (
            <Bell size={18} />
          )
        ) : null}
        {!iconOnly && (active && activeLabel ? activeLabel : label)}
      </Button>
      {error && (
        <span className="error-message" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
export function ShareButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  return (
    <Button
      variant="outline"
      className={`share-button ${iconOnly ? "round-action" : ""}`}
      data-copied={copied}
      aria-label={copied ? "Link copied" : "Share"}
      title={copied ? "Link copied" : "Share"}
      onClick={async () => {
        const url = new URL(location.href);
        const video = document.querySelector("video");
        if (video?.currentTime)
          url.searchParams.set("t", String(Math.floor(video.currentTime)));
        try {
          await navigator.clipboard.writeText(url.href);
          setCopied(true);
          if (resetTimer.current) clearTimeout(resetTimer.current);
          resetTimer.current = setTimeout(() => setCopied(false), 2500);
        } catch {
          prompt("Copy this video link", url.href);
        }
      }}
    >
      <span className="share-icon" aria-hidden="true">
        <Link2 size={18} className="share-link" />
        <Check size={18} className="share-check" />
      </span>
      {!iconOnly && (copied ? "Copied" : "Share")}
    </Button>
  );
}
