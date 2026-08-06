interface VideoLoopToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
}

/** PLAN §3 Phase 5 — experimental, off by default; wording echoes the original's "live video stream" feature. */
export function VideoLoopToggle({ enabled, onChange, disabled }: VideoLoopToggleProps) {
  return (
    <button
      type="button"
      className={`toolbar-button${enabled ? " toolbar-button-active" : ""}`}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      aria-pressed={enabled}
      title="Experimental: play a short looping motion clip on pages that have one, instead of a static image"
    >
      Live video stream: {enabled ? "on" : "off"}
    </button>
  );
}
