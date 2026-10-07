// Create an app-owned browser-compatible copy. Never change the original library file.
import { spawn } from "node:child_process";
import { mkdir, stat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { one, run, dataDirectory } from "../src/lib/db";
const id = process.argv[2];
if (!id) throw new Error("Usage: pnpm compat <video-id> [--transcode]");
const source = one<{
  video_path: string;
  file_size: number;
  file_mtime: number;
}>("SELECT video_path,file_size,file_mtime FROM videos WHERE id=?", id);
if (!source?.video_path) throw new Error("Video file not found.");
const info = await stat(source.video_path);
const fingerprint = `${info.size}:${Math.floor(info.mtimeMs)}`;
const directory = path.join(dataDirectory, "media");
await mkdir(directory, { recursive: true });
const destination = path.join(
  directory,
  createHash("sha256")
    .update(id + fingerprint)
    .digest("hex") + ".mp4",
);
const temporary = destination + "." + randomUUID() + ".mp4";
const transcode = process.argv.includes("--transcode");
const codec = transcode
  ? [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
    ]
  : ["-c", "copy"];
try {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-i",
        source.video_path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        ...codec,
        "-movflags",
        "+faststart",
        temporary,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "FFmpeg could not prepare this file. Try --transcode for unsupported codecs.",
            ),
          ),
    );
  });
  await rename(temporary, destination);
  run(
    "INSERT OR REPLACE INTO media_assets(video_id,file_path,source_fingerprint) VALUES(?,?,?)",
    id,
    destination,
    fingerprint,
  );
  console.log(`Prepared compatibility copy for ${id}.`);
} finally {
  await rm(temporary, { force: true });
}
