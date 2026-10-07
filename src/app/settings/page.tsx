import { requireUser, deviceSessions } from "@/lib/auth";
import { all } from "@/lib/db";
import { logout, updatePreferences, revokeSession } from "@/app/actions";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { ProfileForm, PasswordForm } from "@/components/profile-forms";
export default async function Settings() {
  const user = await requireUser();
  const prefs = Object.fromEntries(
    all<{ key: string; value: string }>(
      "SELECT key,value FROM preferences WHERE user_id=?",
      user.id,
    ).map((x) => [x.key, x.value]),
  );
  return (
    <Shell user={user} active="settings">
      <div className="page-heading">
        <div>
          <h1>Make yourself at home.</h1>
          <p>Your account, playback preferences, and signed-in devices.</p>
        </div>
        <form action={logout}>
          <Button variant="outline">Sign out</Button>
        </form>
      </div>
      <div className="settings-grid">
        <section className="settings-panel">
          <h2>Playback and browsing</h2>
          <form action={updatePreferences} className="form-stack">
            <label className="field">
              Appearance
              <select
                name="appearance"
                defaultValue={prefs.appearance || "system"}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="field">
              Preferred subtitle language
              <input
                name="preferred_language"
                defaultValue={prefs.preferred_language || "en"}
                maxLength={30}
              />
            </label>
            {[
              ["auto_start", "Automatically play opened videos", false],
              ["autoplay", "Play the next video automatically", false],
              [
                "background_audio",
                "Keep audio playing in background tabs",
                false,
              ],
              [
                "single_playback",
                "Pause other Streamvault tabs when playing",
                true,
              ],
              [
                "resume_section",
                "Occasionally show the full resume section",
                true,
              ],
            ].map(([key, label, defaultValue]) => (
              <label className="check-field" key={String(key)}>
                <input
                  name={String(key)}
                  type="checkbox"
                  value="true"
                  defaultChecked={
                    prefs[String(key)]
                      ? prefs[String(key)] === "true"
                      : !!defaultValue
                  }
                />
                {label}
              </label>
            ))}
            <div>
              <Button>Save preferences</Button>
            </div>
          </form>
        </section>
        <section className="settings-panel">
          <h2>Profile</h2>
          <ProfileForm user={user} />
        </section>
        <section className="settings-panel">
          <h2>Signed-in devices</h2>
          <p className="muted small">
            Personal-device sessions last up to 180 days and renew when you use
            the library.
          </p>
          {deviceSessions(user.id).map((session) => (
            <div className="list-row" key={session.token_hash}>
              <div>
                <strong>{session.label}</strong>
                <p className="muted small">
                  Signed in {new Date(session.created_at).toLocaleDateString()}{" "}
                  · Expires {new Date(session.expires_at).toLocaleDateString()}
                </p>
              </div>
              <form action={revokeSession}>
                <input type="hidden" name="token" value={session.token_hash} />
                <Button variant="ghost" size="sm">
                  Revoke
                </Button>
              </form>
            </div>
          ))}
        </section>
        <section className="settings-panel">
          <h2>Password</h2>
          <PasswordForm />
        </section>
      </div>
    </Shell>
  );
}
