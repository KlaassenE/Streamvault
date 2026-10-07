import { redirect } from "next/navigation";
import { Play } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { AuthForm } from "@/components/auth-form";
export default async function Login() {
  if (await currentUser()) redirect("/");
  const first = !one<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n;
  if (first) redirect("/register");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">
            <Play size={16} />
          </span>
          streamvault
        </div>
        <h1>Welcome back.</h1>
        <p className="muted">Your library is right where you left it.</p>
        <AuthForm
          registrationAllowed={
            one<{ value: string }>(
              "SELECT value FROM settings WHERE key='registration'",
            )?.value === "true"
          }
        />
      </section>
    </main>
  );
}
