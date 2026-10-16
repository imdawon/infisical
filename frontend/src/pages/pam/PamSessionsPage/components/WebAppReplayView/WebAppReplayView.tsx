import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExpandIcon,
  Loader2Icon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  ShrinkIcon
} from "lucide-react";

import { IconButton, InputGroup, InputGroupAddon, InputGroupInput } from "@app/components/v3";

import {
  formatReplayTime,
  indexAtOrBefore,
  parseWebAppRecording,
  TimelineKind
} from "./webAppReplay";

type Props = {
  events: unknown[];
  isStreaming?: boolean;
  // More chunks are still downloading; the replay plays what has arrived so far
  isLoading?: boolean;
};

// Click or drag anywhere on the track to seek; clicks are marked so busy moments are easy to find.
const Scrubber = ({
  currentMs,
  durationMs,
  ticks,
  onSeek
}: {
  currentMs: number;
  durationMs: number;
  ticks: number[];
  onSeek: (ms: number) => void;
}) => {
  const seekTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1);
    onSeek(fraction * durationMs);
  };
  const percent = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Replay position"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={Math.round(currentMs)}
      aria-valuetext={formatReplayTime(currentMs)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(currentMs + 5000, durationMs));
        if (e.key === "ArrowLeft") onSeek(Math.max(currentMs - 5000, 0));
      }}
      className="group relative flex h-5 flex-1 cursor-pointer touch-none items-center outline-none"
    >
      <div className="relative h-1.5 w-full rounded-full bg-foreground/15">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-product-pam"
          style={{ width: `${percent}%` }}
        />
        {ticks.map((ms) => (
          <span
            key={`tick-${ms}`}
            className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground/50"
            style={{ left: `${(ms / durationMs) * 100}%` }}
          />
        ))}
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow group-focus-visible:ring-2 group-focus-visible:ring-foreground/40"
          style={{ left: `${percent}%` }}
        />
      </div>
    </div>
  );
};

const FILTERS: { label: string; kinds: TimelineKind[] | null }[] = [
  { label: "All", kinds: null },
  { label: "Clicks", kinds: ["click"] },
  { label: "Keys", kinds: ["keys"] },
  { label: "Pages", kinds: ["navigate"] },
  { label: "Network", kinds: ["request"] },
  { label: "Blocked", kinds: ["blocked"] }
];

const KIND_STYLE: Record<TimelineKind, string> = {
  click: "text-product-pam",
  keys: "text-foreground",
  navigate: "text-success",
  request: "text-muted",
  blocked: "text-danger",
  scroll: "text-muted",
  other: "text-muted"
};

const SPEEDS = [1, 2, 4];

const base64ToBytes = (data: string) => {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

export const WebAppReplayView = ({ events, isStreaming = false, isLoading = false }: Props) => {
  const { frames, timeline } = useMemo(() => parseWebAppRecording(events), [events]);
  const durationMs = Math.max(frames.at(-1)?.ms ?? 0, timeline.at(-1)?.ms ?? 0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [currentMs, setCurrentMsState] = useState(0);
  const currentMsRef = useRef(0);
  const setCurrentMs = useCallback((ms: number) => {
    currentMsRef.current = ms;
    setCurrentMsState(ms);
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");

  const frameIndex = indexAtOrBefore(frames, currentMs);
  const activeEntry = indexAtOrBefore(timeline, currentMs);

  // Draw the frame showing at the current moment; a slow decode never paints over a later seek.
  useEffect(() => {
    const frame = frames[Math.max(frameIndex, 0)];
    const canvas = canvasRef.current;
    if (!frame || !canvas) return undefined;
    let cancelled = false;
    createImageBitmap(new Blob([base64ToBytes(frame.data)], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch(() => {
        // A frame that fails to decode is skipped; the next one replaces it.
      });
    return () => {
      cancelled = true;
    };
  }, [frames, frameIndex]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = Math.min(currentMsRef.current + (now - last) * speed, durationMs);
      last = now;
      setCurrentMs(next);
      if (next >= durationMs && !isStreaming) setIsPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, speed, durationMs, isStreaming, setCurrentMs]);

  const visibleEntries = useMemo(() => {
    const { kinds } = FILTERS[filter];
    const term = search.trim().toLowerCase();
    return timeline
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          (!kinds || kinds.includes(entry.kind)) &&
          (!term || entry.label.toLowerCase().includes(term))
      );
  }, [timeline, filter, search]);

  // Keep the current entry in view while playing, without fighting a user scrolling the list when paused.
  // Only the list itself scrolls: scrollIntoView would also scroll the sheet and pull the video out of view.
  useEffect(() => {
    const list = listRef.current;
    if (!isPlaying || activeEntry < 0 || !list) return;
    const row = list.querySelector<HTMLElement>(`[data-entry="${activeEntry}"]`);
    if (!row) return;
    const rowTop = row.offsetTop;
    if (rowTop < list.scrollTop) {
      list.scrollTop = rowTop;
    } else if (rowTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowTop + row.offsetHeight - list.clientHeight;
    }
  }, [isPlaying, activeEntry]);

  const seek = useCallback(
    (ms: number) => {
      setCurrentMs(ms);
      setIsPlaying(false);
    },
    [setCurrentMs]
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      playerRef.current?.requestFullscreen().catch(() => {});
    }
  };

  const togglePlay = () => {
    if (!isPlaying && currentMs >= durationMs) setCurrentMs(0);
    setIsPlaying((playing) => !playing);
  };

  if (frames.length === 0) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-muted">
        {isStreaming ? "Waiting for the first recorded frame…" : "No recording for this session."}
      </div>
    );
  }

  const clickTicks =
    durationMs > 0 ? timeline.filter((e) => e.kind === "click").map((e) => e.ms) : [];

  return (
    <div
      className={`grid gap-4 ${isExpanded ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}
    >
      <div
        ref={playerRef}
        className={`flex min-w-0 flex-col gap-3 ${isFullscreen ? "justify-center bg-black p-4" : ""}`}
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
          className={`relative flex items-center justify-center overflow-hidden rounded-md border border-border bg-black ${
            isFullscreen ? "min-h-0 flex-1" : ""
          }`}
        >
          <canvas
            ref={canvasRef}
            className={
              isFullscreen || isExpanded
                ? "max-h-[calc(100vh-6rem)] w-full object-contain"
                : "max-h-[60vh] max-w-full"
            }
          />
          {isLoading && (
            <span className="absolute top-2 right-2 flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-xs text-white">
              <Loader2Icon className="size-3 animate-spin" />
              Loading more…
            </span>
          )}
        </button>
        <div className="flex items-center gap-3">
          <IconButton
            variant="project"
            size="sm"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <Scrubber
            currentMs={currentMs}
            durationMs={durationMs}
            ticks={clickTicks}
            onSeek={seek}
          />
          <span className="font-mono text-xs text-muted tabular-nums">
            {formatReplayTime(currentMs)} / {formatReplayTime(durationMs)}
          </span>
          <div className="flex items-center gap-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                  speed === s
                    ? "bg-foreground/15 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <IconButton variant="ghost-muted" size="sm" onClick={() => seek(0)} aria-label="Restart">
            <RotateCcwIcon />
          </IconButton>
          {!isFullscreen && (
            <IconButton
              variant="ghost-muted"
              size="sm"
              onClick={() => setIsExpanded((v) => !v)}
              aria-label={
                isExpanded ? "Show timeline beside the video" : "Expand video to full width"
              }
            >
              {isExpanded ? <ShrinkIcon /> : <ExpandIcon />}
            </IconButton>
          )}
          <IconButton
            variant="ghost-muted"
            size="sm"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions…"
          />
        </InputGroup>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setFilter(i)}
              className={`rounded-md border px-2 py-0.5 text-xs ${
                filter === i
                  ? "border-foreground/30 bg-foreground/10 text-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div
          ref={listRef}
          className="relative max-h-[60vh] overflow-y-auto rounded-md border border-border"
        >
          {visibleEntries.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted">No matching actions.</p>
          ) : (
            visibleEntries.map(({ entry, index }) => (
              <button
                key={`${entry.ms}-${index}`}
                type="button"
                data-entry={index}
                onClick={() => seek(entry.ms)}
                className={`flex w-full items-start gap-2 border-b border-border px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-foreground/5 ${
                  index === activeEntry ? "bg-foreground/10" : ""
                }`}
              >
                <span className="shrink-0 font-mono text-muted tabular-nums">
                  {formatReplayTime(entry.ms)}
                </span>
                <span className={`min-w-0 break-words ${KIND_STYLE[entry.kind]}`}>
                  {entry.label}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default WebAppReplayView;
