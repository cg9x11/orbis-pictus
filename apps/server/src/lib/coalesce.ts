/**
 * De-duplicates concurrent async work that shares a key. The first caller for a key starts the
 * work; any caller arriving with the same key while it is still running awaits the *same* promise
 * instead of starting its own. The entry is removed as soon as the work settles, so this only ever
 * coalesces genuinely-overlapping calls - it is NOT a result cache (that job belongs to the
 * persistent prompt-hash / tap-cache layers).
 *
 * Purpose (cache stampede): the persistent caches are checked before an expensive image
 * generation, but two identical requests that race both miss the check and each pay the provider.
 * Wrapping the provider call here means the second request rides the first one's result. Safe
 * because Node runs this single-threaded: `get`/`set` around the synchronous `fn()` kick-off cannot
 * interleave with another call.
 */
export class InFlight<T> {
  private readonly map = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.map.get(key);
    if (existing) return existing;
    const p = fn().finally(() => {
      this.map.delete(key);
    });
    this.map.set(key, p);
    return p;
  }

  /** Number of currently in-flight keys - for tests/observability only. */
  get size(): number {
    return this.map.size;
  }
}
