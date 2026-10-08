import Link from "next/link";
import { channelHref } from "@/lib/channel-slug";
import { ensureChannelSlug } from "@/lib/channels";
import { Description } from "@/components/description";
import { notFound, permanentRedirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { collection } from "@/lib/library";
import { Shell } from "@/components/shell";
import { VideoGrid } from "@/components/video-grid";
import { EngagementButton } from "@/components/engagement";
export default async function Channel({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  let requested = (await params).id;
  try {
    requested = decodeURIComponent(requested);
  } catch {
    notFound();
  }
  const tab = (await searchParams).tab === "shorts" ? "shorts" : "videos";
  const channel = one<{
    id: string;
    slug: string | null;
    name: string;
    description: string;
    banner_path: string | null;
    banner_url: string | null;
    avatar_path: string | null;
    avatar_url: string | null;
  }>("SELECT * FROM channels WHERE slug=? OR id=?", requested, requested);
  if (!channel) notFound();
  const id = channel.id;
  const slug = channel.slug || ensureChannelSlug(id, channel.name);
  if (requested !== slug)
    permanentRedirect(
      channelHref(slug) + (tab === "shorts" ? "?tab=shorts" : ""),
    );
  const items = collection(user.id, "channel", 0, id, tab);
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
        {channel.description && (
          <Description text={channel.description} chapters={[]} />
        )}
      </section>
      <nav className="feed-tabs" aria-label="Channel videos">
        <Link
          prefetch={false}
          href={channelHref(slug)}
          aria-current={tab === "videos" ? "page" : undefined}
        >
          Videos
        </Link>
        <Link
          prefetch={false}
          href={`${channelHref(slug)}?tab=shorts`}
          aria-current={tab === "shorts" ? "page" : undefined}
        >
          Shorts
        </Link>
      </nav>
      <VideoGrid
        key={tab}
        initial={items}
        initialNext={items.length === 24 ? 24 : null}
        endpoint={`/api/collection?kind=channel&channel=${encodeURIComponent(id)}&format=${tab}`}
      />
    </Shell>
  );
}
