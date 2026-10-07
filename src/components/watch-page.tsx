import Link from "next/link";
import { playbackStart } from "@/lib/playback-policy";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { videoById } from "@/lib/library";
import type { Chapter, Subtitle } from "@/lib/types";
import { relativeDate } from "@/lib/utils";
import { Shell } from "@/components/shell";
import { WatchPlayer } from "@/components/watch-player";
import { Description } from "@/components/description";
import { EngagementButton, ShareButton } from "@/components/engagement";
import { RelatedVideos } from "@/components/related-videos";
import { LazyComments } from "@/components/lazy-comments";
export async function WatchPage({
  id,
  query,
}: {
  id: string;
  query: { t?: string; autoplay?: string };
}) {
  const user = await requireUser();
  const video = videoById(id, user.id);
  if (!video) notFound();
  const prefs = Object.fromEntries(
    all<{ key: string; value: string }>(
      "SELECT key,value FROM preferences WHERE user_id=?",
      user.id,
    ).map((x) => [x.key, x.value]),
  );
  const chapters = all<Chapter>(
    "SELECT start_time,end_time,title FROM chapters WHERE video_id=? ORDER BY start_time",
    id,
  );
  const subtitles = all<Subtitle>(
    "SELECT language FROM subtitles WHERE video_id=? ORDER BY language",
    id,
  );
  const progress = one<{ updated_at: number }>(
    "SELECT updated_at FROM watch_progress WHERE user_id=? AND video_id=?",
    user.id,
    id,
  );
  const start = playbackStart(
    video.seconds,
    !!video.completed,
    video.duration,
    query.t,
  );
  const preferred = subtitles.some(
    (s) => s.language === prefs.preferred_language,
  )
    ? prefs.preferred_language
    : subtitles.some((s) => s.language === "en")
      ? "en"
      : subtitles[0]?.language || "";
  return (
    <Shell user={user}>
      <div className="watch-page">
        <div className="watch-main">
          {video.available ? (
            <WatchPlayer
              key={video.id}
              player={{
                videoId: video.id,
                userId: user.id,
                title: video.title,
                length: video.duration,
                frameRate: video.fps || undefined,
                initialSeconds: start.seconds,
                autoStart:
                  prefs.auto_start === "true" || query.autoplay === "1",
                explicitStart: start.explicit,
                updatedAt: progress?.updated_at || 0,
                thumbnail: !!video.thumbnail,
                chapters,
                subtitles,
                preferredLanguage: preferred,
                backgroundAudio: prefs.background_audio === "true",
                singlePlayback: prefs.single_playback !== "false",
              }}
              autoplay={prefs.autoplay === "true"}
            />
          ) : (
            <div className="error-message">
              This file is unavailable. Reconnect the library drive and re-index
              its folder. Your comments and watch state are still saved.
            </div>
          )}
          <div className="watch-details">
            <h1 className="watch-title">{video.title}</h1>
            <div className="watch-meta">
              <div className="channel-info">
                <span className="avatar">{video.channel[0]}</span>
                <div>
                  <Link
                    href={`/channel/${encodeURIComponent(video.channel_id)}`}
                    prefetch={false}
                  >
                    {video.channel}
                  </Link>
                  <p className="muted small">
                    {relativeDate(video.published_at)}
                  </p>
                </div>
                <EngagementButton
                  key={video.channel_id}
                  iconOnly
                  kind="subscribe"
                  id={video.channel_id}
                  initial={!!video.subscribed}
                  label="Subscribe"
                  activeLabel="Subscribed"
                />
              </div>
              <div className="inline-actions">
                <EngagementButton
                  key={`like:${video.id}`}
                  iconOnly
                  kind="like"
                  id={video.id}
                  initial={!!video.liked}
                  label="Like"
                  activeLabel="Liked"
                  icon="like"
                />
                <EngagementButton
                  key={`save:${video.id}`}
                  iconOnly
                  kind="save"
                  id={video.id}
                  initial={!!video.saved}
                  label="Save"
                  activeLabel="Saved"
                  icon="save"
                />
                <ShareButton iconOnly />
              </div>
            </div>
            <Description
              text={
                video.description ||
                "No description was included in the archive."
              }
              chapters={chapters}
            />
          </div>
        </div>
        <RelatedVideos key={id} videoId={id} />
        <LazyComments key={video.id} videoId={video.id} />
      </div>
    </Shell>
  );
}
