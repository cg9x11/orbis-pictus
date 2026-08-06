/** True only when the named env var is the literal string "true". */
export function boolEnvFlag(name: string): boolean {
  return process.env[name] === "true";
}

/** A positive integer env var, falling back to `fallback` when unset, non-numeric, or <= 0. */
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}
