"use client";
import { useEffect, useRef, useState } from "react";

// ============================================================
// GLOBAL SAVE INDICATOR
// ------------------------------------------------------------
// A tiny pub/sub counter of in-flight write requests (saveRow / saveMultipleRows /
// deleteRow / …). db.ts bumps it around every mutating apiFetch; a full-screen
// overlay (SaveIndicatorOverlay) subscribes so the user always sees when an
// add / edit / delete is still on its way to the database and can't half-interact
// with a row mid-write.
//
// Background heals (the load-time scheduler rewrites, the C+P auto-approve effect)
// pass { background: true } and are NOT counted — they must never throw a blocking
// overlay in the user's face right after a page load.
// ============================================================

let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function beginSave(): void {
  pending += 1;
  emit();
}

export function endSave(): void {
  pending = Math.max(0, pending - 1);
  emit();
}

export function getPendingSaves(): number {
  return pending;
}

export function subscribeSaves(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Wrap a write promise so the global indicator counts it while it's in flight. */
export async function trackSave<T>(p: Promise<T>): Promise<T> {
  beginSave();
  try {
    return await p;
  } finally {
    endSave();
  }
}

// Don't flash the overlay for a save that finishes in a few dozen ms — only show it
// once a write has actually been slow for SHOW_DELAY_MS. Once shown, keep it up for
// at least MIN_VISIBLE_MS so a burst of quick saves doesn't strobe it on and off.
const SHOW_DELAY_MS = 220;
const MIN_VISIBLE_MS = 400;

export function useIsSaving(): boolean {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let shownAt = 0;

    const show = () => {
      showTimer = null;
      shownAt = Date.now();
      visibleRef.current = true;
      setVisible(true);
    };
    const hide = () => {
      hideTimer = null;
      visibleRef.current = false;
      setVisible(false);
    };

    const update = () => {
      const active = getPendingSaves() > 0;
      if (active) {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        if (!visibleRef.current && !showTimer) {
          showTimer = setTimeout(show, SHOW_DELAY_MS);
        }
      } else {
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
        }
        if (visibleRef.current && !hideTimer) {
          const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt));
          hideTimer = setTimeout(hide, wait);
        }
      }
    };

    const unsub = subscribeSaves(update);
    update();
    return () => {
      unsub();
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  return visible;
}
