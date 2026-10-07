"use client";
import { useActionState } from "react";
import { updateProfile, changePassword } from "@/app/actions";
import { Button } from "./ui/button";
import type { User } from "@/lib/types";
export function ProfileForm({ user }: { user: User }) {
  const [message, action, pending] = useActionState(updateProfile, null);
  return (
    <form action={action} className="form-stack">
      <label className="field">
        Name
        <input
          name="username"
          defaultValue={user.username}
          minLength={2}
          maxLength={40}
          required
        />
      </label>
      <label className="field">
        Email
        <input
          name="email"
          type="email"
          defaultValue={user.email}
          maxLength={200}
          required
        />
      </label>
      {message && (
        <p role="status" className="muted small">
          {message}
        </p>
      )}
      <div>
        <Button variant="outline" disabled={pending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}
export function PasswordForm() {
  const [message, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="form-stack">
      <label className="field">
        Current password
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="field">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
        />
      </label>
      <label className="field">
        Confirm new password
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
        />
      </label>
      {message && (
        <p className="error-message" role="alert">
          {message}
        </p>
      )}
      <p className="small muted">
        Changing your password signs out all devices.
      </p>
      <div>
        <Button variant="outline" disabled={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
