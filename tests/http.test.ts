import { test } from "node:test";
import assert from "node:assert/strict";
const origin = process.env.STREAMVAULT_TEST_ORIGIN;
const enabled = !!origin && process.env.STREAMVAULT_DATA_DIR?.includes("demo");
let token: string;
if (enabled) {
  const { one } = await import("../src/lib/db");
  const { createDeviceSession } = await import("../src/lib/auth");
  const user = one<{ id: string }>(
    "SELECT id FROM users WHERE email='demo@example.invalid'",
  );
  if (!user) throw new Error("Prepare the isolated demo before HTTP tests.");
  token = createDeviceSession(user.id, "Automated HTTP tests").token;
}
const video = "/media/video/youtube%3Ademo-0";
async function get(route = video, options: RequestInit = {}) {
  return fetch(origin + route, {
    ...options,
    headers: { cookie: `streamvault_session=${token}`, ...options.headers },
  });
}
test(
  "HTTP media requires an authenticated session",
  { skip: !enabled },
  async () => {
    assert.equal((await fetch(origin + video)).status, 401);
  },
);
test(
  "HTTP ranges/HEAD/ETags deliver exact bytes without full-file buffering",
  { skip: !enabled },
  async () => {
    const head = await get(video, { method: "HEAD" });
    assert.equal(head.status, 200);
    const size = Number(head.headers.get("content-length"));
    assert.ok(size > 100);
    const first = await get(video, { headers: { range: "bytes=0-9" } });
    assert.equal(first.status, 206);
    assert.equal(first.headers.get("content-range"), `bytes 0-9/${size}`);
    assert.equal((await first.arrayBuffer()).byteLength, 10);
    const suffix = await get(video, { headers: { range: "bytes=-16" } });
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 16);
    const bad = await get(video, { headers: { range: `bytes=${size}-` } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get("content-range"), `bytes */${size}`);
    assert.equal(
      (
        await get(video, {
          headers: { "if-none-match": head.headers.get("etag")! },
        })
      ).status,
      304,
    );
  },
);
test(
  "HTTP writes work on the public host and reject cross-origin requests",
  { skip: !enabled },
  async () => {
    const response = await get("/api/progress", {
      method: "POST",
      headers: { origin: origin!, "content-type": "application/json" },
      body: JSON.stringify({
        videoId: "youtube:demo-0",
        seconds: 45,
        completed: false,
        clientAt: Date.now(),
        sessionId: "http-test",
        watchedSeconds: 5,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(
      (
        await get("/api/session", {
          method: "POST",
          headers: { origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await get("/api/session", {
          method: "POST",
          headers: { origin: origin! },
        })
      ).status,
      200,
    );
  },
);

test(
  "server folder browsing is authenticated and returns directories on the host",
  { skip: !enabled },
  async () => {
    assert.equal((await fetch(origin + "/api/library/folders")).status, 401);
    const { one } = await import("../src/lib/db");
    const root = one<{ path: string }>(
      "SELECT path FROM library_roots WHERE archived=0 LIMIT 1",
    )!;
    const response = await get(
      "/api/library/folders?path=" + encodeURIComponent(root.path),
    );
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.equal(typeof listing.path, "string");
    assert.ok(Array.isArray(listing.folders));
    assert.ok(
      listing.folders.every(
        (item: { name: string; path: string }) =>
          typeof item.name === "string" && typeof item.path === "string",
      ),
    );
  },
);

test(
  "comments post, reload and accept replies while rejecting blank submissions",
  { skip: !enabled },
  async () => {
    const { run } = await import("../src/lib/db");
    const ids: string[] = [];
    const post = (text: string, parentId?: string) =>
      get("/api/comments", {
        method: "POST",
        headers: { origin: origin!, "content-type": "application/json" },
        body: JSON.stringify({ videoId: "youtube:demo-0", text, parentId }),
      });
    try {
      const response = await post("Comment submission regression check");
      assert.equal(response.status, 200);
      const { id } = await response.json();
      ids.push(id);
      const listing = await (
        await get("/api/comments?video=youtube%3Ademo-0")
      ).json();
      assert.ok(
        listing.items.some((comment: { id: string }) => comment.id === id),
      );
      const reply = await post("Reply submission regression check", id);
      assert.equal(reply.status, 200);
      ids.push((await reply.json()).id);
      assert.equal((await post("   ")).status, 400);
    } finally {
      for (const id of ids.reverse())
        run("DELETE FROM comments WHERE id=?", id);
    }
  },
);

test(
  "query watch URLs render and old links redirect with timestamps preserved",
  { skip: !enabled },
  async () => {
    const response = await get("/watch?v=demo-0");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("player-shell"));
    assert.ok(
      html.includes(" | Streamvault</title>"),
      "watch tab title includes the video title and site name",
    );
    const legacy = await get("/watch/youtube%3Ademo-0?t=12&autoplay=1", {
      redirect: "manual",
    });
    assert.equal(legacy.status, 308);
    assert.equal(
      legacy.headers.get("location"),
      "/watch?v=demo-0&t=12&autoplay=1",
    );
    assert.equal((await get("/watch?v=missing-source-id")).status, 404);
  },
);

test(
  "home reloads get a fresh recommendation seed",
  { skip: !enabled },
  async () => {
    const first = await (await get("/")).text();
    const second = await (await get("/")).text();
    const seed = (html: string) =>
      html.match(/seed\\":\\"([a-f0-9-]{36})\\"/)?.[1];
    assert.ok(
      seed(first),
      "server-rendered feed must include a recommendation seed",
    );
    assert.ok(seed(second));
    assert.notEqual(seed(first), seed(second));
  },
);

test(
  "channel names resolve, legacy links redirect, descriptions collapse and search includes channels",
  { skip: !enabled },
  async () => {
    const { one, run } = await import("../src/lib/db");
    const channel = one<{
      id: string;
      name: string;
      slug: string;
      description: string;
    }>(
      "SELECT c.id,c.name,c.slug,c.description FROM channels c WHERE EXISTS(SELECT 1 FROM videos WHERE channel_id=c.id AND archived=0) LIMIT 1",
    )!;
    const original = channel.description;
    run(
      "UPDATE channels SET description=? WHERE id=?",
      "Channel description regression check",
      channel.id,
    );
    try {
      const response = await get(`/channel/${channel.slug}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('data-expanded="false"'));
      assert.ok(html.includes('aria-label="Channel videos"'));
      assert.ok(html.includes("?tab=shorts"));
      const legacy = await get(
        `/channel/${encodeURIComponent(channel.id)}?tab=shorts`,
        { redirect: "manual" },
      );
      assert.equal(legacy.status, 308);
      assert.equal(
        legacy.headers.get("location"),
        `/channel/${channel.slug}?tab=shorts`,
      );
      const search = await get(`/search?q=${encodeURIComponent(channel.name)}`);
      assert.equal(search.status, 200);
      assert.ok((await search.text()).includes("search-channels"));
    } finally {
      run("UPDATE channels SET description=? WHERE id=?", original, channel.id);
    }
  },
);
