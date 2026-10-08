"use client";
import { clientId } from "@/lib/client-id";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  PictureInPicture2,
  Captions,
  RotateCcw,
} from "lucide-react";
import type { Chapter, Subtitle } from "@/lib/types";
import { suspensionDelay } from "@/lib/playback-policy";
import { duration } from "@/lib/utils";
type Props = {
  videoId: string;
  userId: string;
  title: string;
  length: number;
  frameRate?: number;
  initialSeconds: number;
  updatedAt: number;
  thumbnail: boolean;
  chapters: Chapter[];
  subtitles: Subtitle[];
  preferredLanguage: string;
  singlePlayback: boolean;
  autoStart?: boolean;
  explicitStart?: boolean;
  onComplete?: () => void;
};
type Checkpoint = {
  videoId: string;
  seconds: number;
  completed: boolean;
  clientAt: number;
  sessionId: string;
  watchedSeconds: number;
};
export function Player(props: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [attached, setAttached] = useState(false);
  const [animation, setAnimation] = useState<{
    kind: string;
    id: number;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(props.initialSeconds);
  const [length, setLength] = useState(props.length);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [controls, setControls] = useState(true);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [captions, setCaptions] = useState(false);
  const [language, setLanguage] = useState(props.preferredLanguage);
  const hiddenAt = useRef(0);
  const captionChoice = useRef({ captions, language });
  captionChoice.current = { captions, language };
  const ended = useRef(false);
  const lastSeek = useRef<number | null>(null);
  const resume = useRef(props.initialSeconds);
  const wanted = useRef(false);
  const session = useRef("");
  const watched = useRef(0);
  const lastTick = useRef<{ wall: number; media: number } | null>(null);
  const lastSave = useRef(0);
  const spaceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const spacePressed = useRef(false);
  const beforeRate = useRef(1);
  const suspendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const storageKey = `streamvault-progress:${props.userId}:${props.videoId}`;
  const save = useCallback(
    (completed = false, beacon = false) => {
      const v = video.current;
      if (!v || !session.current) return;
      const seconds =
        Number.isFinite(v.currentTime) &&
        v.readyState > 0 &&
        v.getAttribute("src")
          ? v.currentTime
          : resume.current;
      const payload: Checkpoint = {
        videoId: props.videoId,
        seconds,
        completed: completed || ended.current,
        clientAt: Date.now(),
        sessionId: session.current,
        watchedSeconds: watched.current,
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {}
      lastSave.current = Date.now();
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/progress",
          new Blob([JSON.stringify(payload)], { type: "application/json" }),
        );
        return;
      }
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      })
        .then(async (response) => {
          if (!response.ok)
            setStatus(
              response.status === 401
                ? "Sign in again to sync your progress."
                : "Progress saved on this device. Server sync will retry.",
            );
          else setStatus("");
        })
        .catch(() =>
          setStatus("Progress saved on this device. Server sync will retry."),
        );
    },
    [props.videoId, storageKey],
  );
  const selectTracks = useCallback(() => {
    const v = video.current;
    if (!v) return;
    for (const track of Array.from(v.textTracks))
      track.mode =
        captions && track.language === language ? "showing" : "disabled";
  }, [captions, language]);
  useEffect(selectTracks, [selectTracks, attached]);
  const attach = useCallback(
    (autoplay = false) => {
      const v = video.current;
      if (!v) return;
      wanted.current = autoplay;
      setStatus("");
      if (!v.getAttribute("src")) {
        setError("");
        setAttached(true);
        v.src = `/media/video/${encodeURIComponent(props.videoId)}`;
        v.preload = "metadata";
        v.load();
      } else if (autoplay)
        void v.play().catch(() => {
          wanted.current = false;
          setPlaying(false);
        });
    },
    [props.videoId],
  );
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (!v.getAttribute("src")) attach(true);
    else if (v.paused)
      void v.play().catch(() => setStatus("Press Play to start playback."));
    else {
      wanted.current = false;
      v.pause();
    }
  }, [attach]);
  const seek = useCallback(
    (seconds: number, remember = true) => {
      const v = video.current;
      if (!v) return;
      const limit = Number.isFinite(v.duration)
        ? v.duration
        : latest.current.length;
      const target = Math.max(0, Math.min(limit || seconds, seconds));
      ended.current = false;
      if (remember)
        lastSeek.current =
          v.readyState > 0 && v.getAttribute("src")
            ? v.currentTime
            : resume.current;
      resume.current = target;
      lastTick.current = null;
      setTime(target);
      if (!v.getAttribute("src")) {
        attach(false);
      } else if (v.readyState > 0) v.currentTime = target;
      if (v.readyState > 0 && v.getAttribute("src")) save();
    },
    [attach, save],
  );
  const undo = useCallback(() => {
    if (lastSeek.current === null) return;
    const v = video.current;
    const previous = lastSeek.current;
    lastSeek.current =
      v && v.readyState > 0 && v.getAttribute("src")
        ? v.currentTime
        : resume.current;
    seek(previous, false);
  }, [seek]);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen().catch(() => {});
  };
  const reveal = () => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (video.current && !video.current.paused)
      hideTimer.current = setTimeout(() => {
        if (!shell.current?.querySelector(".player-options[open]"))
          setControls(false);
      }, 2500);
  };
  useEffect(() => {
    session.current = clientId();
    try {
      const checkpoint = JSON.parse(
        localStorage.getItem(storageKey) || "null",
      ) as Checkpoint | null;
      if (
        !props.explicitStart &&
        checkpoint &&
        checkpoint.clientAt > props.updatedAt &&
        !checkpoint.completed &&
        Number.isFinite(checkpoint.seconds)
      ) {
        resume.current = checkpoint.seconds;
        setTime(checkpoint.seconds);
      }
      const preferred = localStorage.getItem("streamvault-player-settings");
      if (preferred) {
        const settings = JSON.parse(preferred);
        if (video.current) {
          video.current.volume = Math.max(
            0,
            Math.min(1, Number.isFinite(settings.volume) ? settings.volume : 1),
          );
          video.current.playbackRate = [
            0.25, 0.5, 0.75, 1, 1.25, 1.5, 2,
          ].includes(settings.rate)
            ? settings.rate
            : 1;
          setRate(video.current.playbackRate);
        }
      }
    } catch {}
    const v = video.current!;
    const onMetadata = () => {
      if (held.current) v.playbackRate = 2;
      setLength(Number.isFinite(v.duration) ? v.duration : props.length);
      if (resume.current > 0 && resume.current < (v.duration || props.length))
        v.currentTime = resume.current;
      for (const track of Array.from(v.textTracks))
        track.mode =
          captionChoice.current.captions &&
          track.language === captionChoice.current.language
            ? "showing"
            : "disabled";
      if (wanted.current)
        void v.play().catch(() => {
          wanted.current = false;
          setStatus("Press Play to start playback.");
        });
    };
    const onTime = () => {
      setTime(v.currentTime);
      resume.current = v.currentTime;
      const tick = lastTick.current;
      const wall = performance.now();
      if (tick && !v.paused && !v.seeking) {
        const delta = v.currentTime - tick.media;
        if (delta > 0 && delta < v.playbackRate * 12)
          watched.current += Math.min(
            (wall - tick.wall) / 1000,
            delta / v.playbackRate,
            12,
          );
      }
      lastTick.current = { wall, media: v.currentTime };
      if (Date.now() - lastSave.current >= 10000 && !v.paused) save();
    };
    const onPlay = () => {
      ended.current = false;
      setPlaying(true);
      setAnimation({ kind: "play", id: Date.now() });
      wanted.current = true;
      lastTick.current = null;
      channel.current?.postMessage({ type: "play", session: session.current });
      reveal();
    };
    const onPause = () => {
      setPlaying(false);
      wanted.current = false;
      if (!document.hidden) setAnimation({ kind: "pause", id: Date.now() });
      setControls(true);
      lastTick.current = null;
      save();
      if (document.hidden && document.pictureInPictureElement !== v) {
        if (suspendTimer.current) clearTimeout(suspendTimer.current);
        suspendTimer.current = setTimeout(
          suspend,
          suspensionDelay(hiddenAt.current || Date.now(), Date.now()),
        );
      }
    };
    const onEnd = () => {
      ended.current = true;
      wanted.current = false;
      save(true);
      setPlaying(false);
      setControls(true);
      latest.current.onComplete?.();
    };
    const onError = () => {
      setError(
        "This file could not be played. It may be unavailable or use a codec your browser does not support. A compatibility copy can be prepared on the server.",
      );
      setPlaying(false);
    };
    const onVolume = () => {
      setMuted(v.muted || v.volume === 0);
      try {
        localStorage.setItem(
          "streamvault-player-settings",
          JSON.stringify({
            volume: v.volume,
            rate: held.current ? beforeRate.current : v.playbackRate,
          }),
        );
      } catch {}
    };
    v.addEventListener("volumechange", onVolume);
    const onSeeking = () => {
      lastTick.current = null;
    };
    const onSeeked = () => save();
    v.addEventListener("loadedmetadata", onMetadata);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    v.addEventListener("error", onError);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", onSeeked);
    const suspend = () => {
      if (
        !document.hidden ||
        !v.paused ||
        document.pictureInPictureElement === v ||
        !v.getAttribute("src")
      )
        return;
      resume.current = v.currentTime;
      save(false, true);
      v.pause();
      v.removeAttribute("src");
      v.load();
      setAttached(false);
      setStatus("Playback suspended. Your position is saved.");
    };
    const releaseSpace = () => {
      spacePressed.current = false;
      if (spaceTimer.current) clearTimeout(spaceTimer.current);
      spaceTimer.current = null;
      if (held.current) {
        v.playbackRate = beforeRate.current;
        held.current = false;
        setRate(v.playbackRate);
      }
    };
    const visibility = () => {
      releaseSpace();
      if (suspendTimer.current) clearTimeout(suspendTimer.current);
      if (document.hidden) {
        hiddenAt.current = Date.now();
        save(false, true);
        if (v.paused && document.pictureInPictureElement !== v) {
          suspendTimer.current = setTimeout(
            suspend,
            suspensionDelay(hiddenAt.current || Date.now(), Date.now()),
          );
        }
      } else {
        hiddenAt.current = 0;
        if (!v.getAttribute("src") && wanted.current) attach(true);
        else if (wanted.current && v.paused) void v.play().catch(() => {});
      }
    };
    const pagehide = () => save(false, true);
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input:not([type=range]),textarea,select,[contenteditable=true],[role=dialog],.player-options[open]",
        ) ||
        (target.closest("button,a,summary") && !shell.current?.contains(target))
      )
        return;
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          undo();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (event.repeat || spacePressed.current) return;
        spacePressed.current = true;
        spaceTimer.current = setTimeout(() => {
          held.current = true;
          beforeRate.current = v.playbackRate;
          v.playbackRate = 2;
          setRate(2);
          if (v.paused) {
            if (!v.getAttribute("src")) attach(true);
            else void v.play().catch(() => {});
          }
        }, 300);
        return;
      }
      if (event.key === "," || event.key === ".") {
        event.preventDefault();
        wanted.current = false;
        v.pause();
        const fps = latest.current.frameRate || 30;
        const position =
          v.readyState > 0 && v.getAttribute("src")
            ? v.currentTime
            : resume.current;
        seek(position + (event.key === "." ? 1 : -1) / fps);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        seek(
          (v.readyState > 0 && v.getAttribute("src")
            ? v.currentTime
            : resume.current) + (event.key === "ArrowRight" ? 5 : -5),
        );
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        v.volume = Math.max(
          0,
          Math.min(1, v.volume + (event.key === "ArrowUp" ? 0.1 : -0.1)),
        );
      } else if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        seek(((v.duration || props.length) * Number(event.key)) / 10);
      } else if (event.key.toLowerCase() === "m") {
        v.muted = !v.muted;
        setMuted(v.muted);
      } else if (event.key.toLowerCase() === "f") fullscreen();
      else if (event.key.toLowerCase() === "c") setCaptions((value) => !value);
      else if (event.key === "/") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(".search-field input")
          ?.focus();
      }
      reveal();
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== " ") return;
      if (!spacePressed.current) return;
      event.preventDefault();
      const wasHeld = held.current;
      releaseSpace();
      if (!wasHeld) toggle();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("blur", releaseSpace);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    const chapterEvent = (event: Event) =>
      seek((event as CustomEvent<number>).detail);
    window.addEventListener("streamvault:seek", chapterEvent);
    if (globalThis.BroadcastChannel) {
      channel.current = new BroadcastChannel("streamvault-playback");
      channel.current.onmessage = (event) => {
        if (
          latest.current.singlePlayback &&
          event.data?.type === "play" &&
          event.data.session !== session.current
        ) {
          wanted.current = false;
          v.pause();
        }
      };
    }
    if (props.autoStart && !document.hidden) attach(true);
    return () => {
      save(false, true);
      releaseSpace();
      if (suspendTimer.current) clearTimeout(suspendTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      channel.current?.close();
      v.removeEventListener("loadedmetadata", onMetadata);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("volumechange", onVolume);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("error", onError);
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", onSeeked);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("blur", releaseSpace);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("streamvault:seek", chapterEvent);
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
    // This lifecycle deliberately owns one media element for one video. Changing controls does not reconnect it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.videoId]);
  function closeOptions(button: HTMLButtonElement) {
    const menu = button.closest("details");
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  }
  function changeRate(value: number) {
    setRate(value);
    if (video.current) {
      video.current.playbackRate = value;
      try {
        localStorage.setItem(
          "streamvault-player-settings",
          JSON.stringify({ volume: video.current.volume, rate: value }),
        );
      } catch {}
    }
  }
  return (
    <div
      ref={shell}
      className="player-shell"
      onMouseMove={reveal}
      onPointerDown={reveal}
      onDoubleClick={fullscreen}
    >
      <video
        ref={video}
        preload="none"
        playsInline
        aria-label={props.title}
        onClick={toggle}
      >
        {attached &&
          props.subtitles.map((track) => (
            <track
              key={track.language}
              kind="subtitles"
              label={track.language}
              srcLang={track.language}
              src={`/media/subtitle/${encodeURIComponent(props.videoId)}?language=${encodeURIComponent(track.language)}`}
            />
          ))}
      </video>
      {!attached && !error && (
        <div className="player-placeholder">
          {props.thumbnail && (
            <img
              src={`/media/thumbnail/${encodeURIComponent(props.videoId)}`}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
          <button
            className="player-start"
            aria-label={time > 0 ? `Resume from ${duration(time)}` : "Play"}
            onClick={toggle}
          >
            <Play size={42} fill="currentColor" />
          </button>
        </div>
      )}
      {animation && attached && (
        <div
          key={animation.id}
          className="playback-animation"
          aria-hidden="true"
        >
          {animation.kind === "play" ? (
            <Play size={42} fill="currentColor" />
          ) : (
            <Pause size={42} fill="currentColor" />
          )}
        </div>
      )}
      {error && (
        <div className="player-error" role="alert">
          <p>{error}</p>
          <button
            className="player-start"
            onClick={() => {
              video.current?.removeAttribute("src");
              attach(true);
            }}
          >
            <RotateCcw size={18} />
            Try again
          </button>
        </div>
      )}
      {status && (
        <div className="player-status" role="status">
          {status}
        </div>
      )}
      {attached && !error && (
        <div
          className="player-controls"
          hidden={
            !controls &&
            playing &&
            !shell.current?.querySelector(".player-options[open]")
          }
        >
          <input
            aria-label="Video timeline"
            type="range"
            min={0}
            max={length || 1}
            step={0.1}
            value={Math.min(time, length || 1)}
            onPointerDown={() => {
              lastSeek.current = video.current?.currentTime || 0;
            }}
            onChange={(event) => seek(Number(event.target.value), false)}
          />
          <div className="player-control-row">
            <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={19} /> : <Play size={19} />}
            </button>
            <button
              className="player-volume"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => {
                if (video.current) {
                  if (video.current.volume === 0) video.current.volume = 1;
                  video.current.muted = !muted;
                  setMuted(video.current.muted);
                }
              }}
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <span className="player-time">
              {duration(time)} / {duration(length)}
            </span>
            <span className="spacer" />
            {props.subtitles.length > 0 && (
              <details
                className="player-options player-captions"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    event.currentTarget.open = false;
                }}
                onToggle={reveal}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary
                  aria-label="Captions"
                  className={captions ? "captions-enabled" : undefined}
                >
                  <Captions size={19} />
                </summary>
                <div
                  className="player-options-panel"
                  role="group"
                  aria-label="Caption languages"
                >
                  <strong>Captions</strong>
                  <div className="caption-options">
                    <button
                      aria-pressed={!captions}
                      onClick={(event) => {
                        setCaptions(false);
                        closeOptions(event.currentTarget);
                      }}
                    >
                      Off
                    </button>
                    {props.subtitles.map((track) => (
                      <button
                        key={track.language}
                        aria-pressed={captions && language === track.language}
                        onClick={(event) => {
                          setLanguage(track.language);
                          setCaptions(true);
                          closeOptions(event.currentTarget);
                        }}
                      >
                        {track.language}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            )}
            <details
              className="player-options"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.open = false;
              }}
              onToggle={reveal}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <summary aria-label="Playback speed">{rate}×</summary>
              <div
                className="player-options-panel"
                role="group"
                aria-label="Playback speed options"
              >
                <strong>Playback speed</strong>
                <div className="speed-options">
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                    <button
                      key={value}
                      aria-pressed={rate === value}
                      onClick={(event) => {
                        changeRate(value);
                        closeOptions(event.currentTarget);
                      }}
                    >
                      {value === 1 ? "Normal" : `${value}×`}
                    </button>
                  ))}
                </div>
              </div>
            </details>
            <button
              aria-label="Picture in picture"
              onClick={() => {
                const v = video.current;
                if (v && document.pictureInPictureEnabled)
                  void (
                    document.pictureInPictureElement
                      ? document.exitPictureInPicture()
                      : v.requestPictureInPicture()
                  ).catch(() => {});
              }}
            >
              <PictureInPicture2 size={18} />
            </button>
            <button aria-label="Fullscreen" onClick={fullscreen}>
              <Maximize size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function ChapterButtons({ chapters }: { chapters: Chapter[] }) {
  return (
    <div className="chapter-list">
      {chapters.map((chapter) => (
        <button
          key={chapter.start_time}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("streamvault:seek", {
                detail: chapter.start_time,
              }),
            )
          }
        >
          {duration(chapter.start_time)} {chapter.title}
        </button>
      ))}
    </div>
  );
}
