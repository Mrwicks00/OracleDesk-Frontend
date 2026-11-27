import type { TraceFeedFilters } from "./feed-filters";
import { parseTraceFilters, serializeTraceFilters } from "./feed-params";

/** Saved trace-feed views, stored per wallet in this browser only. */
export interface SavedTraceView {
  id: string;
  name: string;
  /** Stored as the URL query, so a view is replayed exactly as the feed reads it. */
  query: string;
  createdAt: number;
}

export const MAX_SAVED_VIEWS = 20;
const NAME_MAX = 60;
const KEY_PREFIX = "oracledesk:trace-views:v1:";

export function savedViewsKey(wallet: string): string {
  return `${KEY_PREFIX}${wallet}`;
}

/** Validates stored entries; malformed ones are dropped rather than trusted. */
export function parseSavedViews(raw: unknown): SavedTraceView[] {
  if (!Array.isArray(raw)) return [];
  const views: SavedTraceView[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 64) continue;
    if (typeof entry.name !== "string" || entry.name.trim().length === 0) continue;
    if (typeof entry.query !== "string" || entry.query.length > 512) continue;
    if (typeof entry.createdAt !== "number" || !Number.isFinite(entry.createdAt)) continue;
    // Re-serialize so the stored query is always the canonical form.
    const query = serializeTraceFilters(parseTraceFilters(new URLSearchParams(entry.query)));
    views.push({ id: entry.id, name: entry.name.trim().slice(0, NAME_MAX), query, createdAt: entry.createdAt });
    if (views.length === MAX_SAVED_VIEWS) break;
  }
  return views;
}

export function loadSavedViews(wallet: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedTraceView[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(savedViewsKey(wallet));
    return raw ? parseSavedViews(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Returns false when storage refuses the write (quota, privacy mode). */
export function saveSavedViews(
  wallet: string,
  views: SavedTraceView[],
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(savedViewsKey(wallet), JSON.stringify(views.slice(0, MAX_SAVED_VIEWS)));
    return true;
  } catch {
    return false;
  }
}

export function createSavedView(name: string, filters: TraceFeedFilters, now: number = Date.now()): SavedTraceView {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, NAME_MAX),
    query: serializeTraceFilters(filters),
    createdAt: now,
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
