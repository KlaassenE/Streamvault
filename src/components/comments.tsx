"use client";
import { useEffect, useState } from "react";
import type { Comment } from "@/lib/types";
import { relativeDate } from "@/lib/utils";
import { EngagementButton } from "./engagement";
import { Send, LoaderCircle } from "lucide-react";
import { Avatar } from "./avatar";
import { Button } from "./ui/button";
function CommentForm({
  videoId,
  parentId,
  onSaved,
}: {
  videoId: string;
  parentId?: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="comment-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !text.trim()) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/comments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId, parentId, text }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
          setText("");
          onSaved();
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "Could not post comment.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        aria-label={parentId ? "Write a reply" : "Add a comment"}
        placeholder={parentId ? "Write a reply…" : "Add a thought…"}
        maxLength={5000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        required
      />
      <Button
        type="submit"
        className="comment-submit"
        aria-label={parentId ? "Post reply" : "Post comment"}
        disabled={busy || !text.trim()}
      >
        {busy ? (
          <LoaderCircle size={16} className="comment-spinner" />
        ) : (
          <Send size={16} />
        )}
        {busy ? "Posting…" : parentId ? "Reply" : "Post comment"}
      </Button>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
function Item({
  comment,
  videoId,
  reply = false,
}: {
  comment: Comment;
  videoId: string;
  reply?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(false);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [error, setError] = useState("");
  async function load(offset = 0) {
    try {
      const response = await fetch(
        `/api/comments?video=${encodeURIComponent(videoId)}&parent=${encodeURIComponent(comment.id)}&offset=${offset}`,
      );
      if (!response.ok) throw new Error("Could not load replies.");
      const data = await response.json();
      setReplies((previous) =>
        offset ? [...previous, ...data.items] : data.items,
      );
      setNext(data.next);
      setShow(true);
    } catch {
      setError("Could not load replies.");
    }
  }
  return (
    <article className="comment-item">
      <Avatar name={comment.author} src={comment.author_thumbnail} />
      <div className="comment-content">
        <div className="comment-top">
          <strong>{comment.author}</strong>
          <span className="muted">
            {relativeDate(comment.created_at)}
            {comment.source === "ytdlp" ? " · Archived" : ""}
          </span>
        </div>
        <p>{comment.text}</p>
        <div className="comment-actions">
          <EngagementButton
            kind="commentLike"
            id={comment.id}
            initial={!!comment.liked}
            label={comment.likes ? String(comment.likes) : "Like"}
            icon="like"
          />
          {!reply && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setForm(!form)}>
                Reply
              </Button>
              {comment.replies > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => (show ? setShow(false) : void load())}
                >
                  {show ? "Hide replies" : `${comment.replies} replies`}
                </Button>
              )}
            </>
          )}
        </div>
        {form && (
          <CommentForm
            videoId={videoId}
            parentId={comment.id}
            onSaved={() => {
              setForm(false);
              void load();
            }}
          />
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {show && (
          <div className="comment-replies">
            {replies.map((c) => (
              <Item key={c.id} comment={c} videoId={videoId} reply />
            ))}
            {next !== null && (
              <Button size="sm" variant="ghost" onClick={() => void load(next)}>
                More replies
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
export default function Comments({ videoId }: { videoId: string }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [error, setError] = useState("");
  async function load(offset = 0, signal?: AbortSignal) {
    try {
      const response = await fetch(
        `/api/comments?video=${encodeURIComponent(videoId)}&offset=${offset}`,
        { signal },
      );
      if (!response.ok) throw new Error("Could not load comments.");
      const data = await response.json();
      setItems((previous) =>
        offset ? [...previous, ...data.items] : data.items,
      );
      setNext(data.next);
      setError("");
    } catch {
      if (!signal?.aborted) setError("Could not load comments.");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(0, controller.signal);
    return () => controller.abort();
  }, [videoId]);
  return (
    <section className="comments-section">
      <h2>Comments</h2>
      <CommentForm videoId={videoId} onSaved={() => void load()} />
      {items.map((comment) => (
        <Item key={comment.id} comment={comment} videoId={videoId} />
      ))}
      {!items.length && !error && (
        <p className="muted small">Start the conversation.</p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
          <Button variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      {next !== null && (
        <div className="feed-end">
          <Button variant="ghost" onClick={() => void load(next)}>
            More comments
          </Button>
        </div>
      )}
    </section>
  );
}
