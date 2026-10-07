import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const dataDirectory = path.resolve(
  process.env.STREAMVAULT_DATA_DIR || "data",
);
const globalDatabase = globalThis as typeof globalThis & {
  streamvaultDatabase?: DatabaseSync;
};
export function database() {
  if (globalDatabase.streamvaultDatabase)
    return globalDatabase.streamvaultDatabase;
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(dataDirectory, "streamvault.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL, label TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON device_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS library_roots(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at INTEGER NOT NULL, last_scanned_at INTEGER, status TEXT NOT NULL DEFAULT 'ready', archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS scan_jobs(id TEXT PRIMARY KEY, root_id TEXT NOT NULL REFERENCES library_roots(id), status TEXT NOT NULL, discovered INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL, finished_at INTEGER, worker_pid INTEGER);
    CREATE INDEX IF NOT EXISTS scan_roots ON scan_jobs(root_id,started_at DESC);
    CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', avatar_path TEXT, banner_path TEXT, imported_followers INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id), root_id TEXT NOT NULL REFERENCES library_roots(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0, published_at INTEGER, added_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, video_path TEXT, thumbnail_path TEXT, available INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, imported_views INTEGER NOT NULL DEFAULT 0, imported_likes INTEGER NOT NULL DEFAULT 0, file_size INTEGER, file_mtime REAL, live_status TEXT, availability TEXT);
    CREATE INDEX IF NOT EXISTS video_channel_date ON videos(channel_id,published_at DESC);
    CREATE INDEX IF NOT EXISTS video_root ON videos(root_id,archived,available);
    CREATE TABLE IF NOT EXISTS media_assets(video_id TEXT PRIMARY KEY REFERENCES videos(id),file_path TEXT NOT NULL,source_fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS video_labels(video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, kind TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(video_id,kind,label));
    CREATE INDEX IF NOT EXISTS labels_text ON video_labels(label,video_id);
    CREATE TABLE IF NOT EXISTS chapters(video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, start_time REAL NOT NULL, end_time REAL NOT NULL, title TEXT NOT NULL, PRIMARY KEY(video_id,start_time));
    CREATE TABLE IF NOT EXISTS subtitles(video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, language TEXT NOT NULL, file_path TEXT NOT NULL, PRIMARY KEY(video_id,language));
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id), parent_id TEXT REFERENCES comments(id), user_id TEXT REFERENCES users(id) ON DELETE SET NULL, source TEXT NOT NULL CHECK(source IN ('local','ytdlp')), source_id TEXT, author TEXT NOT NULL, text TEXT NOT NULL, imported_likes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS comments_video_parent ON comments(video_id,parent_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS comment_likes(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE, PRIMARY KEY(user_id,comment_id));
    CREATE TABLE IF NOT EXISTS video_likes(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(id), created_at INTEGER NOT NULL, PRIMARY KEY(user_id,video_id));
    CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel_id TEXT NOT NULL REFERENCES channels(id), created_at INTEGER NOT NULL, PRIMARY KEY(user_id,channel_id));
    CREATE TABLE IF NOT EXISTS watch_progress(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(id), seconds REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, client_at INTEGER NOT NULL, PRIMARY KEY(user_id,video_id));
    CREATE INDEX IF NOT EXISTS progress_user_time ON watch_progress(user_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS watch_sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(id), watched_seconds REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS watch_session_user ON watch_sessions(user_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS watch_later(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(id), created_at INTEGER NOT NULL, PRIMARY KEY(user_id,video_id));
    CREATE TABLE IF NOT EXISTS feedback(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('video','channel')), created_at INTEGER NOT NULL, PRIMARY KEY(user_id,target_id,kind));
    CREATE TABLE IF NOT EXISTS impressions(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(id), seen_at INTEGER NOT NULL, PRIMARY KEY(user_id,video_id));
    CREATE TABLE IF NOT EXISTS feed_snapshots(key TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,values_json TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS feed_snapshot_user ON feed_snapshots(user_id,created_at);
    CREATE TABLE IF NOT EXISTS preferences(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(user_id,key));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS video_search USING fts5(video_id UNINDEXED,title,description,channel,tokenize='unicode61');
    INSERT OR IGNORE INTO settings VALUES('registration','false');
    PRAGMA user_version=1;`);
  if (
    !db
      .prepare("PRAGMA table_info(scan_jobs)")
      .all()
      .some((row) => row.name === "worker_pid")
  )
    db.exec("ALTER TABLE scan_jobs ADD COLUMN worker_pid INTEGER");
  if (
    !db
      .prepare("PRAGMA table_info(videos)")
      .all()
      .some((row) => row.name === "fps")
  )
    db.exec("ALTER TABLE videos ADD COLUMN fps REAL");
  for (const [table, column] of [
    ["comments", "author_thumbnail"],
    ["channels", "avatar_url"],
    ["channels", "banner_url"],
  ]) {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
  globalDatabase.streamvaultDatabase = db;
  return db;
}
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return database()
    .prepare(sql)
    .all(...params)
    .map((row) => ({ ...row })) as unknown as T[];
}
export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  const row = database()
    .prepare(sql)
    .get(...params);
  return row ? ({ ...row } as unknown as T) : undefined;
}
export function run(sql: string, ...params: SQLInputValue[]) {
  return database()
    .prepare(sql)
    .run(...params);
}
export function transaction<T>(fn: () => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export const now = () => Date.now();
