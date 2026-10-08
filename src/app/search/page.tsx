import Link from "next/link";
import { channelHref } from "@/lib/channel-slug";
import { Avatar } from "@/components/avatar";
import { requireUser } from "@/lib/auth";
import { searchVideos, searchChannels } from "@/lib/library";
import { Shell } from "@/components/shell";
import { VideoGrid } from "@/components/video-grid";
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const query = ((await searchParams).q || "").slice(0, 200);
  const items = searchVideos(user.id, query);
  const channels = searchChannels(user.id, query);
  return (
    <Shell user={user}>
      <div className="page-heading">
        <div>
          <h1>Search your library</h1>
          <p>
            {query
              ? `Results for “${query}”`
              : "Search by title, description, or channel."}
          </p>
        </div>
      </div>
      {channels.length > 0 && (
        <section className="search-channels">
          <h2>Channels</h2>
          <div className="channel-list">
            {channels.map((channel) => (
              <Link
                className="channel-item search-channel"
                key={channel.id}
                prefetch={false}
                href={channelHref(channel.slug || channel.id)}
              >
                <Avatar
                  name={channel.name}
                  src={
                    channel.avatar_path
                      ? `/media/avatar/${encodeURIComponent(channel.id)}`
                      : channel.avatar_url
                  }
                />
                <div>
                  <h3>{channel.name}</h3>
                  <p className="muted small">{channel.video_count} videos</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <h2 className="search-video-heading">Videos</h2>
      <VideoGrid
        initial={items}
        initialNext={items.length === 24 ? 24 : null}
        endpoint={`/api/search?q=${encodeURIComponent(query)}`}
      />
    </Shell>
  );
}
