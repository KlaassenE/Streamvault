export const INACTIVE_MEDIA_TIMEOUT_MS = 60 * 60 * 1000;
export function suspensionDelay(hiddenAt: number, currentTime: number) {
  return Math.max(
    0,
    INACTIVE_MEDIA_TIMEOUT_MS - Math.max(0, currentTime - hiddenAt),
  );
}

export function playbackStart(
  seconds: number,
  completed: boolean,
  duration: number,
  timestamp?: string,
) {
  const explicit =
    timestamp !== undefined &&
    timestamp.trim() !== "" &&
    Number.isFinite(Number(timestamp)) &&
    Number(timestamp) >= 0;
  const start = explicit ? Number(timestamp) : completed ? 0 : seconds;
  return {
    seconds: Math.max(0, duration > 0 ? Math.min(duration, start) : start),
    explicit,
  };
}
