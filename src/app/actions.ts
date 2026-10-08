"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  COOKIE,
  hashPassword,
  checkPassword,
  registerUser,
  createDeviceSession,
  cookieOptions,
  requireUser,
  requireAdmin,
  revokeCurrent,
  throttleLogin,
} from "@/lib/auth";
import { one, run, transaction } from "@/lib/db";
export async function authenticate(
  mode: "login" | "register",
  previous: string | null,
  form: FormData,
): Promise<string | null> {
  let session;
  try {
    const email = String(form.get("email") || "")
      .trim()
      .toLowerCase();
    const password = String(form.get("password") || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
      throw new Error("Enter a valid email address.");
    if (password.length < 10 || password.length > 128)
      throw new Error("Use a password between 10 and 128 characters.");
    throttleLogin(email);
    let id: string;
    if (mode === "register") {
      id = registerUser("", email, await hashPassword(password));
    } else {
      const user = one<{ id: string; password_hash: string }>(
        "SELECT id,password_hash FROM users WHERE email=?",
        email,
      );
      if (!user || !(await checkPassword(password, user.password_hash)))
        throw new Error("Email or password is incorrect.");
      id = user.id;
      run("DELETE FROM auth_limits WHERE key=?", email);
    }
    session = createDeviceSession(id, "Personal device", false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed";
    return message.includes("UNIQUE")
      ? "That email or name is already in use."
      : message;
  }
  (await cookies()).set(
    COOKIE,
    session.token,
    cookieOptions(session.expires, session.temporary),
  );
  redirect("/");
}
export async function logout() {
  await revokeCurrent();
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
export async function updatePreferences(form: FormData) {
  const user = await requireUser();
  const allowed = [
    "appearance",
    "preferred_language",
    "autoplay",
    "auto_start",
    "single_playback",
    "resume_section",
  ];
  transaction(() => {
    for (const key of allowed) {
      const value = String(form.get(key) || "false").slice(0, 80);
      run(
        "INSERT OR REPLACE INTO preferences VALUES(?,?,?)",
        user.id,
        key,
        value,
      );
    }
  });
  (await cookies()).set(
    "streamvault_appearance",
    String(form.get("appearance") || "system"),
    { path: "/", sameSite: "lax", maxAge: 180 * 86400 },
  );
  revalidatePath("/settings");
}
export async function updateProfile(previous: string | null, form: FormData) {
  const user = await requireUser();
  try {
    const username = String(form.get("username") || "").trim();
    const email = String(form.get("email") || "")
      .trim()
      .toLowerCase();
    if (
      username.length < 2 ||
      username.length > 40 ||
      email.length > 200 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      throw new Error("Enter a valid name and email.");
    run(
      "UPDATE users SET username=?,email=? WHERE id=?",
      username,
      email,
      user.id,
    );
    revalidatePath("/settings");
    return "Profile saved.";
  } catch {
    return "Could not save. The name or email may already be in use.";
  }
}
export async function changePassword(previous: string | null, form: FormData) {
  const user = await requireUser();
  const old = one<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=?",
    user.id,
  )!;
  const password = String(form.get("password") || "");
  if (
    !(await checkPassword(String(form.get("current") || ""), old.password_hash))
  )
    return "Current password is incorrect.";
  if (
    password.length < 10 ||
    password.length > 128 ||
    password !== form.get("confirm")
  )
    return "Use matching passwords between 10 and 128 characters.";
  const passwordHash = await hashPassword(password);
  transaction(() => {
    run("UPDATE users SET password_hash=? WHERE id=?", passwordHash, user.id);
    run("DELETE FROM device_sessions WHERE user_id=?", user.id);
  });
  (await cookies()).delete(COOKIE);
  redirect("/login?changed=1");
}
export async function revokeSession(form: FormData) {
  const user = await requireUser();
  run(
    "DELETE FROM device_sessions WHERE user_id=? AND token_hash=?",
    user.id,
    String(form.get("token") || ""),
  );
  revalidatePath("/settings");
}
export async function adminSettings(form: FormData) {
  await requireAdmin();
  run(
    "INSERT OR REPLACE INTO settings VALUES('registration',?)",
    form.get("registration") === "on" ? "true" : "false",
  );
  revalidatePath("/admin");
}
export async function changeRole(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("userId") || "");
  if (id === admin.id) return;
  transaction(() => {
    const user = one<{ is_admin: number }>(
      "SELECT is_admin FROM users WHERE id=?",
      id,
    );
    if (!user) return;
    const count = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM users WHERE is_admin=1",
    )!.n;
    if (user.is_admin && count <= 1) return;
    run("UPDATE users SET is_admin=? WHERE id=?", user.is_admin ? 0 : 1, id);
  });
  revalidatePath("/admin");
}
