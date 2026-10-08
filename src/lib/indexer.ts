import { ensureChannelSlug } from "./channels";
import { isShort } from "./shorts";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { all, one, run, transaction, now } from "./db";

type Metadata = Record<string, unknown>;
type Root = { id: string; path: string; label: string };
type Staged = {
  metadata: Metadata;
  basename: string;
  directory: string;
  media: string | null;
  thumbnail: string | null;
  size: number | null;
  mtime: number | null;
  subtitles: { language: string; path: string }[];
};
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const sourceKey = (value: string) => `youtube:${value}`;
const imageExtensions = [".webp", ".jpg", ".png", ".jpeg"];
// Prefer browsers' common containers; original files remain read-only.
const mediaExtensions = [".mp4", ".webm", ".m4v", ".mov", ".mkv", ".avi"];
export function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export async function addRoot(folder: string, label: string) {
  const resolved = await fs.realpath(folder);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory())
    throw new Error("Choose a folder on the hosting device.");
  const allowed = await Promise.all(
    (process.env.STREAMVAULT_ALLOWED_ROOTS || "")
      .split(";")
      .filter(Boolean)
      .map((root) => fs.realpath(path.resolve(root))),
  );
  if (allowed.length && !allowed.some((root) => inside(root, resolved)))
    throw new Error("This folder is outside the configured allowed roots.");
  const existing = one<Root>(
    "SELECT * FROM library_roots WHERE path=?",
    resolved,
  );
  if (existing) {
    run("UPDATE library_roots SET archived=0 WHERE id=?", existing.id);
    return existing.id;
  }
  const id = randomUUID();
  run(
    "INSERT INTO library_roots(id,path,label,created_at) VALUES(?,?,?,?)",
    id,
    resolved,
    label.trim() || path.basename(resolved),
    now(),
  );
  return id;
}
async function metadataAt(file: string) {
  const stat = await fs.stat(file);
  if (stat.size > 32 * 1024 * 1024)
    throw new Error(`Metadata is larger than 32 MiB: ${path.basename(file)}`);
  const result = JSON.parse(await fs.readFile(file, "utf8"));
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid metadata object");
  return result as Metadata;
}
async function safeAsset(root: string, file: string) {
  try {
    const actual = await fs.realpath(file);
    if (!inside(root, actual)) return null;
    const stat = await fs.stat(actual);
    return stat.isFile() ? { path: actual, stat } : null;
  } catch {
    return null;
  }
}
async function matching(root: string, base: string, extensions: string[]) {
  for (const extension of extensions) {
    const asset = await safeAsset(root, base + extension);
    if (asset) return asset;
  }
  return null;
}
export function recoverScanJobs() {
  for (const job of all<{
    id: string;
    root_id: string;
    started_at: number;
    worker_pid: number | null;
  }>(
    "SELECT id,root_id,started_at,worker_pid FROM scan_jobs WHERE status IN ('queued','running')",
  )) {
    let alive = false;
    if (job.worker_pid) {
      try {
        process.kill(job.worker_pid, 0);
        alive = true;
      } catch {}
    } else alive = now() - job.started_at < 60000;
    if (!alive)
      transaction(() => {
        run(
          "UPDATE scan_jobs SET status='failed',errors=?,finished_at=? WHERE id=?",
          JSON.stringify([
            "The scan worker stopped. Previous library records were kept; re-index to retry.",
          ]),
          now(),
          job.id,
        );
        run("UPDATE library_roots SET status='ready' WHERE id=?", job.root_id);
      });
  }
}
export function createScanJob(rootId: string) {
  recoverScanJobs();
  return transaction(() => {
    if (
      one(
        "SELECT id FROM scan_jobs WHERE root_id=? AND status IN ('queued','running')",
        rootId,
      )
    )
      throw new Error("This folder already has an active scan.");
    const id = randomUUID();
    run(
      "INSERT INTO scan_jobs(id,root_id,status,started_at) VALUES(?,?,'queued',?)",
      id,
      rootId,
      now(),
    );
    return id;
  });
}
export async function scanLibrary(rootId: string, jobId?: string) {
  const root = one<Root>(
    "SELECT * FROM library_roots WHERE id=? AND archived=0",
    rootId,
  );
  if (!root) throw new Error("Library folder not found.");
  const job = jobId || createScanJob(rootId);
  run(
    "UPDATE scan_jobs SET status='running',worker_pid=? WHERE id=?",
    process.pid,
    job,
  );
  run("UPDATE library_roots SET status='scanning' WHERE id=?", rootId);
  const staged: Staged[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  const channelFiles = new Map<
    string,
    { metadata: Metadata; base: string; avatar?: string; banner?: string }
  >();
  try {
    // An inaccessible root or any failed metadata parse aborts reconciliation: no mass deletion on offline drives.
    const rootPath = await fs.realpath(root.path);
    if (!(await fs.stat(rootPath)).isDirectory())
      throw new Error("Library drive is unavailable.");
    async function walk(directory: string, depth: number) {
      if (depth > 32) throw new Error("Folder nesting exceeds 32 levels.");
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(file, depth + 1);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".info.json")) continue;
        const metadata = await metadataAt(file);
        if (metadata._type === "playlist") {
          if (metadata.channel_id || metadata.uploader_id)
            channelFiles.set(file, { metadata, base: file.slice(0, -10) });
          continue;
        }
        const id = text(metadata.id);
        if (!id) continue;
        if (seen.has(id)) {
          warnings.push(`Duplicate source ID ${id}; kept the first copy.`);
          continue;
        }
        seen.add(id);
        const basename = file.slice(0, -10);
        const media = await matching(rootPath, basename, mediaExtensions);
        const thumbnail = await matching(rootPath, basename, imageExtensions);
        const subtitles: Staged["subtitles"] = [];
        for (const candidate of entries) {
          if (
            !candidate.isFile() ||
            !candidate.name.startsWith(path.basename(basename) + ".") ||
            !candidate.name.endsWith(".vtt")
          )
            continue;
          const language = candidate.name
            .slice(path.basename(basename).length + 1, -4)
            .toLowerCase();
          if (!language || language.endsWith("-orig")) continue;
          const asset = await safeAsset(
            rootPath,
            path.join(directory, candidate.name),
          );
          if (asset) subtitles.push({ language, path: asset.path });
        }
        staged.push({
          metadata,
          basename,
          directory,
          media: media?.path || null,
          thumbnail: thumbnail?.path || null,
          size: media?.stat.size || null,
          mtime: media?.stat.mtimeMs || null,
          subtitles,
        });
        if (staged.length % 25 === 0)
          run(
            "UPDATE scan_jobs SET discovered=? WHERE id=?",
            staged.length,
            job,
          );
      }
    }
    await walk(rootPath, 0);
    if (!staged.length)
      throw new Error(
        "No yt-dlp video metadata found. Previous library records were kept.",
      );
    for (const entry of channelFiles.values()) {
      entry.avatar = (await matching(rootPath, entry.base, imageExtensions))
        ?.path;
      entry.banner =
        (await matching(rootPath, entry.base + "_banner", imageExtensions))
          ?.path ||
        (await matching(rootPath, entry.base + ".banner", imageExtensions))
          ?.path ||
        (
          await matching(
            rootPath,
            path.join(path.dirname(entry.base), "banner"),
            imageExtensions,
          )
        )?.path;
    }
    function context(directory: string, channelId?: string) {
      const exact = [...channelFiles.values()].find(
        (entry) =>
          channelId &&
          (entry.metadata.channel_id === channelId ||
            entry.metadata.uploader_id === channelId),
      );
      if (exact) return exact;
      let current = directory;
      while (inside(rootPath, current)) {
        const result = [...channelFiles.values()].find(
          (entry) =>
            path.dirname(entry.base) === current &&
            (!channelId ||
              entry.metadata.channel_id === channelId ||
              entry.metadata.uploader_id === channelId),
        );
        if (result) return result;
        if (current === rootPath) break;
        current = path.dirname(current);
      }
      return undefined;
    }
    const timestamp = now();
    transaction(() => {
      for (const item of staged) {
        const m = item.metadata;
        const contextEntry = context(
          item.directory,
          text(m.channel_id, text(m.uploader_id)),
        );
        const channelMetadata = contextEntry?.metadata;
        const fallbackSource = text(
          channelMetadata?.channel_id,
          text(
            channelMetadata?.uploader_id,
            `folder-${createHash("sha256")
              .update(root.id + item.directory)
              .digest("hex")
              .slice(0, 16)}`,
          ),
        );
        const fallbackName = text(
          channelMetadata?.channel,
          text(channelMetadata?.uploader, root.label),
        );
        const sameChannel =
          !m.channel_id || m.channel_id === channelMetadata?.channel_id;
        const avatar = sameChannel ? contextEntry?.avatar : undefined;
        const banner = sameChannel ? contextEntry?.banner : undefined;
        const source = text(m.id);
        const id = sourceKey(source);
        const channelSource = text(
          m.channel_id,
          text(m.uploader_id, fallbackSource),
        );
        const channelId = sourceKey(channelSource);
        const channelName = text(m.channel, text(m.uploader, fallbackName));
        run(
          "INSERT INTO channels(id,source_id,name,description,avatar_path,banner_path,avatar_url,banner_url,imported_followers) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=CASE WHEN excluded.description='' THEN channels.description ELSE excluded.description END,avatar_path=COALESCE(excluded.avatar_path,channels.avatar_path),banner_path=COALESCE(excluded.banner_path,channels.banner_path),avatar_url=COALESCE(excluded.avatar_url,channels.avatar_url),banner_url=COALESCE(excluded.banner_url,channels.banner_url),imported_followers=excluded.imported_followers",
          channelId,
          channelSource,
          channelName,
          text(channelMetadata?.description),
          avatar || null,
          banner || null,
          artwork(channelMetadata, false),
          artwork(channelMetadata, true),
          number(m.channel_follower_count) ||
            number(channelMetadata?.channel_follower_count),
        );
        ensureChannelSlug(channelId, channelName);
        const previousChannel = one<{ channel_id: string }>(
          "SELECT channel_id FROM videos WHERE id=?",
          id,
        )?.channel_id;
        if (previousChannel && previousChannel !== channelId) {
          run(
            "INSERT OR IGNORE INTO subscriptions SELECT user_id,?,created_at FROM subscriptions WHERE channel_id=?",
            channelId,
            previousChannel,
          );
          run(
            "INSERT OR IGNORE INTO feedback SELECT user_id,?,'channel',created_at FROM feedback WHERE kind='channel' AND target_id=?",
            channelId,
            previousChannel,
          );
        }
        let published = number(m.timestamp) * 1000 || null;
        const date = text(m.upload_date);
        if (!published && /^\d{8}$/.test(date))
          published = Date.UTC(
            +date.slice(0, 4),
            +date.slice(4, 6) - 1,
            +date.slice(6, 8),
          );
        run(
          `INSERT INTO videos(id,source_id,channel_id,root_id,title,description,duration,published_at,added_at,indexed_at,video_path,thumbnail_path,available,imported_views,imported_likes,file_size,file_mtime,live_status,availability) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id,root_id=excluded.root_id,title=excluded.title,description=excluded.description,duration=excluded.duration,published_at=excluded.published_at,indexed_at=excluded.indexed_at,video_path=excluded.video_path,thumbnail_path=excluded.thumbnail_path,available=excluded.available,archived=0,imported_views=excluded.imported_views,imported_likes=excluded.imported_likes,file_size=excluded.file_size,file_mtime=excluded.file_mtime,live_status=excluded.live_status,availability=excluded.availability`,
          id,
          source,
          channelId,
          rootId,
          text(m.title, source),
          text(m.description),
          number(m.duration),
          published,
          timestamp,
          timestamp,
          item.media,
          item.thumbnail,
          item.media ? 1 : 0,
          number(m.view_count),
          number(m.like_count),
          item.size,
          item.mtime,
          text(m.live_status),
          text(m.availability),
        );
        run(
          "UPDATE videos SET is_short=? WHERE id=?",
          isShort(m, item.media || item.basename) ? 1 : 0,
          id,
        );
        const fps = number(m.fps);
        run(
          "UPDATE videos SET fps=? WHERE id=?",
          fps > 0 && fps <= 240 ? fps : null,
          id,
        );
        run("DELETE FROM video_labels WHERE video_id=?", id);
        for (const kind of ["tags", "categories"]) {
          const labels = m[kind];
          if (Array.isArray(labels))
            for (const label of new Set(
              labels.filter((x) => typeof x === "string"),
            ))
              run(
                "INSERT OR IGNORE INTO video_labels VALUES(?,?,?)",
                id,
                kind,
                String(label).slice(0, 200),
              );
        }
        run("DELETE FROM chapters WHERE video_id=?", id);
        if (Array.isArray(m.chapters))
          for (const raw of m.chapters) {
            const c = raw as Metadata;
            run(
              "INSERT OR REPLACE INTO chapters VALUES(?,?,?,?)",
              id,
              number(c.start_time),
              number(c.end_time),
              text(c.title, "Chapter"),
            );
          }
        run("DELETE FROM subtitles WHERE video_id=?", id);
        for (const subtitle of item.subtitles)
          run(
            "INSERT OR REPLACE INTO subtitles VALUES(?,?,?)",
            id,
            subtitle.language,
            subtitle.path,
          );
        // Archive comments have their own namespace. Never replace or delete local comments or their reactions.
        if (Array.isArray(m.comments)) {
          const imported = m.comments.filter(
            (x) => x && typeof x === "object",
          ) as Metadata[];
          const importedIds = new Set(
            imported.map((c) => text(c.id)).filter(Boolean),
          );
          for (const c of imported) {
            const commentSource = text(c.id);
            if (!commentSource) continue;
            const cid = `archive:${source}:${commentSource}`;
            run(
              "INSERT INTO comments(id,video_id,source,source_id,author,text,imported_likes,created_at,author_thumbnail) VALUES(?,?,'ytdlp',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET author=excluded.author,text=excluded.text,imported_likes=excluded.imported_likes,author_thumbnail=COALESCE(excluded.author_thumbnail,comments.author_thumbnail)",
              cid,
              id,
              commentSource,
              text(c.author, "Archived author"),
              text(c.text),
              number(c.like_count),
              number(c.timestamp) * 1000 || timestamp,
              safeImage(c.author_thumbnail),
            );
          }
          for (const c of imported) {
            const sourceId = text(c.id);
            if (!sourceId) continue;
            const parent = text(c.parent);
            run(
              "UPDATE comments SET parent_id=? WHERE id=?",
              parent &&
                parent !== "root" &&
                parent !== sourceId &&
                importedIds.has(parent)
                ? `archive:${source}:${parent}`
                : null,
              `archive:${source}:${sourceId}`,
            );
          }
        }
        run("DELETE FROM video_search WHERE video_id=?", id);
        run(
          "INSERT INTO video_search VALUES(?,?,?,?)",
          id,
          text(m.title, source),
          text(m.description),
          channelName,
        );
      }
      // Missing metadata/media marks availability only. IDs and every user-owned relation remain intact.
      const previous = all<{ id: string; source_id: string }>(
        "SELECT id,source_id FROM videos WHERE root_id=?",
        rootId,
      );
      for (const video of previous)
        if (!seen.has(video.source_id))
          run("UPDATE videos SET available=0 WHERE id=?", video.id);
      run(
        "UPDATE library_roots SET status='ready',last_scanned_at=? WHERE id=?",
        timestamp,
        rootId,
      );
      run(
        "INSERT INTO settings VALUES('index_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
      );
      run(
        "UPDATE scan_jobs SET status='complete',discovered=?,imported=?,errors=?,finished_at=? WHERE id=?",
        staged.length,
        staged.length,
        JSON.stringify(warnings.slice(0, 100)),
        timestamp,
        job,
      );
    });
    return { jobId: job, imported: staged.length, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    run(
      "UPDATE scan_jobs SET status='failed',discovered=?,errors=?,finished_at=? WHERE id=?",
      staged.length,
      JSON.stringify([message]),
      now(),
      job,
    );
    run("UPDATE library_roots SET status='unavailable' WHERE id=?", rootId);
    throw error;
  }
}

function safeImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function artwork(
  metadata: Metadata | undefined,
  banner: boolean,
): string | null {
  if (!metadata) return null;
  const entries = [
    ...(Array.isArray(metadata.thumbnails) ? metadata.thumbnails : []),
    ...(banner && Array.isArray(metadata.banners) ? metadata.banners : []),
  ] as Metadata[];
  const candidates = entries.filter((item) =>
    banner
      ? /banner/i.test(text(item.id)) ||
        (number(item.width) > number(item.height) * 2.3 &&
          number(item.height) > 0)
      : /avatar/i.test(text(item.id)) ||
        (number(item.width) > 0 && number(item.width) === number(item.height)),
  );
  candidates.sort((a, b) => number(b.width) - number(a.width));
  return (
    safeImage(metadata[banner ? "banner_url" : "avatar_url"]) ||
    (banner && Array.isArray(metadata.banners)
      ? (metadata.banners as Metadata[])
          .map((item) => safeImage(item.url))
          .find(Boolean)
      : null) ||
    candidates.map((item) => safeImage(item.url)).find(Boolean) ||
    null
  );
}
