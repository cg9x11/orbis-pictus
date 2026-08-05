interface WebSearchToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
}

export function WebSearchToggle({ enabled, onChange, disabled }: WebSearchToggleProps) {
  return (
    <button
      type="button"
      className={`toolbar-button${enabled ? " toolbar-button-active" : ""}`}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      aria-pressed={enabled}
    >
      Web search: {enabled ? "on" : "off"}
    </button>
  );
}
