import type { AspectRatio } from "@flipbook/shared";

const RATIOS: AspectRatio[] = ["16:9", "3:4", "1:1"];

interface AspectRatioPickerProps {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
  disabled: boolean;
}

export function AspectRatioPicker({ value, onChange, disabled }: AspectRatioPickerProps) {
  return (
    <div className="ratio-picker" role="group" aria-label="Aspect ratio">
      {RATIOS.map((ratio) => (
        <button
          key={ratio}
          type="button"
          className={`ratio-btn${ratio === value ? " ratio-btn-active" : ""}`}
          onClick={() => onChange(ratio)}
          disabled={disabled}
        >
          {ratio}
        </button>
      ))}
    </div>
  );
}
