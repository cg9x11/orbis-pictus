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
}

/**
 * Display-only text overlay for a layered page: the title, the callout labels (each near its
 * subject's {x,y} anchor, with a leader line), and the footer caption — all rendered as real DOM
 * text on top of the clean background image, not baked into it.
 *
 * `pointer-events: none` throughout (see styles.css), so every tap still falls through to the
 * image underneath and the existing tap-anywhere -> VLM flow is untouched. Making these plaques
 * interactive is Phase 6 (PLAN-layered-page.md), not this component.
 */
export function PageLabels({ title, labels, footer, labelsAspect, displayedAspect, hidden }: PageLabelsProps) {
  if (hidden || labelsAspect === null || labelsAspect !== displayedAspect) return null;

  return (
    <div className="page-labels" aria-hidden="true">
      {title && <div className="page-label-title">{title}</div>}
      {labels.map((label, i) => (
        <div
          key={`${label.text}:${label.x},${label.y}:${i}`}
          className="page-label"
          style={{ left: `${label.x * 100}%`, top: `${label.y * 100}%` }}
        >
          <span className="page-label-leader" />
          <div className="page-label-plaque">
            <span className="page-label-text">{label.text}</span>
            {label.description && <span className="page-label-description">{label.description}</span>}
          </div>
        </div>
      ))}
      {footer && <div className="page-label-footer">{footer}</div>}
    </div>
  );
}
