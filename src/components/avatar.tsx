"use client";
import { useState } from "react";
export function Avatar({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      className="comment-avatar"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="comment-avatar" aria-hidden="true">
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
