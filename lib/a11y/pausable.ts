"use client";

import { useCallback, useMemo, useState, type FocusEvent } from "react";

/**
 * Pause control for auto-updating regions (WCAG 2.2.2). A region is paused when
 * the user toggles it, when the saved "pause auto-updates" preference is on, or
 * while focus or the pointer is inside it, so content never moves under a
 * user who is reading or interacting with it.
 */
export function usePausable(options: { initiallyPaused?: boolean } = {}) {
  const [manual, setManual] = useState(options.initiallyPaused ?? false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const toggle = useCallback(() => setManual((value) => !value), []);

  const bind = useMemo(
    () => ({
      onFocus: () => setFocused(true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        // Keep paused while focus moves between controls inside the region.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    }),
    [],
  );

  return {
    /** Effective state: the region currently holds still. */
    paused: manual || focused || hovered,
    /** The user's explicit choice; drives the toggle's aria-pressed. */
    pressed: manual,
    toggle,
    /** Spread onto the region's element. */
    bind,
  };
}
