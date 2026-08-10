import { useRef, useState } from "react";
import type { VersionSummary } from "@orbis/shared";
import { useDismiss } from "../hooks/useDismiss";

interface PageVersionsProps {
  /** Every version of the current page, oldest first. The control hides when there are fewer than two. */
  versions: VersionSummary[];
  /** The version currently on screen — highlighted, and never re-opened on click. */
  currentId: string | undefined;
  /** Open an existing version. Swaps it into the current trail slot (a version is a lateral move, so
   *  the breadcrumb does not grow); a one-step move plays the transition morph. */
  onOpen: (id: string) => void;
  /** The star action: make this version the one the page opens by default. */
  onSetDefault: (id: string) => void;
  /** Hidden mid-generation / mid-transition — same rationale as CachedTapMarkers. */
  hidden: boolean;
}

/** The git-branch glyph (Lucide-style). Marks the control that lists a page's edit versions. Shared
 *  with the gallery card's version badge (Landing.tsx), which draws it a touch heavier. */
export function BranchIcon({ strokeWidth = 2 }: { strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** A five-point star. Filled (via CSS) when this version is the default. */
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 21.3l-5.8 3.05 1.1-6.45L2.6 9.35l6.5-.95z" />
    </svg>
  );
}

/**
 * The branch control for a page that has edit versions (see plans/PLAN-versions.md, shape B). An
 * icon button, top-right of the image, opens a popover listing every version of THIS page. Each row
 * opens that version (a one-step move, so the day<->night morph plays), and a star sets the version
 * that opens by default.
 *
 * Deliberately a sibling overlay, not part of the image: a click on the control never reaches the
 * image's tap handler, so the tap-anywhere -> VLM flow is untouched.
 */
export function PageVersions({ versions, currentId, onOpen, onSetDefault, hidden }: PageVersionsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, only while open.
  useDismiss(open, () => setOpen(false), rootRef);

  // A page with a single version has nothing to branch. Also hidden mid-generation / mid-transition,
  // when the image underneath is not the one these versions belong to.
  if (hidden || versions.length < 2) return null;

  return (
    <div className="page-versions" ref={rootRef}>
      <button
        type="button"
        className="page-versions-button"
        aria-expanded={open}
        aria-label="Versions of this page"
        title="Versions of this page"
        onClick={() => setOpen((v) => !v)}
      >
        <BranchIcon />
        <span className="page-versions-count">{versions.length}</span>
      </button>

      {open && (
        <div className="page-versions-popover" role="menu">
          <div className="page-versions-head">
            <p className="page-versions-eyebrow">Versions of this page</p>
          </div>
          <div className="page-versions-list">
            {versions.map((v) => {
              const onScreen = v.id === currentId;
              return (
                <div key={v.id} className="page-version" aria-current={onScreen}>
                  <button
                    type="button"
                    className="page-version-open"
                    onClick={() => {
                      // The on-screen version is already the current page; re-opening it would append
                      // a duplicate to the trail. Just close in that case.
                      if (!onScreen) onOpen(v.id);
                      setOpen(false);
                    }}
                  >
                    <span className="page-version-thumb">
                      {v.image_url ? <img src={v.image_url} alt="" /> : <span className="page-version-thumb-empty" />}
                    </span>
                    <span className="page-version-text">
                      <span className="page-version-title">{v.page_title}</span>
                      <span className="page-version-meta">{v.edit_command ?? "Original page"}</span>
                    </span>
                    {onScreen && <span className="page-version-current">On screen</span>}
                  </button>
                  <button
                    type="button"
                    className="page-version-star"
                    aria-pressed={v.is_default}
                    aria-label={v.is_default ? "Opens by default" : "Open this version by default"}
                    title={v.is_default ? "Opens by default" : "Open by default"}
                    onClick={() => onSetDefault(v.id)}
                  >
                    <StarIcon />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="page-versions-foot">★ opens by default. The highlighted row is on screen now.</p>
        </div>
      )}
    </div>
  );
}
