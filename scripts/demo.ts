// Explicit development fixture: never add sample users or videos to a real library database.
import path from "node:path";
import { mkdir, writeFile, copyFile, link, rm } from "node:fs/promises";
if (!process.env.STREAMVAULT_DATA_DIR?.includes("demo"))
  throw new Error(
    "Set STREAMVAULT_DATA_DIR=./data/demo before creating demo fixtures.",
  );
const { one, run, now } = await import("../src/lib/db");
const { hashPassword, registerUser } = await import("../src/lib/auth");
const { addRoot, scanLibrary } = await import("../src/lib/indexer");
const folder = path.resolve(".demo-library");
await mkdir(folder, { recursive: true });
const titles = [
  "A small cabin, a slower kind of life",
  "Building a workspace that feels like home",
  "Following a forgotten railway into the forest",
  "The quiet side of modern technology",
  "Why good design feels effortless",
  "What a city sounds like after midnight",
  "A weekend along the coast",
  "An old camera, a new perspective",
  "Making something worth keeping",
  "The roads we take for no reason",
  "Inside a very small creative studio",
  "An ordinary morning in the mountains",
];
const channels = [
  "Northbound",
  "Made by Hand",
  "Field Notes",
  "The Design Room",
  "Elsewhere",
  "Small Hours",
];
for (let i = 0; i < channels.length; i++) {
  await writeFile(
    path.join(folder, `demo-channel-${i}.info.json`),
    JSON.stringify({
      _type: "playlist",
      channel_id: `demo-channel-${i}`,
      channel: channels[i],
      description: "A generated channel fixture for interface testing.",
    }),
  );
  // Reuse only generated fixture artwork when it is already available locally.
  try {
    await copyFile(
      path.join(folder, `demo-${i}.jpg`),
      path.join(folder, `demo-channel-${i}_banner.jpg`),
    );
  } catch {}
}
for (let i = 0; i < 72; i++) {
  const base = path.join(folder, `demo-${i}`);
  await writeFile(
    base + ".info.json",
    JSON.stringify({
      id: `demo-${i}`,
      channel_id: `demo-channel-${i % 6}`,
      channel: channels[i % 6],
      title: titles[i % 12] + (i >= 12 ? ` · ${Math.floor(i / 12) + 1}` : ""),
      description:
        "Synthetic demo library for interface and playback testing. These samples are generated locally; they are not real archived videos.",
      duration: 180,
      upload_date: `202609${String(30 - (i % 28)).padStart(2, "0")}`,
      tags: i % 2 ? ["design", "craft"] : ["nature", "travel"],
      chapters: [
        { start_time: 0, end_time: 60, title: "A beginning" },
        { start_time: 60, end_time: 120, title: "A different perspective" },
        { start_time: 120, end_time: 180, title: "The way home" },
      ],
      comments: [
        {
          id: `archive-${i}`,
          author: "Sample archive author",
          text: "An imported yt-dlp comment. Local discussion is stored separately.",
          timestamp: 1665100800,
          like_count: 4,
        },
      ],
    }),
  );
  if (process.env.STREAMVAULT_DEMO_VIDEO) {
    await rm(base + ".mp4", { force: true });
    try {
      await link(process.env.STREAMVAULT_DEMO_VIDEO, base + ".mp4");
    } catch {
      await copyFile(process.env.STREAMVAULT_DEMO_VIDEO, base + ".mp4");
    }
  }
  await writeFile(
    base + ".en.vtt",
    "WEBVTT\n\n00:00.000 --> 00:05.000\nThis is a generated Streamvault demo video.\n",
  );
}
let user = one<{ id: string }>(
  "SELECT id FROM users WHERE email='demo@example.invalid'",
)?.id;
if (!user)
  user = registerUser(
    "Demo viewer",
    "demo@example.invalid",
    await hashPassword("streamvault-demo-only"),
  );
const root = await addRoot(folder, "Generated demo archive");
await scanLibrary(root);
for (let i = 0; i < 4; i++)
  run(
    "INSERT OR REPLACE INTO watch_progress VALUES(?,?,?,0,?,?)",
    user,
    `youtube:demo-${i}`,
    35 + i * 10,
    now() + i,
    now() + i,
  );
run(
  "INSERT OR IGNORE INTO subscriptions VALUES(?,?,?)",
  user,
  "youtube:demo-channel-0",
  now(),
);
run(
  "UPDATE comments SET author_thumbnail='/media/thumbnail/' || replace(video_id, ':', '%3A') WHERE source='ytdlp' AND video_id LIKE 'youtube:demo-%'",
);
console.log(
  "Demo prepared. Local fixture login: demo@example.invalid / streamvault-demo-only. Use only on localhost.",
);
