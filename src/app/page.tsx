import Link from "next/link";
import { randomUUID } from "node:crypto";
import { FolderOpen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { feed, resumeVideos } from "@/lib/library";
import { Shell } from "@/components/shell";
import { HomeFeed } from "@/components/home-feed";
import { Button } from "@/components/ui/button";
export default async function Home() {
  const user = await requireUser();
  const seed = randomUUID();
  const initial = feed(user.id, seed);
  return (
    <Shell user={user}>
      {initial.items.length ? (
        <HomeFeed
          initial={initial}
          resume={resumeVideos(user.id)}
          seed={seed}
          resumeEnabled={
            one<{ value: string }>(
              "SELECT value FROM preferences WHERE user_id=? AND key='resume_section'",
              user.id,
            )?.value !== "false"
          }
        />
      ) : (
        <section className="empty-state">
          <FolderOpen size={40} />
          <h1>Your library starts here.</h1>
          <p>
            Point Streamvault at a folder containing your yt-dlp archive. Your
            original videos stay where they are.
          </p>
          {!!user.is_admin && (
            <Button asChild>
              <Link href="/library" prefetch={false}>
                Add a library folder
              </Link>
            </Button>
          )}
        </section>
      )}
    </Shell>
  );
}
