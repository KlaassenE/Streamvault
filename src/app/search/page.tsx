import { requireUser } from "@/lib/auth";
import { searchVideos } from "@/lib/library";
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
      <VideoGrid
        initial={items}
        initialNext={items.length === 24 ? 24 : null}
        endpoint={`/api/search?q=${encodeURIComponent(query)}`}
      />
    </Shell>
  );
}
