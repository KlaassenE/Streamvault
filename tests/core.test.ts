import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const temporary = await mkdtemp(path.join(tmpdir(), "streamvault-tests-"));
process.env.STREAMVAULT_DATA_DIR = path.join(temporary, "data");
const { one, run, database, now } = await import("../src/lib/db");
const { addRoot, scanLibrary, inside, recoverScanJobs } =
  await import("../src/lib/indexer");
const {
  registerUser,
  hashPassword,
  checkPassword,
  createDeviceSession,
  SESSION_MS,
} = await import("../src/lib/auth");
const {
  saveProgress,
  videoById,
  feed,
  searchVideos,
  comments,
  invalidateFeed,
} = await import("../src/lib/library");
const { parseRange } = await import("../src/lib/range");
const folder = path.join(temporary, "archive");
await mkdir(folder);
const metadata = {
  id: "v1",
  channel_id: "c1",
  channel: "First channel",
  title: "Cabin in the forest",
  duration: 180,
  tags: ["forest", "travel"],
  comments: [
    { id: "cmt1", text: "Archive comment", like_count: 12 },
    { id: "reply", parent: "cmt1", text: "Archive reply" },
  ],
  chapters: [{ start_time: 0, end_time: 180, title: "The walk" }],
};
async function item(base: string, data: object) {
  await writeFile(path.join(folder, base + ".info.json"), JSON.stringify(data));
  await writeFile(path.join(folder, base + ".mp4"), "0123456789");
}
let root: string;
let user: string;
after(async () => {
  database().close();
  await rm(temporary, { recursive: true, force: true });
});
test("byte ranges support seeks/suffixes and reject malformed or multipart requests", () => {
  assert.deepEqual(parseRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange("bytes=3-", 10), { start: 3, end: 9 });
  assert.deepEqual(parseRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.deepEqual(parseRange("bytes=0-99", 10), { start: 0, end: 9 });
  for (const bad of ["bytes=10-", "bytes=5-2", "bytes=0-1,3-4", "bytes=-0"])
    assert.equal(parseRange(bad, 10), "invalid");
  assert.equal(parseRange("bytes=0-", 0), "invalid");
  assert.equal(inside("/media", "/media-extra/a"), false);
});
test("first owner, password hashing and 180-day opaque device sessions", async () => {
  const hashed = await hashPassword("test-password-only");
  assert.equal(await checkPassword("test-password-only", hashed), true);
  assert.equal(await checkPassword("wrong", hashed), false);
  user = registerUser("Test owner", "test@example.invalid", hashed);
  assert.equal(
    one<{ is_admin: number }>("SELECT is_admin FROM users WHERE id=?", user)
      ?.is_admin,
    1,
  );
  assert.throws(
    () => registerUser("Other", "other@example.invalid", hashed),
    /Registration is closed/,
  );
  const session = createDeviceSession(user);
  assert.ok(session.expires - now() > SESSION_MS - 1000);
  const stored = one<{ token_hash: string }>(
    "SELECT token_hash FROM device_sessions WHERE user_id=?",
    user,
  )!;
  assert.notEqual(stored.token_hash, session.token);
  assert.equal(stored.token_hash.length, 64);
  assert.ok(
    createDeviceSession(user, "Shared", true).expires - now() <= 86400000,
  );
});
test("re-indexing changed yt-dlp metadata/filenames preserves local comments, reactions, watch state and subscriptions", async () => {
  await item("first", metadata);
  await item("second", {
    id: "v2",
    channel_id: "c2",
    channel: "Second channel",
    title: "Other topic",
    duration: 300,
  });
  await writeFile(
    path.join(folder, "first.en.vtt"),
    "WEBVTT\n\n00:00.000 --> 00:05.000\nHello",
  );
  root = await addRoot(folder, "Test archive");
  assert.equal((await scanLibrary(root)).imported, 2);
  const v = "youtube:v1";
  assert.equal(comments(user, v)[0].replies, 1);
  assert.equal(
    one<{ language: string }>(
      "SELECT language FROM subtitles WHERE video_id=?",
      v,
    )?.language,
    "en",
  );
  run(
    "INSERT INTO comments(id,video_id,user_id,source,author,text,created_at) VALUES('local',?,?,'local','Owner','Keep this',?)",
    v,
    user,
    now(),
  );
  run(
    "INSERT INTO comments(id,video_id,parent_id,user_id,source,author,text,created_at) VALUES('localreply',?,'local',?,'local','Owner','Keep reply',?)",
    v,
    user,
    now(),
  );
  run("INSERT INTO comment_likes VALUES(?,?)", user, "archive:v1:cmt1");
  for (const table of ["video_likes", "watch_later"])
    run(`INSERT INTO ${table} VALUES(?,?,?)`, user, v, now());
  run("INSERT INTO subscriptions VALUES(?,?,?)", user, "youtube:c1", now());
  saveProgress(user, {
    videoId: v,
    seconds: 70,
    completed: false,
    clientAt: now(),
    sessionId: "one",
    watchedSeconds: 55,
  });
  await rename(
    path.join(folder, "first.mp4"),
    path.join(folder, "renamed.mp4"),
  );
  await rename(
    path.join(folder, "first.en.vtt"),
    path.join(folder, "renamed.en.vtt"),
  );
  await rm(path.join(folder, "first.info.json"));
  await writeFile(
    path.join(folder, "renamed.info.json"),
    JSON.stringify({
      ...metadata,
      title: "Updated title",
      comments: [{ id: "cmt1", text: "Updated archive", like_count: 22 }],
    }),
  );
  await scanLibrary(root);
  const updated = videoById(v, user)!;
  assert.equal(updated.title, "Updated title");
  for (const key of ["liked", "saved", "subscribed", "local_likes"] as const)
    assert.equal(updated[key], 1);
  assert.equal(updated.seconds, 70);
  assert.equal(
    one<{ text: string }>("SELECT text FROM comments WHERE id='local'")?.text,
    "Keep this",
  );
  assert.equal(
    one<{ parent_id: string }>(
      "SELECT parent_id FROM comments WHERE id='localreply'",
    )?.parent_id,
    "local",
  );
  assert.equal(
    one<{ n: number }>("SELECT COUNT(*) AS n FROM comment_likes")?.n,
    1,
  );
  assert.ok(
    one<{ video_path: string }>(
      "SELECT video_path FROM videos WHERE id=?",
      v,
    )?.video_path.endsWith("renamed.mp4"),
  );
  assert.equal(searchVideos(user, "Updated")[0].id, v);
});
test("stale checkpoints cannot overwrite newer progress; watch-duration retries are idempotent", () => {
  const videoId = "youtube:v1",
    time = now();
  const checkpoint = {
    videoId,
    completed: false,
    clientAt: time,
    sessionId: "two",
    watchedSeconds: 15,
  };
  saveProgress(user, { ...checkpoint, seconds: 95 });
  saveProgress(user, { ...checkpoint, clientAt: time - 10000, seconds: 30 });
  assert.equal(videoById(videoId, user)?.seconds, 95);
  saveProgress(user, {
    ...checkpoint,
    seconds: 96,
    clientAt: time + 1,
    watchedSeconds: 18,
  });
  assert.equal(
    one<{ watched_seconds: number }>(
      "SELECT watched_seconds FROM watch_sessions WHERE id=?",
      user + ":two",
    )?.watched_seconds,
    18,
  );
});
test("failed/offline scans keep records; missing files preserve local state", async () => {
  await writeFile(path.join(folder, "broken.info.json"), "{broken");
  await assert.rejects(scanLibrary(root));
  assert.equal(videoById("youtube:v1", user)?.available, 1);
  await rm(path.join(folder, "broken.info.json"));
  await rm(path.join(folder, "renamed.info.json"));
  await scanLibrary(root);
  assert.equal(videoById("youtube:v1", user)?.available, 0);
  assert.equal(videoById("youtube:v1", user)?.liked, 1);
  await rename(folder, folder + "-offline");
  await assert.rejects(scanLibrary(root));
  assert.equal(videoById("youtube:v2", user)?.available, 1);
  await rename(folder + "-offline", folder);
});
test("recommendations stay stable, diverse, respect feedback and scroll through the full library", () => {
  for (let i = 0; i < 810; i++) {
    run(
      "INSERT OR IGNORE INTO channels(id,source_id,name) VALUES(?,?,?)",
      `channel${i % 12}`,
      `channel${i % 12}`,
      `Channel ${i % 12}`,
    );
    run(
      "INSERT INTO videos(id,source_id,channel_id,root_id,title,duration,added_at,indexed_at,available) VALUES(?,?,?,?,?,300,?,?,1)",
      `fixture${i}`,
      `fixture${i}`,
      `channel${i % 12}`,
      root,
      `Fixture ${i}`,
      now() - i * 1000,
      now(),
    );
    run(
      "INSERT INTO video_labels VALUES(?,?,?)",
      `fixture${i}`,
      "tags",
      i % 2 ? "nature" : "design",
    );
  }
  invalidateFeed();
  const first = feed(user, "seed");
  assert.deepEqual(first, feed(user, "seed"));
  assert.notDeepEqual(
    first.items.map((video) => video.id),
    feed(user, "refreshed-seed").items.map((video) => video.id),
    "a fresh visit or explicit refresh must produce a different mix",
  );
  assert.ok(
    new Set(first.items.slice(0, 12).map((v) => v.channel_id)).size >= 6,
  );
  const ids = new Set<string>();
  let offset: number | null = 0,
    pages = 0;
  while (offset !== null) {
    const page = feed(user, "seed", "For you", offset);
    for (const v of page.items) {
      assert.equal(ids.has(v.id), false, `duplicate ${v.id}`);
      ids.add(v.id);
    }
    offset = page.next;
    assert.ok(++pages < 100);
  }
  assert.equal(ids.size, 811);
  run("INSERT INTO feedback VALUES(?,?,'channel',?)", user, "channel1", now());
  invalidateFeed();
  assert.equal(
    feed(user, "another").items.some((v) => v.channel_id === "channel1"),
    false,
  );
});

test("interrupted worker recovery keeps metadata and makes re-indexing possible", () => {
  const job = "interrupted";
  run(
    "INSERT INTO scan_jobs(id,root_id,status,started_at,worker_pid) VALUES(?,?,'running',?,?)",
    job,
    root,
    now() - 120000,
    2147483647,
  );
  run("UPDATE library_roots SET status='scanning' WHERE id=?", root);
  recoverScanJobs();
  assert.equal(
    one<{ status: string }>("SELECT status FROM scan_jobs WHERE id=?", job)
      ?.status,
    "failed",
  );
  assert.equal(
    one<{ status: string }>("SELECT status FROM library_roots WHERE id=?", root)
      ?.status,
    "ready",
  );
  assert.equal(videoById("youtube:v2", user)?.available, 1);
});
test("subscriptions survive resolving a fallback uploader handle to a canonical channel ID", async () => {
  await item("handle", {
    id: "handle-video",
    uploader_id: "old-handle",
    uploader: "Creator",
    duration: 150,
  });
  await scanLibrary(root);
  run(
    "INSERT INTO subscriptions VALUES(?,?,?)",
    user,
    "youtube:old-handle",
    now(),
  );
  await item("handle", {
    id: "handle-video",
    channel_id: "UC-canonical",
    uploader_id: "new-handle",
    channel: "Creator",
    duration: 150,
  });
  await scanLibrary(root);
  assert.equal(videoById("youtube:handle-video", user)?.subscribed, 1);
});
test("duplicate source IDs produce one video and library-scoped channel metadata stays separate", async () => {
  for (const suffix of ["a", "b"]) {
    const sub = path.join(folder, suffix);
    await mkdir(sub);
    await writeFile(
      path.join(sub, "channel.info.json"),
      JSON.stringify({
        _type: "playlist",
        channel_id: "scoped-" + suffix,
        channel: "Channel " + suffix,
      }),
    );
    await writeFile(
      path.join(sub, "clip.info.json"),
      JSON.stringify({
        id: "scoped-video-" + suffix,
        title: "Scoped " + suffix,
        duration: 100,
      }),
    );
    await writeFile(path.join(sub, "clip.mp4"), "x");
  }
  await item("duplicate", {
    id: "v2",
    channel_id: "c2",
    title: "Duplicate",
    duration: 300,
  });
  const result = await scanLibrary(root);
  assert.ok(result.warnings.some((w) => w.includes("Duplicate source ID v2")));
  assert.equal(
    one<{ n: number }>("SELECT COUNT(*) AS n FROM videos WHERE source_id='v2'")
      ?.n,
    1,
  );
  assert.equal(
    videoById("youtube:scoped-video-a", user)?.channel_id,
    "youtube:scoped-a",
  );
  assert.equal(
    videoById("youtube:scoped-video-b", user)?.channel_id,
    "youtube:scoped-b",
  );
  assert.equal(
    Object.getPrototypeOf(videoById("youtube:v2", user)),
    Object.prototype,
  );
});

test("artwork survives re-indexing and channels sharing a folder retain their own banners", async () => {
  for (const channel of ["art-a", "art-b"]) {
    await writeFile(
      path.join(folder, channel + ".info.json"),
      JSON.stringify({
        _type: "playlist",
        channel_id: channel,
        channel,
        thumbnails: [
          {
            id: "banner",
            url: `https://i.ytimg.com/${channel}.jpg`,
            width: 2000,
            height: 300,
          },
        ],
      }),
    );
    await item(channel + "-video", {
      id: channel + "-video",
      channel_id: channel,
      title: channel,
      comments: [
        {
          id: "avatar-comment",
          author: "Viewer",
          author_thumbnail: "https://yt3.ggpht.com/sample.jpg",
          text: "Hello",
        },
      ],
    });
  }
  await scanLibrary(root);
  for (const channel of ["art-a", "art-b"]) {
    assert.equal(
      one<{ banner_url: string }>(
        "SELECT banner_url FROM channels WHERE id=?",
        "youtube:" + channel,
      )?.banner_url,
      `https://i.ytimg.com/${channel}.jpg`,
    );
    assert.equal(
      comments(user, "youtube:" + channel + "-video")[0].author_thumbnail,
      "https://yt3.ggpht.com/sample.jpg",
    );
  }
  await item("art-a-video", {
    id: "art-a-video",
    channel_id: "art-a",
    comments: [
      {
        id: "avatar-comment",
        text: "Updated",
        author_thumbnail: "javascript:alert(1)",
      },
    ],
  });
  await scanLibrary(root);
  assert.equal(
    comments(user, "youtube:art-a-video")[0].author_thumbnail,
    "https://yt3.ggpht.com/sample.jpg",
  );
});

test("inactive media is retained for one hour from hiding the tab", async () => {
  const { suspensionDelay, INACTIVE_MEDIA_TIMEOUT_MS } =
    await import("../src/lib/playback-policy");
  assert.equal(INACTIVE_MEDIA_TIMEOUT_MS, 3600000);
  assert.equal(suspensionDelay(1000, 1000), 3600000);
  assert.equal(suspensionDelay(1000, 2500), 3598500);
  assert.equal(suspensionDelay(1000, 3600999), 1);
  assert.equal(suspensionDelay(1000, 3601000), 0);
});

test("folder browsing respects allowed roots and native pickers are local-only", async () => {
  const { browseFolders, isLocalFolderPicker, nativePickerCommand } =
    await import("../src/lib/folder-picker");
  const previous = process.env.STREAMVAULT_ALLOWED_ROOTS;
  process.env.STREAMVAULT_ALLOWED_ROOTS = folder;
  try {
    const listing = await browseFolders();
    const canonical = await realpath(folder);
    assert.equal(listing.path, canonical);
    assert.equal(listing.parent, null);
    assert.ok(listing.folders.every((item) => inside(canonical, item.path)));
    await assert.rejects(browseFolders(temporary), /outside/);
    assert.equal(
      isLocalFolderPicker(
        new Request("http://127.0.0.1:3000/api/library/pick", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
      true,
    );
    assert.equal(
      isLocalFolderPicker(
        new Request("http://streamvault.local/api/library/pick", {
          headers: {
            host: "streamvault.local",
            origin: "http://streamvault.local",
          },
        }),
      ),
      false,
    );
    assert.equal(nativePickerCommand("linux", {}), null);
    assert.equal(
      nativePickerCommand("darwin", {
        STREAMVAULT_NATIVE_FOLDER_PICKER: "false",
      }),
      null,
    );
    assert.equal(nativePickerCommand("win32", {})?.args.includes("-STA"), true);
  } finally {
    if (previous === undefined) delete process.env.STREAMVAULT_ALLOWED_ROOTS;
    else process.env.STREAMVAULT_ALLOWED_ROOTS = previous;
  }
});

test("email-only registration derives unique names without changing existing accounts", async () => {
  run("UPDATE settings SET value='true' WHERE key='registration'");
  const password = await hashPassword("email-only-test");
  const first = registerUser("", "same-name@first.invalid", password);
  const second = registerUser("", "same-name@second.invalid", password);
  assert.equal(
    one<{ username: string }>("SELECT username FROM users WHERE id=?", first)
      ?.username,
    "same-name",
  );
  assert.equal(
    one<{ username: string }>("SELECT username FROM users WHERE id=?", second)
      ?.username,
    "same-name-2",
  );
  assert.equal(
    one<{ is_admin: number }>("SELECT is_admin FROM users WHERE id=?", second)
      ?.is_admin,
    0,
  );
  run("UPDATE settings SET value='false' WHERE key='registration'");
});
test("cached recommendations refresh watch state without changing their ordering", () => {
  const initial = feed(user, "fresh-progress-review");
  const video = initial.items[0];
  saveProgress(user, {
    videoId: video.id,
    seconds: 40,
    completed: false,
    clientAt: now() + 1,
    sessionId: "fresh-progress-review",
    watchedSeconds: 10,
  });
  const refreshed = feed(user, "fresh-progress-review");
  assert.deepEqual(
    refreshed.items.map((v) => v.id),
    initial.items.map((v) => v.id),
  );
  assert.equal(refreshed.items[0].seconds, 40);
});
test("explicit zero timestamps override resume and unknown duration does not erase timestamp", async () => {
  const { playbackStart } = await import("../src/lib/playback-policy");
  assert.deepEqual(playbackStart(50, false, 180, "0"), {
    seconds: 0,
    explicit: true,
  });
  assert.deepEqual(playbackStart(50, false, 0, "75"), {
    seconds: 75,
    explicit: true,
  });
  assert.deepEqual(playbackStart(50, false, 180, "bad"), {
    seconds: 50,
    explicit: false,
  });
  assert.deepEqual(playbackStart(180, true, 180), {
    seconds: 0,
    explicit: false,
  });
});

test("client IDs work without secure-context randomUUID and remain unique", async () => {
  const { clientId } = await import("../src/lib/client-id");
  const httpCrypto = {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  };
  const ids = new Set(Array.from({ length: 100 }, () => clientId(httpCrypto)));
  assert.equal(ids.size, 100);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});

test("watch URLs expose source IDs while preserving internal state keys", async () => {
  const { watchHref, internalVideoId } = await import("../src/lib/video-url");
  assert.equal(watchHref("youtube:4GnCipXbxJg"), "/watch?v=4GnCipXbxJg");
  assert.equal(internalVideoId("4GnCipXbxJg"), "youtube:4GnCipXbxJg");
  assert.equal(internalVideoId("youtube:4GnCipXbxJg"), "youtube:4GnCipXbxJg");
});

test("channel slugs stay stable, shorts are separated and excluded from home pagination, and channels are searchable", async () => {
  const { collection, searchChannels } = await import("../src/lib/library");
  const { isShort } = await import("../src/lib/shorts");
  assert.equal(
    isShort({ duration: 30, width: 1920, height: 1080 }, "/videos/brief.mp4"),
    false,
  );
  assert.equal(
    isShort(
      { original_url: "https://www.youtube.com/shorts/example" },
      "/videos/example.mp4",
    ),
    true,
  );
  const archive = path.join(temporary, "format-fixtures");
  await mkdir(archive);
  const formatRoot = await addRoot(archive, "Formats");
  for (const [id, channel_id, extra] of [
    ["format-long", "format-a", { duration: 30, width: 1920, height: 1080 }],
    ["format-short", "format-a", { duration: 45, width: 1080, height: 1920 }],
    ["format-collision", "format-b", { duration: 600 }],
  ] as const) {
    await writeFile(
      path.join(archive, id + ".info.json"),
      JSON.stringify({
        id,
        channel_id,
        channel: "A New Channel!",
        title: id,
        ...extra,
      }),
    );
    await writeFile(path.join(archive, id + ".mp4"), "test media");
  }
  await scanLibrary(formatRoot);
  const slugA = one<{ slug: string }>(
    "SELECT slug FROM channels WHERE id='youtube:format-a'",
  )!.slug;
  const slugB = one<{ slug: string }>(
    "SELECT slug FROM channels WHERE id='youtube:format-b'",
  )!.slug;
  assert.notEqual(slugA, slugB);
  assert.equal(
    collection(user, "channel", 0, "youtube:format-a", "videos")[0].id,
    "youtube:format-long",
  );
  assert.equal(
    collection(user, "channel", 0, "youtube:format-a", "shorts")[0].id,
    "youtube:format-short",
  );
  assert.equal(searchChannels(user, "new channel").length, 2);
  assert.equal(
    searchChannels(user, "%").length,
    0,
    "SQL wildcard characters must be literal search terms",
  );
  for (const filter of [
    "For you",
    "New to you",
    "Continue watching",
    "Recently added",
  ]) {
    let offset: number | null = 0;
    while (offset !== null) {
      const page = feed(user, "short-exclusion", filter, offset);
      assert.ok(
        page.items.every((video) => video.id !== "youtube:format-short"),
      );
      offset = page.next;
    }
  }
  await writeFile(
    path.join(archive, "format-long.info.json"),
    JSON.stringify({
      id: "format-long",
      channel_id: "format-a",
      channel: "Renamed channel",
      title: "Updated normal video",
      duration: 30,
      width: 1920,
      height: 1080,
    }),
  );
  await scanLibrary(formatRoot);
  assert.equal(
    one<{ slug: string }>(
      "SELECT slug FROM channels WHERE id='youtube:format-a'",
    )!.slug,
    slugA,
  );
});
