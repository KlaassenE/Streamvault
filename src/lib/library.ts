import { createHash } from "node:crypto";
import { all, one, run, transaction, now } from "./db";
import type { VideoCard, Video, Comment } from "./types";

const cards = `SELECT v.id,v.title,v.channel_id,c.name AS channel,c.slug AS channel_slug,v.duration,v.published_at,v.added_at,v.available,CASE WHEN v.thumbnail_path IS NULL THEN 0 ELSE 1 END AS thumbnail,COALESCE(p.seconds,0) AS seconds,COALESCE(p.completed,0) AS completed FROM videos v JOIN channels c ON c.id=v.channel_id LEFT JOIN watch_progress p ON p.video_id=v.id AND p.user_id=?`;
export function videoById(id: string, userId: string) {
  return one<Video>(
    `${cards.replace(" FROM videos", `,v.fps,v.description,v.imported_views,v.imported_likes,(SELECT COUNT(*) FROM video_likes WHERE video_id=v.id) AS local_likes,EXISTS(SELECT 1 FROM video_likes WHERE user_id=? AND video_id=v.id) AS liked,EXISTS(SELECT 1 FROM watch_later WHERE user_id=? AND video_id=v.id) AS saved,EXISTS(SELECT 1 FROM subscriptions WHERE user_id=? AND channel_id=v.channel_id) AS subscribed FROM videos`)} WHERE v.id=? AND v.archived=0`,
    userId,
    userId,
    userId,
    userId,
    id,
  );
}
export function resumeVideos(userId: string) {
  return all<VideoCard>(
    `${cards} WHERE v.archived=0 AND v.available=1 AND v.is_short=0 AND p.completed=0 AND p.seconds>15 AND v.duration-p.seconds>30 AND p.updated_at>? ORDER BY p.updated_at DESC LIMIT 4`,
    userId,
    now() - 90 * 86400000,
  );
}
export function collection(
  userId: string,
  kind: string,
  offset = 0,
  channel?: string,
  format = "videos",
) {
  const conditions: Record<string, string> = {
    history: "p.updated_at IS NOT NULL",
    saved:
      "EXISTS(SELECT 1 FROM watch_later WHERE user_id=? AND video_id=v.id)",
    subscriptions:
      "EXISTS(SELECT 1 FROM subscriptions WHERE user_id=? AND channel_id=v.channel_id)",
    channel: "v.channel_id=?",
    library: "1=1",
  };
  const condition = conditions[kind] || "1=1";
  const extra = ["saved", "subscriptions"].includes(kind)
    ? [userId]
    : kind === "channel"
      ? [channel || ""]
      : [];
  return all<VideoCard>(
    `${cards} WHERE v.archived=0 AND ${condition} ${kind === "channel" ? `AND v.is_short=${format === "shorts" ? 1 : 0}` : ""} ORDER BY ${kind === "history" ? "p.updated_at" : "COALESCE(v.published_at,v.added_at)"} DESC,v.id LIMIT 24 OFFSET ?`,
    userId,
    ...extra,
    offset,
  );
}
export function searchVideos(userId: string, query: string, offset = 0) {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 10);
  if (!terms.length) return [];
  const expression = terms
    .map((t) => `"${t.replaceAll('"', '""')}"*`)
    .join(" AND ");
  return all<VideoCard>(
    `${cards} JOIN video_search s ON s.video_id=v.id WHERE video_search MATCH ? AND v.archived=0 ORDER BY rank LIMIT 24 OFFSET ?`,
    userId,
    expression,
    offset,
  );
}
type Candidate = VideoCard & {
  labels: string[];
  liked: number;
  subscribed: number;
  seen_at: number;
  watched: number;
  score?: number;
};
function random(seed: string, id: string) {
  return (
    createHash("sha256")
      .update(seed + id)
      .digest()
      .readUInt32BE(0) / 0xffffffff
  );
}
export function diversify(
  candidates: Candidate[],
  seed: string,
  interest: Map<string, number>,
  currentLabels: string[] = [],
) {
  const eligible = candidates.map((v) => {
    const relevance = v.labels.reduce(
      (sum, label) => sum + Math.min(3, interest.get(label) || 0),
      0,
    );
    const nearby = v.labels.filter((label) =>
      currentLabels.includes(label),
    ).length;
    const fresh = Math.max(0, 1 - (now() - v.added_at) / (30 * 86400000));
    const repeatPenalty =
      v.seen_at > now() - 86400000
        ? 6
        : v.seen_at > now() - 7 * 86400000
          ? 2
          : 0;
    const completionPenalty = v.completed ? 12 : 0;
    return {
      ...v,
      score:
        Math.min(8, relevance) +
        v.subscribed * 3 +
        v.liked * 2 +
        fresh * 2 +
        nearby * 2 +
        random(seed, v.id) * 6 -
        repeatPenalty -
        completionPenalty,
      reason:
        currentLabels.length && nearby
          ? "Related to this video"
          : v.subscribed
            ? "From your subscriptions"
            : relevance
              ? "A familiar interest"
              : fresh > 0.5
                ? "Recently added"
                : "Something different",
    };
  });
  const result: Candidate[] = [];
  const counts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  // Greedy reranking penalizes channel/topic saturation; every fourth slot draws from unfamiliar channels.
  while (eligible.length) {
    let best = -1;
    let bestScore = -Infinity;
    const explore =
      result.length % 4 === 3 &&
      eligible.some(
        (v) =>
          !v.subscribed && v.watched === 0 && v.seconds === 0 && !v.completed,
      );
    eligible.forEach((v, index) => {
      if (explore && (v.subscribed || v.watched > 0 || v.completed)) return;
      const last = result.at(-1);
      const saturation =
        (counts.get(v.channel_id) || 0) * 2.5 +
        (last?.channel_id === v.channel_id ? 8 : 0);
      const topicPenalty = Math.min(
        4,
        v.labels.reduce(
          (sum, label) => sum + (labelCounts.get(label) || 0) * 0.15,
          0,
        ),
      );
      const score = (v.score || 0) - saturation - topicPenalty;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best < 0) best = 0;
    const chosen = eligible.splice(best, 1)[0];
    result.push(chosen);
    counts.set(chosen.channel_id, (counts.get(chosen.channel_id) || 0) + 1);
    chosen.labels.forEach((label) =>
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1),
    );
  }
  return result.map(
    ({ labels, liked, subscribed, seen_at, watched, score, ...card }) => card,
  );
}
type FeedCache = { expires: number; values: VideoCard[] };
const cache = new Map<string, FeedCache>();
export function feed(
  userId: string,
  seed: string,
  filter = "For you",
  offset = 0,
  currentId?: string,
) {
  if (filter === "Recently added") {
    const items = all<VideoCard>(
      `${cards} WHERE v.archived=0 AND v.available=1 ${currentId ? "" : "AND v.is_short=0"} AND v.id<>? AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.user_id=? AND (f.kind='video' AND f.target_id=v.id OR f.kind='channel' AND f.target_id=v.channel_id)) ORDER BY v.added_at DESC,v.id LIMIT 25 OFFSET ?`,
      userId,
      currentId || "",
      userId,
      offset,
    );
    return {
      items: items.slice(0, 24),
      next: items.length > 24 ? offset + 24 : null,
    };
  }
  const revision =
    one<{ value: string }>(
      "SELECT value FROM settings WHERE key='index_revision'",
    )?.value || "0";
  const key = JSON.stringify([
    "shorts-filter-v1",
    userId,
    seed,
    filter,
    currentId,
    revision,
  ]);
  const cached = cache.get(key);
  if (cached && (cached.expires > now() || offset > 0))
    return feedPage(userId, cached.values, offset, filter, currentId);
  const snapshot = one<{ values_json: string; created_at: number }>(
    "SELECT values_json,created_at FROM feed_snapshots WHERE key=?",
    key,
  );
  if (snapshot && snapshot.created_at > now() - 14 * 86400000) {
    const values = JSON.parse(snapshot.values_json) as VideoCard[];
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now() + 30 * 60000, values });
    return feedPage(userId, values, offset, filter, currentId);
  }
  const subscriptions = new Set(
    all<{ channel_id: string }>(
      "SELECT channel_id FROM subscriptions WHERE user_id=?",
      userId,
    ).map((x) => x.channel_id),
  );
  const likes = new Set(
    all<{ video_id: string }>(
      "SELECT video_id FROM video_likes WHERE user_id=?",
      userId,
    ).map((x) => x.video_id),
  );
  const interests = new Map<string, number>();
  const history = all<{ label: string; weight: number }>(
    `SELECT l.label,SUM(MIN(3,COALESCE(w.watched,0)/180)+CASE WHEN k.video_id IS NULL THEN 0 ELSE 2 END) AS weight FROM video_labels l LEFT JOIN (SELECT video_id,SUM(watched_seconds) AS watched FROM watch_sessions WHERE user_id=? AND updated_at>? GROUP BY video_id) w ON w.video_id=l.video_id LEFT JOIN video_likes k ON k.video_id=l.video_id AND k.user_id=? WHERE w.watched>20 OR k.video_id IS NOT NULL GROUP BY l.label`,
    userId,
    now() - 180 * 86400000,
    userId,
  );
  history.forEach((row) => interests.set(row.label, Math.log1p(row.weight)));
  // Bound the pool and response. Include recent, resume, liked, subscribed, and deterministic samples from older files.
  const pool = all<VideoCard>(
    `${cards} WHERE v.archived=0 AND v.available=1 ${currentId ? "" : "AND v.is_short=0"} AND v.id<>? AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.user_id=? AND (f.kind='video' AND f.target_id=v.id OR f.kind='channel' AND f.target_id=v.channel_id)) ORDER BY CASE WHEN p.seconds>15 AND p.completed=0 THEN 0 ELSE 1 END, v.added_at DESC LIMIT 400`,
    userId,
    currentId || "",
    userId,
  );
  const old = all<VideoCard>(
    `${cards} WHERE v.archived=0 AND v.available=1 ${currentId ? "" : "AND v.is_short=0"} AND v.id<>? AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.user_id=? AND (f.kind='video' AND f.target_id=v.id OR f.kind='channel' AND f.target_id=v.channel_id)) ORDER BY v.id LIMIT 150 OFFSET ?`,
    userId,
    currentId || "",
    userId,
    Math.floor(
      random(seed, userId) *
        Math.max(
          1,
          (one<{ n: number }>(
            "SELECT COUNT(*) AS n FROM videos WHERE available=1 AND archived=0",
          )?.n || 0) - 150,
        ),
    ),
  );
  const relevant = all<VideoCard>(
    `${cards} WHERE v.archived=0 AND v.available=1 ${currentId ? "" : "AND v.is_short=0"} AND v.id<>? AND (EXISTS(SELECT 1 FROM subscriptions s WHERE s.user_id=? AND s.channel_id=v.channel_id) OR EXISTS(SELECT 1 FROM video_likes k WHERE k.user_id=? AND k.video_id=v.id) OR EXISTS(SELECT 1 FROM video_labels l WHERE l.video_id=v.id AND l.label IN (SELECT value FROM json_each(?)))) AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.user_id=? AND (f.kind='video' AND f.target_id=v.id OR f.kind='channel' AND f.target_id=v.channel_id)) ORDER BY COALESCE(p.completed,0),v.published_at DESC LIMIT 120`,
    userId,
    currentId || "",
    userId,
    userId,
    JSON.stringify(
      [...interests]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map((v) => v[0]),
    ),
    userId,
  );
  const poolIds = JSON.stringify(
    [...pool, ...relevant, ...old].map((v) => v.id).concat(currentId || []),
  );
  const labels = all<{ video_id: string; label: string }>(
    "SELECT video_id,label FROM video_labels WHERE video_id IN (SELECT value FROM json_each(?))",
    poolIds,
  );
  const labelMap = new Map<string, string[]>();
  labels.forEach((row) =>
    labelMap.set(row.video_id, [
      ...(labelMap.get(row.video_id) || []),
      row.label.toLowerCase(),
    ]),
  );
  const seen = new Map(
    all<{ video_id: string; seen_at: number }>(
      "SELECT video_id,seen_at FROM impressions WHERE user_id=? AND seen_at>?",
      userId,
      now() - 7 * 86400000,
    ).map((x) => [x.video_id, x.seen_at]),
  );
  const watched = new Map(
    all<{ video_id: string; watched: number }>(
      "SELECT video_id,SUM(watched_seconds) AS watched FROM watch_sessions WHERE user_id=? AND video_id IN (SELECT value FROM json_each(?)) GROUP BY video_id",
      userId,
      poolIds,
    ).map((x) => [x.video_id, x.watched]),
  );
  let candidates = [
    ...new Map([...pool, ...relevant, ...old].map((v) => [v.id, v])).values(),
  ].map((v) => ({
    ...v,
    labels: labelMap.get(v.id) || [],
    liked: likes.has(v.id) ? 1 : 0,
    subscribed: subscriptions.has(v.channel_id) ? 1 : 0,
    seen_at: seen.get(v.id) || 0,
    watched: watched.get(v.id) || 0,
  }));
  // Normalize interest labels to match the indexed pool.
  const normalized = new Map(
    [...interests].map(([label, value]) => [label.toLowerCase(), value]),
  );
  if (filter === "Continue watching")
    candidates = candidates.filter(
      (v) => v.seconds > 15 && !v.completed && v.duration - v.seconds > 30,
    );
  if (filter === "New to you")
    candidates = candidates.filter(
      (v) => !v.completed && v.watched === 0 && v.seen_at < now() - 86400000,
    );
  const values =
    filter === "Recently added"
      ? candidates.sort((a, b) => b.added_at - a.added_at)
      : diversify(
          candidates,
          seed,
          normalized,
          currentId ? labelMap.get(currentId) || [] : [],
        );
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: now() + 30 * 60_000, values });
  run(
    "INSERT OR REPLACE INTO feed_snapshots VALUES(?,?,?,?)",
    key,
    userId,
    JSON.stringify(values),
    now(),
  );
  run(
    "DELETE FROM feed_snapshots WHERE key IN (SELECT key FROM feed_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 200)",
    userId,
  );
  return feedPage(userId, values, offset, filter, currentId);
}
function feedPage(
  userId: string,
  values: VideoCard[],
  offset: number,
  filter: string,
  currentId?: string,
) {
  const selected = values.slice(offset, offset + 24);
  const fresh = new Map(
    all<VideoCard>(
      `${cards} WHERE v.id IN (SELECT value FROM json_each(?))`,
      userId,
      JSON.stringify(selected.map((v) => v.id)),
    ).map((v) => [v.id, v]),
  );
  const remaining = Math.max(0, offset - values.length);
  const condition =
    filter === "Continue watching"
      ? "AND p.seconds>15 AND p.completed=0 AND v.duration-p.seconds>30"
      : filter === "New to you"
        ? "AND COALESCE(p.completed,0)=0 AND NOT EXISTS(SELECT 1 FROM watch_sessions w WHERE w.user_id=? AND w.video_id=v.id AND w.watched_seconds>0) AND NOT EXISTS(SELECT 1 FROM impressions i WHERE i.user_id=? AND i.video_id=v.id AND i.seen_at>?)"
        : "";
  const extras =
    filter === "New to you" ? [userId, userId, now() - 86400000] : [];
  const tail =
    selected.length < 24
      ? all<VideoCard>(
          `${cards} WHERE v.available=1 AND v.archived=0 ${currentId ? "" : "AND v.is_short=0"} AND v.id<>? AND v.id NOT IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.user_id=? AND (f.kind='video' AND f.target_id=v.id OR f.kind='channel' AND f.target_id=v.channel_id)) ${condition} ORDER BY v.added_at DESC,v.id LIMIT ? OFFSET ?`,
          userId,
          currentId || "",
          JSON.stringify(values.map((v) => v.id)),
          userId,
          ...extras,
          25 - selected.length,
          remaining,
        )
      : [];
  const combined = [
    ...selected.map((v) => ({ ...v, ...fresh.get(v.id) })),
    ...tail,
  ];
  return {
    items: combined.slice(0, 24),
    next:
      offset + 24 < values.length || combined.length >= 24 ? offset + 24 : null,
  };
}
export function invalidateFeed() {
  cache.clear();
  run("DELETE FROM feed_snapshots");
}
export function comments(
  userId: string,
  videoId: string,
  parentId: string | null = null,
  offset = 0,
) {
  return all<Comment>(
    `SELECT c.id,c.parent_id,c.author,c.author_thumbnail,c.text,c.source,c.created_at,c.imported_likes+(SELECT COUNT(*) FROM comment_likes WHERE comment_id=c.id) AS likes,EXISTS(SELECT 1 FROM comment_likes WHERE comment_id=c.id AND user_id=?) AS liked,(SELECT COUNT(*) FROM comments WHERE parent_id=c.id) AS replies FROM comments c WHERE c.video_id=? AND c.parent_id IS ? ORDER BY c.created_at DESC,c.id LIMIT 20 OFFSET ?`,
    userId,
    videoId,
    parentId,
    offset,
  );
}
export function saveProgress(
  userId: string,
  input: {
    videoId: string;
    seconds: number;
    completed: boolean;
    clientAt: number;
    sessionId: string;
    watchedSeconds: number;
  },
) {
  if (!one("SELECT id FROM videos WHERE id=?", input.videoId))
    throw new Error("Video not found");
  const time = now();
  const clientAt = Math.min(time + 30000, input.clientAt);
  const duration = one<{ duration: number }>(
    "SELECT duration FROM videos WHERE id=?",
    input.videoId,
  )!.duration;
  const seconds = Math.max(
    0,
    Math.min(duration || Number.MAX_SAFE_INTEGER, input.seconds),
  );
  transaction(() => {
    run(
      `INSERT INTO watch_progress VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET seconds=excluded.seconds,completed=excluded.completed,updated_at=excluded.updated_at,client_at=excluded.client_at WHERE excluded.client_at>=watch_progress.client_at`,
      userId,
      input.videoId,
      seconds,
      input.completed ? 1 : 0,
      time,
      clientAt,
    );
    // Each playback session sends a monotonic accumulated watch duration; retries are idempotent.
    run(
      `INSERT INTO watch_sessions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET watched_seconds=MAX(watch_sessions.watched_seconds,excluded.watched_seconds),updated_at=excluded.updated_at WHERE watch_sessions.user_id=excluded.user_id AND watch_sessions.video_id=excluded.video_id`,
      `${userId}:${input.sessionId}`,
      userId,
      input.videoId,
      Math.max(0, Math.min(86400, input.watchedSeconds)),
      time,
    );
  });
}

export function searchChannels(userId: string, query: string) {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 10);
  if (!terms.length) return [];
  const conditions = terms.map(() => "c.name LIKE ? ESCAPE '\\'").join(" AND ");
  const values = terms.map(
    (term) => `%${term.replace(/[\\%_]/g, (char) => "\\" + char)}%`,
  );
  return all<{
    id: string;
    name: string;
    slug: string;
    avatar_path: string | null;
    avatar_url: string | null;
    video_count: number;
  }>(
    `SELECT c.id,c.name,c.slug,c.avatar_path,c.avatar_url,(SELECT COUNT(*) FROM videos WHERE channel_id=c.id AND archived=0) AS video_count FROM channels c WHERE ${conditions} AND EXISTS(SELECT 1 FROM videos WHERE channel_id=c.id AND archived=0) ORDER BY c.name LIMIT 24`,
    ...values,
  );
}
