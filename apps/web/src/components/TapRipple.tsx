interface TapRippleProps {
  xRatio: number;
  yRatio: number;
  onDone: () => void;
}

export function TapRipple({ xRatio, yRatio, onDone }: TapRippleProps) {
  return (
    <span
      className="tap-ripple"
      style={{ left: `${xRatio * 100}%`, top: `${yRatio * 100}%` }}
      onAnimationEnd={onDone}
    />
  );
}
