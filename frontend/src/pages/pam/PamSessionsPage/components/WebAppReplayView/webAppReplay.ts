// Recorded web app sessions arrive as session events on the "web-app" channel (cli:
// packages/pam/handlers/webapp/recorder.go). A "frame" event's data is a base64 JPEG; an "action" event's data
// is base64 JSON describing a click, key, navigation, request, or block.

export const WEB_APP_CHANNEL = "web-app";

type RawEvent = { eventType?: string; channelType?: string; data?: string; elapsedTime?: number };

type RecordedAction = {
  kind: "mouse" | "key" | "navigate" | "request" | "blocked" | "nav" | "resize";
  action?: string;
  target?: string;
  key?: string;
  url?: string;
  method?: string;
  status?: number;
  error?: string;
  w?: number;
  h?: number;
};

export type ReplayFrame = { ms: number; data: string };

export type TimelineKind =
  | "click"
  | "keys"
  | "navigate"
  | "request"
  | "blocked"
  | "scroll"
  | "other";

export type TimelineEntry = { ms: number; kind: TimelineKind; label: string };

export const MASKED_KEY = "[MASKED]";

export const isWebAppEvent = (event: unknown) =>
  (event as RawEvent | null)?.channelType === WEB_APP_CHANNEL;

const KEY_GLYPHS: Record<string, string> = {
  Enter: " ⏎ ",
  Backspace: "⌫",
  Tab: " ⇥ ",
  Escape: " ⎋ "
};

// A run of masked keys shows as this one placeholder, however many keys were typed, so the replay doesn't
// reveal a password's length
const MASKED_PLACEHOLDER = "••••";

const describeKey = (key: string) => {
  if (key === MASKED_KEY) return MASKED_PLACEHOLDER;
  if (key.length === 1) return key;
  return KEY_GLYPHS[key] ?? "";
};

const describeAction = (a: RecordedAction): Omit<TimelineEntry, "ms"> | null => {
  switch (a.kind) {
    case "mouse":
      if (a.action === "down") return { kind: "click", label: `Clicked ${a.target || "the page"}` };
      if (a.action === "wheel") return { kind: "scroll", label: "Scrolled" };
      return null;
    case "navigate":
      return a.url ? { kind: "navigate", label: `Navigated to ${a.url}` } : null;
    case "request": {
      const outcome = a.status ? String(a.status) : a.error || "failed";
      return { kind: "request", label: `${a.method ?? "GET"} ${a.url} → ${outcome}` };
    }
    case "blocked":
      return { kind: "blocked", label: `Blocked ${a.url}` };
    case "nav":
      return { kind: "other", label: `Pressed ${a.action}` };
    case "resize":
      return { kind: "other", label: `Resized to ${a.w}×${a.h}` };
    default:
      return null;
  }
};

const decodeBase64Json = (data: string): RecordedAction | null => {
  try {
    return JSON.parse(atob(data)) as RecordedAction;
  } catch {
    return null;
  }
};

// Splits a recording into the frames to play and a readable timeline. Keystrokes in a row become one "Typed"
// entry, mouse moves are left out, and masked keys show as a fixed placeholder.
export const parseWebAppRecording = (events: unknown[]) => {
  const frames: ReplayFrame[] = [];
  const timeline: TimelineEntry[] = [];
  let typing: { ms: number; text: string } | null = null;

  const endTyping = () => {
    if (typing && typing.text.trim()) {
      timeline.push({ ms: typing.ms, kind: "keys", label: `Typed "${typing.text.trim()}"` });
    }
    typing = null;
  };

  events.forEach((event) => {
    const e = event as RawEvent;
    if (e?.channelType !== WEB_APP_CHANNEL || typeof e.data !== "string") return;
    const ms = Math.round((e.elapsedTime ?? 0) * 1000);

    if (e.eventType === "frame") {
      frames.push({ ms, data: e.data });
      return;
    }
    if (e.eventType !== "action") return;

    const action = decodeBase64Json(e.data);
    if (!action) return;

    if (action.kind === "key") {
      if (!typing) typing = { ms, text: "" };
      const described = describeKey(action.key ?? "");
      if (!(described === MASKED_PLACEHOLDER && typing.text.endsWith(MASKED_PLACEHOLDER))) {
        typing.text += described;
      }
      return;
    }
    if (action.kind === "mouse" && action.action === "move") return;

    endTyping();
    const described = describeAction(action);
    if (described) timeline.push({ ms, ...described });
  });
  endTyping();

  frames.sort((a, b) => a.ms - b.ms);
  timeline.sort((a, b) => a.ms - b.ms);
  return { frames, timeline };
};

// Index of the last item at or before ms, or -1 when ms precedes them all.
export const indexAtOrBefore = (items: { ms: number }[], ms: number) => {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid].ms <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

export const formatReplayTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
};
