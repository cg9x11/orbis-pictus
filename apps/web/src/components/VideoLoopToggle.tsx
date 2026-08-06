import type { VideoStatus } from "@flipbook/shared";

interface VideoLoopToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
  /**
   * The current page's clip state. The three cases are distinct and the difference matters:
   * `undefined` = no page is open at all (the landing gallery), `null` = a page is open but has no
   * clip and none is being made, and a real status = a page with a clip ready or on its way.
   */
  status: VideoStatus | null | undefined;
}

/** Reports what the current page can actually offer, so switching the toggle on never leaves the
 *  user watching a static image with no explanation. Clips are only ever generated for a page at
 *  the moment it is created, and only while the server has video enabled — so most pages, all the
 *  older ones included, will honestly answer "none here". */
function describe(enabled: boolean, status: VideoStatus | null | undefined): { label: string; title: string } {
  if (!enabled) {
    return {
      label: "Live video stream: off",
      title: "Experimental: play a short looping motion clip on pages that have one, instead of a static image",
    };
  }
  // On the landing page there is no page to report on, so the toggle is just a preference for the
  // pages opened from here — saying "none on this page" there reads as a fault when nothing is wrong.
  if (status === undefined) {
    return {
      label: "Live video stream: on",
      title: "Experimental: pages that have a looping motion clip will play it instead of a static image",
    };
  }
  switch (status) {
    case "ready":
      return { label: "Live video stream: on", title: "Playing this page's looping motion clip" };
    case "pending":
      return { label: "Live video stream: generating…", title: "This page's clip is still being generated — it will start playing on its own" };
    default:
      return {
        label: "Live video stream: on (none on this page)",
        title:
          "No clip exists for this page, and none is being generated — clips are only made for a page when it is first created, with video enabled on the server. Newly generated pages will have one.",
      };
  }
}

/** PLAN §3 Phase 5 — experimental, off by default; wording echoes the original's "live video stream" feature. */
export function VideoLoopToggle({ enabled, onChange, disabled, status }: VideoLoopToggleProps) {
  const { label, title } = describe(enabled, status);
  const working = enabled && status === "pending";
  return (
    <button
      type="button"
      className={`toolbar-button${enabled ? " toolbar-button-active" : ""}${working ? " toolbar-button-working" : ""}`}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      aria-pressed={enabled}
      title={title}
    >
      {label}
    </button>
  );
}
