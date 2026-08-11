import { AUTO_COMPOSITION, type ArtStyleOption } from "@orbis/shared";

interface CompositionPickerProps {
  compositions: ArtStyleOption[];
  value: string;
  onChange: (composition: string) => void;
  disabled: boolean;
  /** The currently-selected art style - drives what "Auto" resolves to, and whether the View is
   *  locked by the style. */
  artStyle: string;
  /** Style -> paired concrete view name, from the server. */
  autoView: Record<string, string>;
  /** Styles whose View is fixed by the style itself (e.g. tilt-shift). */
  viewLockedStyles: string[];
}

/**
 * Picks which composition (View) gets wrapped into the image prompt - an axis orthogonal to the art
 * style. The list, labels, and the leading "Auto" option all come from the server (parsed out of
 * art-style.md), so adding a composition there makes it appear here with no client change.
 *
 * "Auto" is the default: it defers to the style's paired view, resolved server-side. The dropdown
 * shows what that will be for the current style (e.g. "Auto (Diorama)"). A view-locked style - one
 * that owns its own camera, like tilt-shift - shows a disabled "built-in" instead, because its View
 * cannot be chosen.
 *
 * Only affects pages generated from now on; existing pages keep the composition they were drawn in.
 */
export function CompositionPicker({
  compositions,
  value,
  onChange,
  disabled,
  artStyle,
  autoView,
  viewLockedStyles,
}: CompositionPickerProps) {
  if (compositions.length < 2) return null;

  // A style that owns its own view offers no choice: show a static, disabled "built-in".
  if (viewLockedStyles.includes(artStyle)) {
    return (
      <label className="style-picker">
        <span className="style-picker-caption">View</span>
        <select className="style-picker-select" value="built-in" disabled title="This style sets its own view.">
          <option value="built-in">built-in</option>
        </select>
      </label>
    );
  }

  // Show what "Auto" will resolve to for the current style, e.g. "Auto (Diorama)".
  const resolvedName = autoView[artStyle];
  const resolvedLabel = compositions.find((c) => c.name === resolvedName)?.label;
  const options = compositions.map((c) =>
    c.name === AUTO_COMPOSITION && resolvedLabel ? { ...c, label: `Auto (${resolvedLabel})` } : c,
  );

  return (
    <label className="style-picker">
      <span className="style-picker-caption">View</span>
      <select
        className="style-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title="Composition for pages generated from now on; pages already drawn keep their own. 'Auto' lets the style pick its best-matching view."
      >
        {options.map((composition) => (
          <option key={composition.name} value={composition.name}>
            {composition.label}
          </option>
        ))}
      </select>
    </label>
  );
}
