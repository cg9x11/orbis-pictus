import type { HouseStyleOption } from "@flipbook/shared";

interface CompositionPickerProps {
  compositions: HouseStyleOption[];
  value: string;
  onChange: (composition: string) => void;
  disabled: boolean;
}

/**
 * Picks which composition block (flat infographic / isometric diorama) gets wrapped into the image
 * prompt — an axis orthogonal to the house style. The list and labels come from the server, which
 * parses them out of house-style.md, so adding a composition there makes it appear here with no
 * client change.
 *
 * Only affects pages generated from now on; existing pages keep the composition they were drawn in.
 */
export function CompositionPicker({ compositions, value, onChange, disabled }: CompositionPickerProps) {
  if (compositions.length < 2) return null;

  return (
    <label className="style-picker">
      <span className="style-picker-caption">View</span>
      <select
        className="style-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title="Composition (flat vs isometric diorama) for pages generated from now on; pages already drawn keep their own"
      >
        {compositions.map((composition) => (
          <option key={composition.name} value={composition.name}>
            {composition.label}
          </option>
        ))}
      </select>
    </label>
  );
}
