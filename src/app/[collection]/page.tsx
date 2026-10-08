import Link from "next/link";
import { channelHref } from "@/lib/channel-slug";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { collection } from "@/lib/library";
import { Shell } from "@/components/shell";
import { VideoGrid } from "@/components/video-grid";
const labels: Record<string, [string, string]> = {
  history: [
    "Watch history",
    "Pick up where you left off, or revisit something good.",
  ],
  subscriptions: ["Subscriptions", "The latest from channels you follow."],
  saved: ["Watch later", "Good things, kept close."],
};
export default async function Collection({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const user = await requireUser();
  const kind = (await params).collection;
  if (!labels[kind]) notFound();
  const items = collection(user.id, kind);
  const channels =
    kind === "subscriptions"
      ? all<{ id: string; name: string; slug: string; n: number }>(
          "SELECT c.id,c.name,c.slug,(SELECT COUNT(*) FROM videos WHERE channel_id=c.id AND archived=0) AS n FROM channels c JOIN subscriptions s ON s.channel_id=c.id WHERE s.user_id=? ORDER BY c.name",
          user.id,
        )
      : [];
  return (
    <Shell user={user} active={kind}>
      <div className="page-heading">
        <div>
          <h1>{labels[kind][0]}</h1>
          <p>{labels[kind][1]}</p>
        </div>
      </div>
      {channels.length > 0 && (
        <div className="channel-list" style={{ marginBottom: 30 }}>
          {channels.map((c) => (
            <Link
              className="channel-item"
              href={channelHref(c.slug || c.id)}
              prefetch={false}
              key={c.id}
            >
              <h2>{c.name}</h2>
              <p>{c.n} videos</p>
            </Link>
          ))}
        </div>
      )}
      <VideoGrid
        initial={items}
        initialNext={items.length === 24 ? 24 : null}
        endpoint={`/api/collection?kind=${kind}`}
      />
    </Shell>
  );
}
