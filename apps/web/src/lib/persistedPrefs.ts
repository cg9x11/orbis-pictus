import { ModelOverridesSchema, type ModelOverrides } from "@flipbook/shared";

const STORAGE_KEY = "flipbook_model_settings:v1";

/**
 * The settings panel's choices. Same shape as the request's override block, so what is stored is
 * exactly what is sent — no mapping in between.
 *
 * Every field is optional and an absent one means "use whatever the server is configured with", so
 * an empty object reproduces the app's behaviour before the panel existed.
 */
export type ModelPrefs = ModelOverrides;

/** Reads the saved choices. Any problem — no storage, bad JSON, a shape from an older version —
 *  yields an empty object, which simply means "server defaults". Never throws. */
export function readModelPrefs(): ModelPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    // Validated rather than cast: a blob written by an older build (or edited by hand) must degrade
    // to server defaults instead of putting junk into every generate request.
    const parsed = ModelOverridesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function writeModelPrefs(prefs: ModelPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private browsing). The in-memory choice still works this session.
  }
}

/**
 * Drops fields the server must not receive, before they go into a request.
 *
 * `ModelOverridesSchema` now recovers from a bad field on its own, so this is no longer the only
 * thing standing between a zeroed input and a 400. It stays because it is the client's own
 * statement of what a valid choice is: a value this function drops is one the server would have
 * ignored anyway, so sending it only invites a silent disagreement about what is in effect.
 *
 * `Number.isInteger`, not `Number.isFinite`: `video_duration_seconds` is a positive INTEGER, and a
 * number input with no `step` happily yields `5.5`. Blank strings are dropped too, so an untouched
 * control is omitted and the server keeps its own default.
 */
export function pruneEmptyPrefs(prefs: ModelPrefs): ModelPrefs {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
    else if (typeof value === "number" && Number.isInteger(value) && value > 0) out[key] = value;
  }
  // Safe: every ModelOverrides field is an optional string or number, and only those survive above.
  return out as ModelPrefs;
}
