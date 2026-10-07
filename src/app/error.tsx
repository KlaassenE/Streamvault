"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="empty-state">
      <h1>Something went wrong.</h1>
      <p>
        Your library and watch state are still saved. Try loading this page
        again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
