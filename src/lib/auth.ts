import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, one, run, transaction, now } from "./db";
import type { User } from "./types";

const scrypt = promisify(scryptCallback);
export const COOKIE = "streamvault_session";
export const SESSION_DAYS = 180;
export const SESSION_MS = SESSION_DAYS * 86_400_000;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function registerUser(
  username: string,
  email: string,
  passwordHash: string,
) {
  return transaction(() => {
    const count = one<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n;
    if (
      count &&
      one<{ value: string }>(
        "SELECT value FROM settings WHERE key='registration'",
      )?.value !== "true"
    )
      throw new Error("Registration is closed. Ask the library administrator.");
    if (!username.trim()) {
      const base = email.split("@")[0].slice(0, 34) || "Viewer";
      username = base;
      let suffix = 2;
      while (one("SELECT id FROM users WHERE username=?", username))
        username = `${base}-${suffix++}`;
    }
    const id = randomUUID();
    run(
      "INSERT INTO users VALUES(?,?,?,?,?,?)",
      id,
      username,
      email.toLowerCase(),
      passwordHash,
      count === 0 ? 1 : 0,
      now(),
    );
    return id;
  });
}
export function createDeviceSession(
  userId: string,
  label = "Personal device",
  temporary = false,
) {
  const token = randomBytes(32).toString("base64url");
  const created = now();
  const expires = created + (temporary ? 86_400_000 : SESSION_MS);
  run("DELETE FROM device_sessions WHERE expires_at<?", created);
  run(
    "INSERT INTO device_sessions VALUES(?,?,?,?,?,?)",
    hash(token),
    userId,
    created,
    expires,
    created,
    label.slice(0, 100),
  );
  return { token, expires, temporary };
}
export const cookieOptions = (expires: number, temporary = false) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.STREAMVAULT_SECURE_COOKIE === "true",
  path: "/",
  ...(temporary ? {} : { expires: new Date(expires) }),
});
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return (
    one<User>(
      "SELECT u.id,u.username,u.email,u.is_admin FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
      hash(token),
      now(),
    ) || null
  );
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (!user.is_admin) redirect("/");
  return user;
}
export async function revokeCurrent() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) run("DELETE FROM device_sessions WHERE token_hash=?", hash(token));
}
export async function renewSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  const session = one<{
    created_at: number;
    expires_at: number;
    renewed_at: number;
  }>(
    "SELECT created_at,expires_at,renewed_at FROM device_sessions WHERE token_hash=? AND expires_at>?",
    hash(token),
    now(),
  );
  if (!session) return false;
  // Temporary sessions never become persistent during renewal.
  if (session.expires_at - session.created_at <= 86_400_000) return true;
  if (now() - session.renewed_at > 86_400_000) {
    const expires = now() + SESSION_MS;
    run(
      "UPDATE device_sessions SET expires_at=?,renewed_at=? WHERE token_hash=?",
      expires,
      now(),
      hash(token),
    );
    jar.set(COOKIE, token, cookieOptions(expires));
  }
  return true;
}
export function throttleLogin(key: string) {
  transaction(() => {
    const limit = one<{ attempts: number; reset_at: number }>(
      "SELECT * FROM auth_limits WHERE key=?",
      key,
    );
    if (limit && limit.reset_at > now() && limit.attempts >= 8)
      throw new Error("Too many attempts. Try again in 15 minutes.");
    run(
      "INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
      key,
      now() + 900_000,
      now(),
      now(),
    );
  });
}
export function deviceSessions(userId: string) {
  return all<{
    token_hash: string;
    label: string;
    created_at: number;
    expires_at: number;
  }>(
    "SELECT token_hash,label,created_at,expires_at FROM device_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC",
    userId,
    now(),
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const expected =
    process.env.STREAMVAULT_PUBLIC_ORIGIN ||
    `${url.protocol}//${request.headers.get("host") || url.host}`;
  return origin === expected;
}
