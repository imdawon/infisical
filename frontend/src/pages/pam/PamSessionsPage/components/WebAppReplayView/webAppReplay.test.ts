import { describe, expect, test } from "vitest";

import {
  formatReplayTime,
  indexAtOrBefore,
  MASKED_KEY,
  parseWebAppRecording
} from "./webAppReplay";

const action = (elapsedTime: number, payload: object) => ({
  eventType: "action",
  channelType: "web-app",
  elapsedTime,
  data: btoa(JSON.stringify(payload))
});
const frame = (elapsedTime: number) => ({
  eventType: "frame",
  channelType: "web-app",
  elapsedTime,
  data: btoa("jpeg")
});
const key = (elapsedTime: number, k: string) => action(elapsedTime, { kind: "key", key: k });

describe("parseWebAppRecording", () => {
  test("splits frames from a readable timeline", () => {
    const { frames, timeline } = parseWebAppRecording([
      frame(0.5),
      action(1, { kind: "navigate", url: "http://app/" }),
      action(2, { kind: "mouse", action: "move", x: 1, y: 1 }),
      action(2.5, { kind: "select", value: "high" }),
      action(3, { kind: "mouse", action: "down", target: 'button "Submit order"' }),
      action(3.1, { kind: "mouse", action: "up" }),
      action(3.2, { kind: "request", method: "POST", url: "http://app/orders", status: 303 }),
      action(4, { kind: "blocked", url: "https://example.com/" }),
      frame(4.5),
      { eventType: "input", channelType: "terminal", elapsedTime: 5, data: "ignored" }
    ]);

    expect(frames.map((f) => f.ms)).toEqual([500, 4500]);
    expect(timeline).toEqual([
      { ms: 1000, kind: "navigate", label: "Navigated to http://app/" },
      { ms: 2500, kind: "click", label: 'Chose "high"' },
      { ms: 3000, kind: "click", label: 'Clicked button "Submit order"' },
      { ms: 3200, kind: "request", label: "POST http://app/orders → 303" },
      { ms: 4000, kind: "blocked", label: "Blocked https://example.com/" }
    ]);
  });

  test("groups keystrokes into one entry and hides how many masked keys were typed", () => {
    const { timeline } = parseWebAppRecording([
      key(1, "b"),
      key(1.1, "o"),
      key(1.2, "b"),
      action(2, { kind: "mouse", action: "down", target: "password field" }),
      key(3, MASKED_KEY),
      key(3.1, MASKED_KEY),
      key(3.2, MASKED_KEY),
      key(3.3, "Enter")
    ]);

    expect(timeline.map((e) => e.label)).toEqual([
      'Typed "bob"',
      "Clicked password field",
      'Typed "•••• ⏎"'
    ]);
  });
});

describe("indexAtOrBefore", () => {
  const items = [{ ms: 0 }, { ms: 500 }, { ms: 1000 }];
  test("finds the frame showing at a moment in the replay", () => {
    expect(indexAtOrBefore(items, -1)).toBe(-1);
    expect(indexAtOrBefore(items, 0)).toBe(0);
    expect(indexAtOrBefore(items, 999)).toBe(1);
    expect(indexAtOrBefore(items, 5000)).toBe(2);
  });
});

test("formatReplayTime", () => {
  expect(formatReplayTime(0)).toBe("0:00");
  expect(formatReplayTime(72_400)).toBe("1:12");
});

test("keeps every pointer position, including moves, for drawing the cursor", () => {
  const { cursor, timeline } = parseWebAppRecording([
    action(1, { kind: "mouse", action: "move", x: 10, y: 20 }),
    action(2, { kind: "mouse", action: "down", x: 30, y: 40, target: "link" }),
    action(2.1, { kind: "mouse", action: "up", x: 30, y: 40 })
  ]);
  expect(cursor).toEqual([
    { ms: 1000, x: 10, y: 20, click: false },
    { ms: 2000, x: 30, y: 40, click: true },
    { ms: 2100, x: 30, y: 40, click: false }
  ]);
  expect(timeline.map((e) => e.label)).toEqual(["Clicked link"]);
});
