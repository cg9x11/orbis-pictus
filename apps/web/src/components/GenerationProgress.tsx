import type { GenerationStage } from "@orbis/shared";
import { useElapsedSeconds } from "../hooks/useElapsedSeconds";

export interface GenerationProgressProps {
  stage?: GenerationStage;
  /** Tap mode only: what the VLM named the tapped object. */
  tapSubject?: string;
  /** Known from the "drawing" stage onwards. */
  pageTitle?: string;
  /** Epoch ms the generation began; omitted for a variant re-render, which has no stream. */
  startedAt?: number;
}

/** A page takes tens of seconds, so the elapsed count only appears once the wait is long enough to
 *  need reassurance — showing "1s" immediately would make every generation feel slow. */
const ELAPSED_AFTER_SECONDS = 8;

function label(stage: GenerationStage | undefined, tapSubject: string | undefined, pageTitle: string | undefined): string {
  switch (stage) {
    case "searching":
      return "Looking it up on the web";
    case "authoring":
      return tapSubject ? `Writing the page about ${tapSubject}` : "Writing the page";
    case "drawing":
      return pageTitle ? `Drawing ${pageTitle}` : "Drawing the page";
    default:
      // Before the first stage event: in tap mode the VLM is still naming what was clicked, which
      // is the one thing the user is actually curious about, so say that rather than "starting".
      return tapSubject ? `Looking at ${tapSubject}` : "Starting";
  }
}

/**
 * Replaces a single static "Generating…" pill with the phase the server is actually in. Every
 * value here already travels over the existing SSE stream — the client used to receive
 * and discard it. Nothing about this speeds a generation up; it just stops a 30-60 second wait from
 * looking like a frozen page.
 */
export function GenerationProgress({ stage, tapSubject, pageTitle, startedAt }: GenerationProgressProps) {
  const elapsed = useElapsedSeconds(startedAt);
  const showElapsed = elapsed !== null && elapsed >= ELAPSED_AFTER_SECONDS;

  return (
    <div className="generation-progress">
      <span className="generation-progress-spinner" aria-hidden="true" />
      <span className="generation-progress-label">
        {label(stage, tapSubject, pageTitle)}
        <span className="generation-progress-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
      {showElapsed && <span className="generation-progress-elapsed">{elapsed}s</span>}
    </div>
  );
}
