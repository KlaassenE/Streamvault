import { one, run } from "./db";
import { slugBase } from "./channel-slug";
export function ensureChannelSlug(id: string, name: string) {
  const existing = one<{ slug: string | null }>(
    "SELECT slug FROM channels WHERE id=?",
    id,
  )?.slug;
  if (existing) return existing;
  const base = slugBase(name);
  let slug = base,
    suffix = 2;
  while (one("SELECT id FROM channels WHERE slug=? AND id<>?", slug, id))
    slug = `${base}-${suffix++}`;
  run("UPDATE channels SET slug=? WHERE id=?", slug, id);
  return slug;
}
