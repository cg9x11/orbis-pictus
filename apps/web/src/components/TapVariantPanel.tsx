import { useEffect, useRef } from "react";
import type { CachedTap } from "@orbis/shared";

interface TapVariantPanelProps {
  tap: CachedTap;
  /** Opens one of the existing versions. Costs nothing. */
  onOpen: (childId: string) => void;
  /** Draws a new version of this subject. Spends real quota, so it is never the default action. */
  onDrawNew: (tap: CachedTap) => void;
  onClose: () => void;
  /** A generation is already running. Both actions are refused while it is, so say so rather than
   *  letting every click do nothing and leave the panel looking frozen. */
  busy: boolean;
}

/**
 * Shown when a tap lands on a spot already explored, while the server is in `variant` mode.
 *
 * It exists because that tap is ambiguous in a way a `reuse`-mode tap is not. The subject is known,
 * so the vision call is free, but the drawing is not — and there can be several earlier versions of
 * the same subject, none of which is the "right" one to jump to. Rather than guess, the panel puts
 * the choice in front of the user before anything is spent.
 */
export function TapVariantPanel({ tap, onOpen, onDrawNew, onClose, busy }: TapVariantPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Read through a ref so the listener below can depend on nothing. `onClose` is rebuilt on every
  // controller render, and the controller re-renders often while the panel is open (the tap ripple
  // clearing after ~600ms, idle-loop video polling). An effect that depended on it would re-run on
  // each of those and yank focus back to the close button mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The panel interrupts a tap, so Escape must undo that interruption. Without it the only way out
  // is the close button, and a user who tapped by accident is stuck looking at a decision they did
  // not ask for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mount only: moving focus into the panel is a one-time hand-off, not something to redo whenever
  // the parent happens to render.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Newest first: the most recent version is the one the user most likely wants to see again.
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
                  // The child exists but was drawn at another aspect ratio, so this one has no image
                  // yet. Kept in the list as a placeholder: opening it still works, and the server
                  // fills in the missing variant on demand.
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
