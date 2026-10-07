import { notFound, permanentRedirect } from "next/navigation";
import { watchHref } from "@/lib/video-url";
export default async function LegacyWatch({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let id = (await params).id;
  try {
    id = decodeURIComponent(id);
  } catch {
    notFound();
  }
  const href = watchHref(id);
  const query = await searchParams;
  const extra = new URLSearchParams();
  for (const key of ["t", "autoplay"]) {
    const value = query[key];
    if (typeof value === "string") extra.set(key, value);
  }
  permanentRedirect(href + (extra.size ? "&" + extra.toString() : ""));
}
