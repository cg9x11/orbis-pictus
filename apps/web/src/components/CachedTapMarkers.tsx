import type { CachedTap, TapDedupMode } from "@orbis/shared";

interface CachedTapMarkersProps {
  taps: CachedTap[];
  mode: TapDedupMode;
  /** Opens the already-generated child page. Never starts a generation. `reuse` mode only. */
  onOpen: (tap: CachedTap) => void;
  /** Opens the versions panel for an explored spot. Never starts a generation. `variant` mode only. */
  onInspect: (tap: CachedTap) => void;
  /** Markers are hidden mid-generation, when the image underneath no longer matches their coordinates. */
  hidden: boolean;
}

/**
 * Marks the spots on a page that have already been explored. What a marker MEANS depends on the
 * server's dedup mode, so the same dot is rendered with two different contracts:
 *
 * - `reuse`: a free shortcut. Clicking opens the existing child instantly and costs nothing, which
 *   is the whole point of showing it - without a marker the only way to discover that a tap is free
 *   is to make it. Rendered as a real button so that path is reachable by keyboard too.
 * - `variant`: a disclosure, not a shortcut. The spot is known, but a fresh draw costs money, so
 *   clicking opens the versions panel instead of drawing.
 *
 * Both are real buttons. An earlier version made the variant marker inert so the image beneath
 * would own the click, on the reasoning that the cache's tap radius is far wider than this dot and
 * the two must not diverge. They no longer can: the controller gates on the real radius, so a click
 * on the dot and a click anywhere inside the radius both open the panel. Making it inert bought
 * nothing and cost everything hover-driven - the label never expanded and the tooltip never fired,
 * leaving identical unlabelled dots the user could not identify without clicking.
 *
 * Positioned in the same normalized [0,1] space the tap cache stores, so a marker sits exactly where
 * the tap that created it landed.
 */
export function CachedTapMarkers({ taps, mode, onOpen, onInspect, hidden }: CachedTapMarkersProps) {
  if (hidden || mode === "off" || taps.length === 0) return null;

  const reuse = mode === "reuse";

  return (
    <div className="cached-taps">
      {taps.map((tap) => {
        // Two separate spots can legitimately lead to the same child (both halves of a bridge
        // resolving to "Roadway Deck"), so the destination alone is not a unique key - the point is.
        const key = `${tap.subject}:${tap.x},${tap.y}`;
        const count = tap.children.length;

        return (
          <button
            key={key}
            type="button"
            className={reuse ? "cached-tap" : "cached-tap cached-tap--variant"}
            style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }}
            title={
              reuse
                ? `Already explored: ${tap.subject} - opens instantly, generates nothing`
                : `Explored before: ${tap.subject} - ${count} version${count === 1 ? "" : "s"}. Opens a panel; nothing is drawn until you ask.`
            }
            onClick={(e) => {
              // The image beneath has its own click handler that would start a generation.
              e.stopPropagation();
              if (reuse) onOpen(tap);
              else onInspect(tap);
            }}
          >
            <span className="cached-tap-dot" aria-hidden="true" />
            <span className="cached-tap-label">{tap.subject}</span>
          </button>
        );
      })}
    </div>
  );
}
