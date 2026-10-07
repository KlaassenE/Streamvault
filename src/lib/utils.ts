import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function duration(seconds: number) {
  const value = Math.floor(Math.max(0, seconds));
  return value >= 3600
    ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function relativeDate(timestamp: number | null) {
  if (!timestamp) return "Archived video";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  return days === 0
    ? "Today"
    : days === 1
      ? "Yesterday"
      : days < 30
        ? `${days} days ago`
        : days < 365
          ? `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? "" : "s"} ago`
          : `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? "" : "s"} ago`;
}
