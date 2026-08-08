import { UnknownModelError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";

/** What happened, for the caller to surface to the user (routes/generate.ts turns this into an SSE
 *  `notice`) and to log. `reason` is the provider's own rejection text. */
export interface ModelFallbackNotice {
  requested: string;
  used: string;
  reason: string;
}

/**
 * Wraps an image provider so a request naming a model the provider doesn't recognise draws with the
 * server's configured default instead of failing the page.
 *
 * This is the safety net behind the settings picker's `Custom…` model field: model ids change
 * faster than any catalog can track, so the picker deliberately accepts free text, and the only
 * authority on whether an id works is the generation call itself. A rejected request costs nothing
 * (providers don't bill refusals) and happens once per bad id, since the retry draws real pixels
 * that the prompt-hash cache then serves.
 *
 * Deliberately narrow: ONLY `UnknownModelError` is caught. A quota failure, a network error, or a
 * malformed response all propagate untouched — retrying those on a different model would spend
 * budget on a request that was never going to work for a reason the model can't fix.
 *
 * `buildDefault` is lazy so the default provider is only constructed on the failure path, and is a
 * factory rather than an instance so it reflects config at the moment it is needed.
 */
export function withModelFallback(
  primary: ImageProvider,
  buildDefault: () => ImageProvider,
  /** Awaited before the retry starts, so a caller writing to an SSE stream can be sure the notice
   *  reaches the client in order rather than racing the events the retry goes on to produce. */
  onFallback: (notice: ModelFallbackNotice) => void | Promise<void>,
): ImageProvider {
  return {
    // The wrapper advertises the REQUESTED model, not the fallback: callers compute the prompt hash
    // from this before generating, and the cache key must reflect what was asked for. When a
    // fallback does fire, `usedModelId` on the result carries the correction.
    providerId: primary.providerId,
    modelId: primary.modelId,

    async generate(input: ImageGenInput): Promise<ImageGenResult> {
      try {
        return await primary.generate(input);
      } catch (err) {
        if (!(err instanceof UnknownModelError)) throw err;

        const fallback = buildDefault();
        // Nothing to fall back to: the configured default IS the model just rejected, so retrying
        // would fail identically. Surface the original error rather than paying for a second no.
        if (fallback.providerId === primary.providerId && fallback.modelId === primary.modelId) throw err;

        await onFallback({ requested: primary.modelId, used: fallback.modelId, reason: err.message });

        const result = await fallback.generate(input);
        // `?? fallback.modelId` preserves an inner correction: the Ark provider sets usedModelId
        // itself when its own quota fallback fires, and that is the more specific truth about which
        // model drew these pixels.
        return { ...result, usedModelId: result.usedModelId ?? fallback.modelId };
      }
    },
  };
}
