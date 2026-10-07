import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { collection } from "@/lib/library";
import { Shell } from "@/components/shell";
import { VideoGrid } from "@/components/video-grid";
import { EngagementButton } from "@/components/engagement";
export default async function Channel({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const id = decodeURIComponent((await params).id);
  const channel = one<{
    id: string;
    name: string;
    description: string;
    banner_path: string | null;
    banner_url: string | null;
    avatar_path: string | null;
    avatar_url: string | null;
  }>("SELECT * FROM channels WHERE id=?", id);
  if (!channel) notFound();
  const items = collection(user.id, "channel", 0, id);
  const subscribed = !!one(
    "SELECT 1 FROM subscriptions WHERE user_id=? AND channel_id=?",
    user.id,
    id,
  );
  return (
    <Shell user={user}>
      <section className="channel-hero">
        {(channel.banner_path || channel.banner_url) && (
          <img
            className="channel-banner"
            src={
              channel.banner_path
                ? `/media/banner/${encodeURIComponent(id)}`
                : channel.banner_url!
            }
            referrerPolicy="no-referrer"
            alt=""
          />
        )}
        <div className="page-heading">
          <div className="channel-info">
            {(channel.avatar_path || channel.avatar_url) && (
              <img
                className="comment-avatar"
                src={
                  channel.avatar_path
                    ? `/media/avatar/${encodeURIComponent(id)}`
                    : channel.avatar_url!
                }
                alt=""
                referrerPolicy="no-referrer"
              />
            )}
            <h1>{channel.name}</h1>
          </div>
          <EngagementButton
            kind="subscribe"
            id={id}
            initial={subscribed}
            label="Subscribe"
            activeLabel="Subscribed"
          />
        </div>
        <p>{channel.description}</p>
      </section>
      <VideoGrid
        initial={items}
        initialNext={items.length === 24 ? 24 : null}
        endpoint={`/api/collection?kind=channel&channel=${encodeURIComponent(id)}`}
      />
    </Shell>
  );
}
