import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PauseIcon, PlayIcon, RotateCcwIcon, SearchIcon } from "lucide-react";

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

export const WebAppReplayView = ({ events, isStreaming = false }: Props) => {
  const { frames, timeline } = useMemo(() => parseWebAppRecording(events), [events]);
  const durationMs = Math.max(frames.at(-1)?.ms ?? 0, timeline.at(-1)?.ms ?? 0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  useEffect(() => {
    if (!isPlaying || activeEntry < 0) return;
    listRef.current
      ?.querySelector(`[data-entry="${activeEntry}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [isPlaying, activeEntry]);

  const seek = useCallback(
    (ms: number) => {
      setCurrentMs(ms);
      setIsPlaying(false);
    },
    [setCurrentMs]
  );

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

  const clickTicks = timeline.filter((e) => e.kind === "click" && durationMs > 0);
  const percent = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
          className="flex items-center justify-center overflow-hidden rounded-md border border-border bg-black"
        >
          <canvas ref={canvasRef} className="max-h-[60vh] max-w-full" />
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
          <div className="relative flex-1">
            <input
              type="range"
              min={0}
              max={durationMs}
              step={100}
              value={currentMs}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Replay position"
              className="relative z-10 w-full accent-foreground"
            />
            <div className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-1.5">
              {clickTicks.map((tick) => (
                <span
                  key={`tick-${tick.ms}-${tick.label}`}
                  className="absolute top-0 h-1.5 w-px bg-product-pam"
                  style={{ left: `${(tick.ms / durationMs) * 100}%` }}
                />
              ))}
            </div>
          </div>
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
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div className="h-full bg-foreground/60" style={{ width: `${percent}%` }} />
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
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
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
