export function internalVideoId(value: string) {
  return value.startsWith("youtube:") ? value : `youtube:${value}`;
}
export function watchHref(id: string) {
  const value = id.startsWith("youtube:") ? id.slice(8) : id;
  return `/watch?v=${encodeURIComponent(value)}`;
}
