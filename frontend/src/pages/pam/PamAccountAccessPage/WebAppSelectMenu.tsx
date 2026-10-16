import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SelectMenu } from "./web-app-protocol";

type Props = {
  menu: SelectMenu;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onChoose: (index: number) => void;
};

const MAX_MENU_HEIGHT = 320;

// Draws the remote page's <select> menu in the viewer, since headless Chrome renders its own menu in a popup
// the screencast doesn't capture. It sits under the select, scaled the way the canvas is.
export const WebAppSelectMenu = ({ menu, canvasRef, containerRef, onChoose }: Props) => {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [active, setActive] = useState(Math.max(menu.selected, 0));
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(
    null
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas?.width || !container) return;
    const canvasBox = canvas.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const scale = canvasBox.width / canvas.width;
    setPosition({
      left: canvasBox.left - containerBox.left + menu.rect.x * scale,
      top: canvasBox.top - containerBox.top + (menu.rect.y + menu.rect.h) * scale,
      width: Math.max(menu.rect.w * scale, 120)
    });
  }, [menu, canvasRef, containerRef]);

  useEffect(() => {
    listRef.current?.focus();
  }, [position]);

  const move = (step: number) => {
    let next = active;
    for (let i = 0; i < menu.options.length; i += 1) {
      next = (next + step + menu.options.length) % menu.options.length;
      if (!menu.options[next].disabled) break;
    }
    setActive(next);
  };

  if (!position) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 z-20 cursor-default"
        onClick={() => onChoose(-1)}
      />
      <ul
        ref={listRef}
        role="listbox"
        tabIndex={-1}
        aria-activedescendant={`web-app-option-${active}`}
        onKeyDown={(e) => {
          e.preventDefault();
          if (e.key === "ArrowDown") move(1);
          else if (e.key === "ArrowUp") move(-1);
          else if (e.key === "Enter" || e.key === " ") onChoose(active);
          else if (e.key === "Escape" || e.key === "Tab") onChoose(-1);
        }}
        className="absolute z-30 overflow-y-auto rounded-md border border-border bg-card py-1 text-sm shadow-lg outline-none"
        style={{ ...position, maxHeight: MAX_MENU_HEIGHT }}
      >
        {menu.options.map((option, index) => (
          <li
            key={`${option.label}-${index + 1}`}
            id={`web-app-option-${index}`}
            role="option"
            aria-selected={index === menu.selected}
            aria-disabled={option.disabled}
            onMouseEnter={() => !option.disabled && setActive(index)}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!option.disabled) onChoose(index);
            }}
            className={`cursor-pointer px-3 py-1 ${option.disabled ? "cursor-not-allowed text-muted" : ""} ${
              index === active ? "bg-foreground/10" : ""
            } ${index === menu.selected ? "font-medium" : ""}`}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </>
  );
};
