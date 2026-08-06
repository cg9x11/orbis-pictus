import type { HouseStyleOption } from "@flipbook/shared";

interface HouseStylePickerProps {
  styles: HouseStyleOption[];
  value: string;
  onChange: (style: string) => void;
  disabled: boolean;
}

/**
 * Picks which block of house-style.md gets appended to the image prompt (PLAN §2 VISUAL IDENTITY).
 * The list and the labels both come from the server, which parses them out of house-style.md
 * itself, so adding a style there makes it appear here with no client change.
 *
 * Only affects pages generated from now on. Existing pages keep the style they were drawn in —
 * there is no re-render, because that would mean paying for every page again.
 */
export function HouseStylePicker({ styles, value, onChange, disabled }: HouseStylePickerProps) {
  if (styles.length < 2) return null;

  return (
    <label className="style-picker">
      <span className="style-picker-caption">Style</span>
      <select
        className="style-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title="Rendering style for pages generated from now on; pages already drawn keep their own"
      >
        {styles.map((style) => (
          <option key={style.name} value={style.name}>
            {style.label}
          </option>
        ))}
      </select>
    </label>
  );
}
