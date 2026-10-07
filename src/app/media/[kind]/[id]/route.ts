import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { currentUser } from "@/lib/auth";
import { all, one, dataDirectory } from "@/lib/db";
import { inside } from "@/lib/indexer";
import { parseRange } from "@/lib/range";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const types: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".vtt": "text/vtt; charset=utf-8",
};
async function serve(
  request: Request,
  params: { kind: string; id: string },
  head = false,
) {
  if (!(await currentUser()))
    return new Response("Sign in required", { status: 401 });
  const { kind, id } = params;
  const language = new URL(request.url).searchParams.get("language");
  let file: string | undefined;
  let rootPath: string | undefined;
  if (["video", "thumbnail"].includes(kind)) {
    const row = one<{
      video_path: string;
      thumbnail_path: string;
      path: string;
    }>(
      "SELECT v.video_path,v.thumbnail_path,r.path FROM videos v JOIN library_roots r ON r.id=v.root_id WHERE v.id=? AND v.archived=0 AND r.archived=0",
      id,
    );
    file = kind === "video" ? row?.video_path : row?.thumbnail_path;
    rootPath = row?.path;
  }
  if (kind === "subtitle") {
    const row = one<{ file_path: string; path: string }>(
      "SELECT s.file_path,r.path FROM subtitles s JOIN videos v ON v.id=s.video_id JOIN library_roots r ON r.id=v.root_id WHERE s.video_id=? AND s.language=? AND v.archived=0 AND r.archived=0",
      id,
      language || "",
    );
    file = row?.file_path;
    rootPath = row?.path;
  }
  if (["avatar", "banner"].includes(kind)) {
    const row = one<{ avatar_path: string; banner_path: string }>(
      "SELECT avatar_path,banner_path FROM channels WHERE id=?",
      id,
    );
    file = kind === "avatar" ? row?.avatar_path : row?.banner_path;
    const roots = all<{ path: string }>(
      "SELECT DISTINCT r.path FROM videos v JOIN library_roots r ON r.id=v.root_id WHERE v.channel_id=? AND r.archived=0",
      id,
    );
    rootPath = roots.find(
      (root) => file && inside(path.resolve(root.path), path.resolve(file)),
    )?.path;
  }
  if (!file || !rootPath)
    return new Response("File unavailable", { status: 404 });
  try {
    if (kind === "video") {
      const asset = one<{ file_path: string; source_fingerprint: string }>(
        "SELECT file_path,source_fingerprint FROM media_assets WHERE video_id=?",
        id,
      );
      if (asset) {
        const source = await fs.stat(file);
        if (
          asset.source_fingerprint ===
          `${source.size}:${Math.floor(source.mtimeMs)}`
        )
          file = asset.file_path;
      }
    }
    const real = await fs.realpath(file);
    const root = await fs.realpath(rootPath);
    if (!inside(root, real) && !inside(path.join(dataDirectory, "media"), real))
      return new Response("File unavailable", { status: 404 });
    const stat = await fs.stat(real);
    if (!stat.isFile())
      return new Response("File unavailable", { status: 404 });
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type":
        types[path.extname(real).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    });
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const ifRange = request.headers.get("if-range");
    const range = parseRange(
      !ifRange || ifRange === etag || ifRange === stat.mtime.toUTCString()
        ? request.headers.get("range")
        : null,
      stat.size,
    );
    if (range === "invalid") {
      headers.set("Content-Range", `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (process.env.STREAMVAULT_ACCEL_PREFIX) {
      headers.set(
        "X-Accel-Redirect",
        process.env.STREAMVAULT_ACCEL_PREFIX.replace(/\/$/, "") +
          real.split(path.sep).map(encodeURIComponent).join("/"),
      );
      return new Response(null, { headers });
    }
    const start = range?.start || 0;
    const end = range?.end ?? stat.size - 1;
    headers.set("Content-Length", String(Math.max(0, end - start + 1)));
    if (range)
      headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    if (head || stat.size === 0)
      return new Response(null, { status: range ? 206 : 200, headers });
    const stream = createReadStream(real, {
      start,
      end,
      highWaterMark: 128 * 1024,
    });
    request.signal.addEventListener("abort", () => stream.destroy(), {
      once: true,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch {
    return new Response("File unavailable", { status: 404 });
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  return serve(request, await params);
}
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  return serve(request, await params, true);
}
