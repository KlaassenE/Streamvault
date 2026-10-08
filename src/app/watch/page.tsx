import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { notFound } from "next/navigation";
import { WatchPage } from "@/components/watch-page";
import { internalVideoId } from "@/lib/video-url";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ v?: string | string[] }>;
}): Promise<Metadata> {
  const user = await currentUser();
  const query = await searchParams;
  if (!user || typeof query.v !== "string") return {};
  const video = one<{ title: string }>(
    "SELECT title FROM videos WHERE id=? AND archived=0",
    internalVideoId(query.v),
  );
  return video ? { title: video.title } : {};
}
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
