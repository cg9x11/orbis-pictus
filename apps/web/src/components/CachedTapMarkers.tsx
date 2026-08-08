import type { CachedTap } from "@flipbook/shared";

interface CachedTapMarkersProps {
  taps: CachedTap[];
  /** Opens the already-generated child page. Never starts a generation. */
  onOpen: (tap: CachedTap) => void;
  /** Markers are hidden mid-generation, when the image underneath no longer matches their coordinates. */
  hidden: boolean;
}

/**
 * Marks the spots on a page that have already been explored. These are pure navigation:
 * clicking one opens the existing child page instantly and costs nothing, which is the whole point
 * of showing them — without a marker the only way to discover that a tap is free is to make it.
 *
 * Rendered as real buttons rather than decoration so the reuse path is reachable by keyboard too,
 * and positioned in the same normalized [0,1] space the tap cache stores, so a marker sits exactly
 * where the tap that created it landed.
 */
export function CachedTapMarkers({ taps, onOpen, hidden }: CachedTapMarkersProps) {
  if (hidden || taps.length === 0) return null;

  return (
    <div className="cached-taps">
      {taps.map((tap) => (
        <button
          // Two separate spots can legitimately lead to the same child (both halves of a bridge
          // resolving to "Roadway Deck"), so the destination alone is not a unique key — the point
          // is. Each is kept as its own marker: either spot really is clickable and free.
          key={`${tap.child_id}:${tap.x},${tap.y}`}
          type="button"
          className="cached-tap"
          style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }}
          title={`Already explored: ${tap.subject} — opens instantly, generates nothing`}
          onClick={(e) => {
            // The image beneath has its own click handler that would start a generation.
            e.stopPropagation();
            onOpen(tap);
          }}
        >
          <span className="cached-tap-dot" aria-hidden="true" />
          <span className="cached-tap-label">{tap.subject}</span>
        </button>
      ))}
    </div>
  );
}
