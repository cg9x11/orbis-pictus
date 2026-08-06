/** Joins `base` with whichever modifier classes are truthy in `modifiers`, e.g.
 *  `classNames("toolbar-button", { "toolbar-button-active": enabled })`. */
export function classNames(base: string, modifiers: Record<string, boolean | undefined>): string {
  const active = Object.entries(modifiers)
    .filter(([, on]) => on)
    .map(([cls]) => cls);
  return [base, ...active].join(" ");
}
