"use client";
import { useState } from "react";
import type { Chapter } from "@/lib/types";
import { ChapterButtons } from "./player";
export function Description({
  text,
  chapters,
}: {
  text: string;
  chapters: Chapter[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="watch-description" data-expanded={expanded}>
      <p>{text}</p>
      {expanded && chapters.length > 0 && (
        <ChapterButtons chapters={chapters} />
      )}
      <button
        className="description-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </section>
  );
}
