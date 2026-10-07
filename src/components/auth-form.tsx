"use client";
import Link from "next/link";
import { useActionState } from "react";
import { authenticate } from "@/app/actions";
import { Button } from "./ui/button";
export function AuthForm({
  register = false,
  first = false,
  registrationAllowed = false,
}: {
  register?: boolean;
  first?: boolean;
  registrationAllowed?: boolean;
}) {
  const [message, action, pending] = useActionState(
    authenticate.bind(null, register ? "register" : "login"),
    null,
  );
  return (
    <>
      <form action={action} className="form-stack">
        <label className="field">
          Email
          <input
            name="email"
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            maxLength={200}
            required
          />
        </label>
        <label className="field">
          Password
          <input
            name="password"
            placeholder={register ? "Create a password" : "Your password"}
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
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
        <Button disabled={pending}>
          {pending
            ? "Please wait…"
            : first
              ? "Create your library"
              : register
                ? "Create account"
                : "Sign in"}
        </Button>
      </form>
      {!first && (
        <p className="small muted" style={{ marginTop: 22 }}>
          {register ? "Already have an account? " : "New to this library? "}
          <Link href={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create account"}
          </Link>
        </p>
      )}
    </>
  );
}
