import { z } from "zod";

/**
 * Shape of the optional `config.yml` file (see config.example.yml). Every field is optional: the
 * file may specify any subset, and anything omitted falls back to an environment variable and then
 * a built-in default (see resolution helpers in ./index.ts). This schema validates only the file's
 * *structure/types* so a typo (e.g. `video.enabled: "yes"`) fails fast at startup with a clear
 * message; it deliberately does NOT enforce enum membership for things like provider names or
 * resolutions — those are validated where they are consumed, exactly as they are for env values,
 * so the file and env paths behave identically.
 *
 * Secrets (API keys) are intentionally absent: they are read from the environment only and must
 * never live in this committed-adjacent file.
 */
export const FileConfigSchema = z
  .object({
    server: z
      .object({
        port: z.number().int().positive().optional(),
        databaseUrl: z.string().optional(),
        imagesDir: z.string().optional(),
      })
      .optional(),
    llm: z
      .object({
        provider: z.string().optional(),
        baseUrl: z.string().optional(),
        promptAuthorModel: z.string().optional(),
        tapVlmModel: z.string().optional(),
      })
      .optional(),
    image: z
      .object({
        provider: z.string().optional(),
        fal: z.object({ model: z.string().optional() }).optional(),
        ark: z
          .object({
            baseUrl: z.string().optional(),
            model: z.string().optional(),
            fallbackModel: z.string().optional(),
          })
          .optional(),
        gemini: z
          .object({
            baseUrl: z.string().optional(),
            model: z.string().optional(),
            imageSize: z.string().optional(),
          })
          .optional(),
        openai: z
          .object({
            baseUrl: z.string().optional(),
            model: z.string().optional(),
            quality: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    video: z
      .object({
        enabled: z.boolean().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        resolution: z.string().optional(),
        durationSeconds: z.number().positive().optional(),
        maxPerSession: z.number().int().positive().optional(),
        morph: z
          .object({
            enabled: z.boolean().optional(),
            maxPerSession: z.number().int().positive().optional(),
            model: z.string().optional(),
            reverse: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    search: z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
        cacheEnabled: z.boolean().optional(),
      })
      .optional(),
    artStyle: z.string().optional(),
    composition: z.string().optional(),
    upload: z.object({ enabled: z.boolean().optional() }).optional(),
    tapDedup: z.string().optional(),
    debug: z.object({ imagePrompt: z.boolean().optional() }).optional(),
  })
  // Reject unknown top-level keys so a misplaced/misspelled section (e.g. `vidoe:`) is caught rather
  // than silently ignored, which would otherwise look like the setting "not working".
  .strict();

export type FileConfig = z.infer<typeof FileConfigSchema>;
