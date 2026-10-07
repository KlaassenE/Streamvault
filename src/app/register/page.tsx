import { redirect } from "next/navigation";
import { Play } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { AuthForm } from "@/components/auth-form";
export default async function Register() {
  if (await currentUser()) redirect("/");
  const first = !one<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n;
  const allowed =
    first ||
    one<{ value: string }>(
      "SELECT value FROM settings WHERE key='registration'",
    )?.value === "true";
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">
            <Play size={16} />
          </span>
          streamvault
        </div>
        <h1>{first ? "A home for your videos." : "Make yourself at home."}</h1>
        <p className="muted">
          {first
            ? "Create the administrator account to get started."
            : "Create an account for this library."}
        </p>
        {allowed ? (
          <AuthForm register first={first} />
        ) : (
          <p className="error-message">
            Account creation is turned off. The administrator can enable it in
            Settings → User management. <a href="/login">Back to sign in</a>
          </p>
        )}
      </section>
    </main>
  );
}
