export function isShort(metadata: Record<string, unknown>, file: string) {
  if (typeof metadata.is_short === "boolean") return metadata.is_short;
  if (
    [metadata.original_url, metadata.webpage_url].some(
      (url) =>
        typeof url === "string" &&
        /(?:youtube\.com|youtu\.be)\/shorts\//i.test(url),
    )
  )
    return true;
  if (/(?:^|[\\/])shorts(?:[\\/]|$)/i.test(file)) return true;
  const width = Number(metadata.width),
    height = Number(metadata.height),
    duration = Number(metadata.duration);
  return duration > 0 && duration <= 180 && width > 0 && height >= width;
}
