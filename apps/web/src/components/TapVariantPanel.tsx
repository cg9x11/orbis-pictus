import { useEffect, useRef } from "react";
import type { CachedTap } from "@orbis/shared";

interface TapVariantPanelProps {
  tap: CachedTap;
  /** Opens one of the existing versions. This action costs nothing. */
  onOpen: (childId: string) => void;
  /** Draws a new version of this subject. This action spends real quota, so it is never the
   *  default action. */
  onDrawNew: (tap: CachedTap) => void;
  onClose: () => void;
  /** True while a generation already runs. The panel refuses both actions during that time, and
   *  it must say so. If it stays silent, every click does nothing and the panel looks frozen. */
  busy: boolean;
}

/**
 * The panel appears when a tap lands on an already-explored spot and the server is in `variant`
 * mode.
 *
 * That tap is ambiguous in a way that a `reuse`-mode tap is not. The subject is known, so the
 * vision call is free. The drawing is not free. There can also be several earlier versions of the
 * same subject, and none of them is the "right" one to open. The panel does not guess. It gives
 * the choice to the user before it spends anything.
 */
export function TapVariantPanel({ tap, onOpen, onDrawNew, onClose, busy }: TapVariantPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // The effect below reads `onClose` through a ref, so it can depend on nothing. React rebuilds
  // `onClose` on every controller render, and the controller re-renders often while the panel is
  // open (the tap ripple clears after ~600ms, the idle-loop video polls). An effect with
  // `onClose` in its dependency list re-runs on each of those renders. Each re-run pulls focus
  // back to the close button in the middle of an interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The panel interrupts a tap, so Escape must undo that interruption. Without Escape, the only
  // way out is the close button. A user who tapped by accident is then stuck with a decision that
  // they did not ask for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // This effect runs on mount only. The focus hand-off into the panel happens one time. It must
  // not repeat whenever the parent renders.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Sort newest first. The most recent version is the one that the user most likely wants to see
  // again.
  const versions = [...tap.children].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="tap-panel-backdrop" onClick={onClose}>
      <div
        className="tap-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Versions of ${tap.subject}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tap-panel-header">
          <div>
            <p className="tap-panel-eyebrow">Explored before</p>
            <h2 className="tap-panel-title">{tap.subject}</h2>
          </div>
          <button ref={closeRef} type="button" className="tap-panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <ul className="tap-panel-list">
          {versions.map((child, index) => (
            <li key={child.id}>
              <button type="button" className="tap-panel-version" disabled={busy} onClick={() => onOpen(child.id)}>
                {child.image_url ? (
                  <img className="tap-panel-thumb" src={child.image_url} alt="" loading="lazy" />
                ) : (
                  // The child exists, but it was drawn at another aspect ratio, so it has no image
                  // for this ratio yet. The list keeps it as a placeholder. The child still opens,
                  // and the server fills in the missing variant on demand.
                  <span className="tap-panel-thumb tap-panel-thumb--empty" aria-hidden="true" />
                )}
                <span className="tap-panel-version-text">
                  <span className="tap-panel-version-title">{child.page_title}</span>
                  <span className="tap-panel-version-meta">
                    {index === 0 ? "Newest" : `Version ${versions.length - index}`} · opens instantly
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="tap-panel-actions">
          <button type="button" className="tap-panel-draw" disabled={busy} onClick={() => onDrawNew(tap)}>
            Draw a new version
          </button>
          <p className="tap-panel-note">
            {busy
              ? "A page is being generated. Wait for it to finish before opening or drawing anything here."
              : "Drawing a new version generates a fresh image and uses quota."}
          </p>
        </div>
      </div>
    </div>
  );
}
