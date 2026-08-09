import type { AspectRatio, PageLabel } from "@orbis/shared";

interface PageLabelsProps {
  title: string;
  labels: PageLabel[];
  footer: string;
  /** Which aspect ratio `labels` were authored for — `null` for an old node with no overlay data. */
  labelsAspect: AspectRatio | null;
  /** The currently displayed aspect ratio. The overlay renders only when this matches
   *  `labelsAspect` — a lazily-generated variant at another ratio re-composes the scene, so the
   *  same {x,y} would land on the wrong spot (see PLAN-layered-page.md, "Anchoring reality"). */
  displayedAspect: AspectRatio;
  /** Hidden mid-generation / mid-transition, when the image underneath no longer matches these
   *  coordinates — same rationale as `CachedTapMarkers`'s `hidden` prop. */
  hidden: boolean;
  /** Phase 6a: a tap on a plaque explores that label's subject directly. The subject is already
   *  known, so this takes the deterministic, VLM-free tap path (see handleLabelTap). */
  onLabelTap: (subject: string, x: number, y: number) => void;
}

/**
 * Text overlay for a layered page: the title and footer as display-only DOM text, and the callout
 * labels as small buttons pinned near each subject's {x, y} anchor (with a leader line).
 *
 * The container is `pointer-events: none`, so gaps between plaques still tap through to the image
 * and the existing tap-anywhere -> VLM flow is untouched. Only the plaques themselves are clickable
 * (`pointer-events: auto` in styles.css); clicking one explores its subject with no VLM call.
 */
export function PageLabels({ title, labels, footer, labelsAspect, displayedAspect, hidden, onLabelTap }: PageLabelsProps) {
  // No overlay for an old node (its text is baked into the image; labelsAspect is null) or while a
  // generation/transition is under way.
  if (hidden || labelsAspect === null) return null;
  // Title and footer sit at fixed positions (top/bottom), independent of the scene composition, so
  // they render at ANY ratio. Only the coordinate-anchored callouts hide on a ratio mismatch, where
  // their {x,y} would land on the wrong spot in a re-composed variant.
  const showCallouts = labelsAspect === displayedAspect;

  return (
    <div className="page-labels">
      {title && <div className="page-label-title">{title}</div>}
      {showCallouts &&
        labels.map((label, i) => (
        <div
          key={`${label.text}:${label.x},${label.y}:${i}`}
          className="page-label"
          style={{ left: `${label.x * 100}%`, top: `${label.y * 100}%` }}
        >
          <span className="page-label-leader" />
          <button
            type="button"
            className="page-label-plaque"
            title={`Explore: ${label.subject}`}
            onClick={(e) => {
              // The image beneath has its own tap handler that would draw a marker and call the VLM;
              // stop it so a label tap takes the deterministic, VLM-free path only.
              e.stopPropagation();
              onLabelTap(label.subject, label.x, label.y);
            }}
          >
            <span className="page-label-text">{label.text}</span>
            {label.description && <span className="page-label-description">{label.description}</span>}
          </button>
        </div>
      ))}
      {footer && <div className="page-label-footer">{footer}</div>}
    </div>
  );
}
