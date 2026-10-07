import { notFound } from "next/navigation";
import { WatchPage } from "@/components/watch-page";
import { internalVideoId } from "@/lib/video-url";
export default async function Watch({
  searchParams,
}: {
  searchParams: Promise<{
    v?: string | string[];
    t?: string | string[];
    autoplay?: string | string[];
  }>;
}) {
  const query = await searchParams;
  if (typeof query.v !== "string" || !query.v.trim()) notFound();
  return (
    <WatchPage
      id={internalVideoId(query.v)}
      query={{
        t: typeof query.t === "string" ? query.t : undefined,
        autoplay:
          typeof query.autoplay === "string" ? query.autoplay : undefined,
      }}
    />
  );
}
