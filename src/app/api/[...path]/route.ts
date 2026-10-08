import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { currentUser, renewSession, sameOrigin } from "@/lib/auth";
import { all, one, run, transaction, now } from "@/lib/db";
import {
  feed,
  collection,
  searchVideos,
  comments,
  saveProgress,
  invalidateFeed,
} from "@/lib/library";
import { addRoot, recoverScanJobs } from "@/lib/indexer";
import {
  browseFolders,
  pickNativeFolder,
  isLocalFolderPicker,
} from "@/lib/folder-picker";
import { launchScan } from "@/lib/scans";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to continue." }, 401);
  const route = (await params).path.join("/");
  const url = new URL(request.url);
  const offset = Math.max(
    0,
    Math.floor(Math.min(100000, Number(url.searchParams.get("offset")) || 0)),
  );
  try {
    if (route === "feed") {
      const seed = (url.searchParams.get("seed") || "today").slice(0, 100);
      return json(
        feed(
          user.id,
          seed,
          url.searchParams.get("filter") || "For you",
          offset,
          url.searchParams.get("current") || undefined,
        ),
      );
    }
    if (route === "collection") {
      const items = collection(
        user.id,
        url.searchParams.get("kind") || "library",
        offset,
        url.searchParams.get("channel") || undefined,
        url.searchParams.get("format") || "videos",
      );
      return json({ items, next: items.length === 24 ? offset + 24 : null });
    }
    if (route === "search") {
      const items = searchVideos(
        user.id,
        (url.searchParams.get("q") || "").slice(0, 200),
        offset,
      );
      return json({ items, next: items.length === 24 ? offset + 24 : null });
    }
    if (route === "comments") {
      const items = comments(
        user.id,
        url.searchParams.get("video") || "",
        url.searchParams.get("parent"),
        offset,
      );
      return json({ items, next: items.length === 20 ? offset + 20 : null });
    }
    if (route === "library/folders" && user.is_admin)
      return json(
        await browseFolders(url.searchParams.get("path") || undefined),
      );
    if (route === "library" && user.is_admin) {
      recoverScanJobs();
      return json({
        roots: all("SELECT * FROM library_roots ORDER BY created_at DESC"),
        jobs: all("SELECT * FROM scan_jobs ORDER BY started_at DESC LIMIT 20"),
      });
    }
    return json({ error: "Not found" }, 404);
  } catch {
    return json({ error: "This request could not be completed." }, 400);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Your session ended. Sign in again." }, 401);
  const route = (await params).path.join("/");
  try {
    if (route === "session") {
      await renewSession();
      return json({ ok: true });
    }
    const raw = await request.text();
    if (raw.length > 65536) throw new Error("Request is too large");
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object") throw new Error("Invalid request");
    if (route === "progress") {
      if (
        typeof body.videoId !== "string" ||
        !Number.isFinite(body.seconds) ||
        !Number.isFinite(body.clientAt) ||
        body.clientAt < 0 ||
        typeof body.sessionId !== "string" ||
        body.sessionId.length > 100 ||
        !Number.isFinite(body.watchedSeconds)
      )
        throw new Error("Invalid progress");
      saveProgress(user.id, { ...body, completed: body.completed === true });
      return json({ ok: true });
    }
    if (route === "impressions") {
      if (!Array.isArray(body.ids) || body.ids.length > 24)
        throw new Error("Invalid impressions");
      transaction(() => {
        for (const id of new Set(body.ids)) {
          if (
            typeof id === "string" &&
            one("SELECT id FROM videos WHERE id=?", id)
          )
            run(
              "INSERT INTO impressions VALUES(?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET seen_at=excluded.seen_at",
              user.id,
              id,
              now(),
            );
        }
      });
      return json({ ok: true });
    }
    if (route === "feedback") {
      if (
        !["video", "channel"].includes(body.kind) ||
        typeof body.id !== "string"
      )
        throw new Error("Invalid feedback");
      run(
        "INSERT OR REPLACE INTO feedback VALUES(?,?,?,?)",
        user.id,
        body.id,
        body.kind,
        now(),
      );
      invalidateFeed();
      return json({ ok: true });
    }
    if (route === "engagement") {
      const options: Record<
        string,
        { table: string; column: string; target: string }
      > = {
        like: { table: "video_likes", column: "video_id", target: "videos" },
        save: { table: "watch_later", column: "video_id", target: "videos" },
        subscribe: {
          table: "subscriptions",
          column: "channel_id",
          target: "channels",
        },
        commentLike: {
          table: "comment_likes",
          column: "comment_id",
          target: "comments",
        },
      };
      const option = options[body.kind];
      if (
        !option ||
        typeof body.id !== "string" ||
        !one(`SELECT id FROM ${option.target} WHERE id=?`, body.id)
      )
        throw new Error("Item not found");
      transaction(() => {
        if (body.active === true)
          run(
            `INSERT OR IGNORE INTO ${option.table}(${option.column},user_id${body.kind === "commentLike" ? "" : ",created_at"}) VALUES(?,?${body.kind === "commentLike" ? "" : ",?"})`,
            body.id,
            user.id,
            ...(body.kind === "commentLike" ? [] : [now()]),
          );
        else
          run(
            `DELETE FROM ${option.table} WHERE ${option.column}=? AND user_id=?`,
            body.id,
            user.id,
          );
      });
      invalidateFeed();
      return json({ ok: true });
    }
    if (route === "comments") {
      if (
        typeof body.videoId !== "string" ||
        typeof body.text !== "string" ||
        body.text.trim().length < 1 ||
        body.text.length > 5000 ||
        !one("SELECT id FROM videos WHERE id=?", body.videoId)
      )
        throw new Error("Write a comment between 1 and 5,000 characters.");
      if (body.parentId) {
        const parent = one<{ video_id: string; parent_id: string | null }>(
          "SELECT video_id,parent_id FROM comments WHERE id=?",
          body.parentId,
        );
        if (!parent || parent.video_id !== body.videoId || parent.parent_id)
          throw new Error("Reply to a top-level comment on this video.");
      }
      const id = randomUUID();
      run(
        "INSERT INTO comments(id,video_id,parent_id,user_id,source,author,text,created_at) VALUES(?,?,?,?,'local',?,?,?)",
        id,
        body.videoId,
        body.parentId || null,
        user.id,
        user.username,
        body.text.trim(),
        now(),
      );
      return json({ id });
    }
    if (route === "progress/reset") {
      if (typeof body.videoId !== "string") throw new Error("Video required");
      run(
        "UPDATE watch_progress SET seconds=0,completed=0,client_at=?,updated_at=? WHERE user_id=? AND video_id=?",
        now(),
        now(),
        user.id,
        body.videoId,
      );
      invalidateFeed();
      return json({ ok: true });
    }
    if (route === "progress/complete") {
      if (typeof body.videoId !== "string") throw new Error("Video required");
      const video = one<{ duration: number }>(
        "SELECT duration FROM videos WHERE id=?",
        body.videoId,
      );
      if (!video) throw new Error("Video not found");
      run(
        "INSERT INTO watch_progress VALUES(?,?,?,1,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET completed=1,seconds=excluded.seconds,updated_at=excluded.updated_at,client_at=excluded.client_at",
        user.id,
        body.videoId,
        video.duration,
        now(),
        now(),
      );
      invalidateFeed();
      return json({ ok: true });
    }
    if (route === "library/pick" && user.is_admin)
      return json(
        isLocalFolderPicker(request)
          ? await pickNativeFolder()
          : { supported: false },
      );
    if (route === "library" && user.is_admin) {
      if (typeof body.path !== "string" || !body.path.trim())
        throw new Error("Enter an absolute folder path on the hosting device.");
      const rootId = await addRoot(
        body.path,
        typeof body.label === "string" ? body.label : "",
      );
      return json({ rootId, jobId: launchScan(rootId) });
    }
    if (route === "library/scan" && user.is_admin) {
      if (
        !one(
          "SELECT id FROM library_roots WHERE id=? AND archived=0",
          body.rootId,
        )
      )
        throw new Error("Folder not found");
      return json({ jobId: launchScan(body.rootId) });
    }
    if (route === "library/archive" && user.is_admin) {
      transaction(() => {
        if (
          one(
            "SELECT id FROM scan_jobs WHERE root_id=? AND status IN ('queued','running')",
            body.rootId,
          )
        )
          throw new Error(
            "Wait for this folder’s scan to finish before archiving it.",
          );
        run("UPDATE library_roots SET archived=1 WHERE id=?", body.rootId);
        run("UPDATE videos SET archived=1 WHERE root_id=?", body.rootId);
      });
      invalidateFeed();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "This action failed." },
      400,
    );
  }
}
