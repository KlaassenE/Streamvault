import { requireAdmin } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { adminSettings, changeRole } from "@/app/actions";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
export default async function Admin() {
  const user = await requireAdmin();
  const accounts = all<User>(
    "SELECT id,username,email,is_admin FROM users ORDER BY created_at",
  );
  const stats = one<{
    videos: number;
    channels: number;
    watched: number;
    unavailable: number;
  }>(
    "SELECT (SELECT COUNT(*) FROM videos WHERE archived=0) AS videos,(SELECT COUNT(*) FROM channels) AS channels,(SELECT COALESCE(SUM(watched_seconds),0) FROM watch_sessions) AS watched,(SELECT COUNT(*) FROM videos WHERE archived=0 AND available=0) AS unavailable",
  )!;
  return (
    <Shell user={user} active="admin">
      <div className="page-heading">
        <div>
          <h1>User management</h1>
          <p>
            {stats.videos.toLocaleString()} videos · {stats.channels} channels ·{" "}
            {Math.round(stats.watched / 3600)} hours watched ·{" "}
            {stats.unavailable} unavailable files
          </p>
        </div>
      </div>
      <div className="stack-gap">
        <section className="settings-panel">
          <h2>Library access</h2>
          <p className="muted small">
            This library requires a signed-in account for pages and media.
          </p>
          <form action={adminSettings} className="form-stack">
            <label className="check-field">
              <input
                type="checkbox"
                name="registration"
                defaultChecked={
                  one<{ value: string }>(
                    "SELECT value FROM settings WHERE key='registration'",
                  )?.value === "true"
                }
              />
              Allow new accounts to register
            </label>
            <div>
              <Button variant="outline">Save access settings</Button>
            </div>
          </form>
        </section>
        <section className="settings-panel">
          <h2>Accounts</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{account.email}</td>
                    <td>{account.is_admin ? "Administrator" : "Member"}</td>
                    <td>
                      {account.id !== user.id && (
                        <form action={changeRole}>
                          <input
                            type="hidden"
                            name="userId"
                            value={account.id}
                          />
                          <Button variant="ghost" size="sm">
                            {account.is_admin
                              ? "Make member"
                              : "Make administrator"}
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Shell>
  );
}
