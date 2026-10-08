export function slugBase(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "channel"
  );
}
export function channelHref(slug: string) {
  return `/channel/${encodeURIComponent(slug)}`;
}
