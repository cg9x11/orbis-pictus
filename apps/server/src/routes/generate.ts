import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GenerateRequestSchema, type GenerateErrorCode, type GenerateEvent } from "@orbis/shared";
import { toProviderOverrides, type ProviderResolver, type Providers } from "../providers/index.js";
import { withModelFallback } from "../providers/image/modelFallback.js";
import { runGenerate } from "../pipeline/generate.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";
import { QuotaExhaustedError } from "../providers/types.js";

export function generateRoute(
  resolveProviders: ProviderResolver,
  imagesDir: string,
  video: VideoPipeline,
  morph: MorphPipeline,
): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const req = parsed.data;

    return streamSSE(c, async (stream) => {
      const emit = (event: GenerateEvent): Promise<void> =>
        stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) });

      try {
        // Resolved per request, inside the stream, so this request's own provider/model overrides
        // apply — and so a config.yml edit lands on the next generation with no restart. The
        // resolved object is captured for the whole generation, including the background clips
        // launched below, so a switch made mid-flight never swaps a provider under running work.
        const requested = toProviderOverrides(req);
        const resolved = resolveProviders(requested);

        // A provider swap is decided synchronously while building, so it is known here, before any
        // generation happens. buildImageProvider has already logged the precise cause server-side
        // (unrecognised name vs. missing API key); the client only needs to know its pick didn't
        // take and what drew instead.
        if (requested.imageProvider && resolved.image.providerId !== requested.imageProvider) {
          await emit({
            event: "notice",
            data: {
              code: "provider_fallback",
              message: `Image provider "${requested.imageProvider}" isn't available on this server — using "${resolved.image.providerId}" instead.`,
              requested: requested.imageProvider,
              used: resolved.image.providerId,
            },
          });
        }

        // Video needs the same notice, and needs it more. A rejected video provider resolves to
        // MockVideoProvider, which succeeds — so the page gets a placeholder clip stored and marked
        // `ready`, and nothing ever fails to hint that the pick did not take. The dropdown disables
        // unavailable providers, but a value already in localStorage never passes through it.
        if (requested.videoProvider && resolved.video.providerId !== requested.videoProvider) {
          await emit({
            event: "notice",
            data: {
              code: "provider_fallback",
              message: `Video provider "${requested.videoProvider}" isn't available on this server — using "${resolved.video.providerId}" instead.`,
              requested: requested.videoProvider,
              used: resolved.video.providerId,
            },
          });
        }

        const providers: Providers = {
          ...resolved,
          // Wrapped only when a model was actually named: with no override the provider is already
          // the configured default, so there is nothing to fall back FROM. (The variant route in
          // /api/nodes applies the same rule to the model stored on the node — see the comment there.)
          image: requested.imageModel
            ? withModelFallback(
                resolved.image,
                // Same request, minus the model — i.e. this provider on its configured model.
                () => resolveProviders({ ...requested, imageModel: undefined }).image,
                (notice) =>
                  emit({
                    event: "notice",
                    data: {
                      code: "model_fallback",
                      message: `Image model "${notice.requested}" was rejected — drew with "${notice.used}" instead.`,
                      requested: notice.requested,
                      used: notice.used,
                    },
                  }),
              )
            : resolved.image,
        };

        // Background idle-loop and morph generation are kicked off inside runGenerate, just before
        // it emits `complete`, so that event's payload already carries video_status "pending".
        await runGenerate(req, { providers, imagesDir, video, morph }, emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const code: GenerateErrorCode | undefined = err instanceof QuotaExhaustedError ? "quota" : undefined;
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message, code }) });
      }
    });
  });

  return app;
}
