import { RefObject, useEffect } from "react";

import { WebAppInput } from "./web-app-protocol";

const MOUSE_BUTTONS = ["left", "middle", "right"] as const;
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_DISTANCE = 5;
const RESIZE_DEBOUNCE_MS = 150;
const LINE_HEIGHT_PX = 16;

const modifiersOf = (e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) => (e.altKey ? 1 : 0) + (e.ctrlKey ? 2 : 0) + (e.metaKey ? 4 : 0) + (e.shiftKey ? 8 : 0);

// PointerEvent.buttons is a bitmask: 1 = left, 2 = right, 4 = middle
const heldButton = (buttons: number): "left" | "middle" | "right" | "none" => {
  if (buttons % 2 === 1) return "left";
  if (Math.floor(buttons / 4) % 2 === 1) return "middle";
  if (Math.floor(buttons / 2) % 2 === 1) return "right";
  return "none";
};

// The canvas is drawn at the remote page's size in CSS pixels and scaled to fit, so a pointer position maps
// back by the ratio between its intrinsic and on-screen sizes.
const toRemote = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
  const rect = canvas.getBoundingClientRect();
  if (!canvas.width || !rect.width || !rect.height) return null;
  return {
    x: ((clientX - rect.left) * canvas.width) / rect.width,
    y: ((clientY - rect.top) * canvas.height) / rect.height
  };
};

type Options = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  isLive: boolean;
  sendInput: (input: WebAppInput) => void;
};

export const useWebAppInput = ({ canvasRef, containerRef, isLive, sendInput }: Options) => {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isLive) return undefined;

    let pendingMove: WebAppInput | null = null;
    let moveFrame = 0;
    const flushMove = () => {
      moveFrame = 0;
      if (pendingMove) sendInput(pendingMove);
      pendingMove = null;
    };

    let lastDown = { time: 0, x: 0, y: 0, count: 0 };

    const onPointerMove = (e: PointerEvent) => {
      const point = toRemote(canvas, e.clientX, e.clientY);
      if (!point) return;
      const held = heldButton(e.buttons);
      pendingMove = {
        t: "mouse",
        kind: "move",
        ...point,
        button: held,
        clickCount: 0,
        modifiers: modifiersOf(e)
      };
      if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
    };

    const onPointerDown = (e: PointerEvent) => {
      const point = toRemote(canvas, e.clientX, e.clientY);
      const button = MOUSE_BUTTONS[e.button];
      if (!point || !button) return;
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      flushMove();

      const isRepeat =
        e.timeStamp - lastDown.time < MULTI_CLICK_MS &&
        Math.abs(point.x - lastDown.x) < MULTI_CLICK_DISTANCE &&
        Math.abs(point.y - lastDown.y) < MULTI_CLICK_DISTANCE;
      const count = isRepeat ? Math.min(lastDown.count + 1, 3) : 1;
      lastDown = { time: e.timeStamp, ...point, count };

      sendInput({
        t: "mouse",
        kind: "down",
        ...point,
        button,
        clickCount: count,
        modifiers: modifiersOf(e)
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      const point = toRemote(canvas, e.clientX, e.clientY);
      const button = MOUSE_BUTTONS[e.button];
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!point || !button) return;
      flushMove();
      sendInput({
        t: "mouse",
        kind: "up",
        ...point,
        button,
        clickCount: lastDown.count,
        modifiers: modifiersOf(e)
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const point = toRemote(canvas, e.clientX, e.clientY);
      if (!point) return;
      let scale = 1;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) scale = LINE_HEIGHT_PX;
      if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) scale = canvas.height;
      sendInput({ t: "wheel", ...point, dx: e.deltaX * scale, dy: e.deltaY * scale });
    };

    const onKey = (e: KeyboardEvent) => {
      // Keys go to the remote page while the viewer has focus, so the browser's own shortcuts don't fire.
      e.preventDefault();
      const isShortcut = e.ctrlKey || e.metaKey;
      let text = "";
      if (e.type === "keydown" && !isShortcut) {
        if (e.key.length === 1) text = e.key;
        else if (e.key === "Enter") text = "\r";
      }
      sendInput({
        t: "key",
        kind: e.type === "keydown" ? "down" : "up",
        key: e.key,
        code: e.code,
        text,
        modifiers: modifiersOf(e)
      });
    };

    const preventContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("keyup", onKey);
    canvas.addEventListener("contextmenu", preventContextMenu);
    canvas.focus();

    return () => {
      if (moveFrame) cancelAnimationFrame(moveFrame);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKey);
      canvas.removeEventListener("contextmenu", preventContextMenu);
    };
  }, [canvasRef, isLive, sendInput]);

  // The remote viewport follows the viewer's window, so the page renders at the size it's shown.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isLive) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const sendSize = () => {
      const { width, height } = container.getBoundingClientRect();
      sendInput({ t: "resize", w: Math.floor(width), h: Math.floor(height) });
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(sendSize, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);
    sendSize();

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [containerRef, isLive, sendInput]);
};
