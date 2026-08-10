import { z } from "zod";

export const AspectRatioSchema = z.enum(["16:9", "3:4", "1:1"]);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

// Relative paths (e.g. "/images/{nodeId}/landscape.jpg") — same-origin so the canvas
// tap-marker trick (drawImage + toDataURL) never taints on cross-origin CORS rules.
export const ImageVariantsSchema = z.object({
  "3:4": z.string().optional(),
  "1:1": z.string().optional(),
  "16:9": z.string().optional(),
});
export type ImageVariants = z.infer<typeof ImageVariantsSchema>;

/** Lifecycle of a node's background idle-loop clip. `null` (the default) means one was never
 *  attempted — the usual case, since video is off by default and is only ever started for a page
 *  generated while it was on. A client must treat `null` as "there will never be a clip here",
 *  not as "not ready yet", or it ends up waiting forever on a page nothing is working on. */
export const VideoStatusSchema = z.enum(["pending", "ready", "failed"]);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

/** Lifecycle of a page-transition morph clip — same null/pending/ready/failed contract as
 *  VideoStatusSchema above, just for the one-shot clip that plays once when navigating from a
 *  parent into this node, rather than an idle loop. */
export const MorphStatusSchema = z.enum(["pending", "ready", "failed"]);
export type MorphStatus = z.infer<typeof MorphStatusSchema>;

// --- Node ---
export const NodeSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  session_id: z.string(),
  query: z.string(),
  page_title: z.string(),
  image_variants: ImageVariantsSchema,
  image_model: z.string(),
  /**
   * How this page was drawn, recorded so it can be reproduced later.
   *
   * A missing aspect-ratio variant is generated on demand, long after the page itself, and must
   * match it. Without this the variant is drawn by whatever the server happens to be set to now,
   * and with no art-style block at all — so the same page looks different at a different ratio.
   *
   * Defaulted (not required) because rows written before these columns existed have none, and an
   * old page must still load. An empty value means "unknown, use the server's current setting".
   */
  image_provider: z.string().default(""),
  art_style: z.string().default(""),
  composition: z.string().default(""),
  prompt_author_model: z.string(),
  authored_prompt: z.string(),
  created_at: z.string(),
  version: z.number().int(),
  // Exposed on every node payload (detail, gallery list, and the `complete` event) so the client
  // can tell "a clip is coming" from "no clip will ever exist" without probing /video and reading
  // a 404 — the two are indistinguishable at that endpoint. Defaulted so older stored payloads
  // and create requests, which never carried the field, still parse.
  video_status: VideoStatusSchema.nullable().default(null),
  // Same rationale as video_status: exposed here so the client can tell "a morph is coming" from
  // "none will ever exist" from the `complete` event alone, instead of only discovering it by
  // separately asking GET /api/nodes/:id/morph on every parent -> child navigation.
  morph_status: MorphStatusSchema.nullable().default(null),
  // Page versions (see plans/PLAN-versions.md). All four are OPTIONAL on purpose: making them
  // required would force every Node literal in the codebase (two routes plus the test factories) to
  // set them, so the schema change could not stay in one phase. `rowToNode` in storage/nodes.ts
  // always populates them, so a node read from the database always carries them.
  //
  // Groups every version of one page. A non-edit node is its own group (the storage layer fills this
  // with the node's own id). An edit inherits the group of the version it was edited from.
  version_group_id: z.string().optional(),
  // The version this one was edited from. Null for a non-edit. Drives the transition morph, so it is
  // exposed here (the client's one-step-move check reads it).
  edited_from_id: z.string().nullable().optional(),
  // The edit instruction that produced this version, for example "make it night time". Null for a
  // non-edit. Shown in the versions list.
  edit_command: z.string().nullable().optional(),
  // True for the one version in a group that opens by default. Exactly one per group.
  is_default: z.boolean().optional(),
  // Where on the PARENT page this node was tapped, normalized 0..1 in the parent's coordinate space
  // (x from the left, y from the top). Populated only for pages created by a tap; undefined for
  // roots, edits, cached-tap opens, and legacy rows. Used to aim the transition morph's push toward
  // the tapped spot instead of the frame center.
  tap_x: z.number().optional(),
  tap_y: z.number().optional(),
});
export type Node = z.infer<typeof NodeSchema>;

/**
 * The page a node was reached FROM: the version it was edited from, else its exploration parent. An
 * edit VERSION (peer model) attaches to the edited version's own parent but records `edited_from_id`,
 * and a root edit has a null `parent_id` but a real `edited_from_id` — so `edited_from_id` wins. This
 * is one shared domain rule; the server morph pipeline and the client both key off it. Null for a
 * root page that is not an edit (nothing precedes it).
 */
export function predecessorId(node: Pick<Node, "edited_from_id" | "parent_id">): string | null {
  return node.edited_from_id ?? node.parent_id;
}

/**
 * The version group a node belongs to: its `version_group_id`, or its own `id` when it has none (a
 * page that is its own group, or a legacy row written before the column existed). One shared rule —
 * storage, routes, and the pipeline all resolve group membership through this, so versioning identity
 * cannot drift between layers. `version_group_id` is typed optional on the schema, which is why the
 * fallback is needed even though the storage read layer already backfills it.
 */
export function groupIdOf(node: Pick<Node, "version_group_id" | "id">): string {
  return node.version_group_id ?? node.id;
}

// --- Generate request ---

/**
 * Provider/model selection carried on every generate request, so the UI can switch image and video
 * models without a server restart or a `config.yml` edit.
 *
 * Free strings, never enums — the same rationale as `art_style`/`composition` below. The catalog of
 * valid providers and models lives server-side, and the picker offers a `Custom…` field for model
 * ids newer than that catalog, so a stale client or a hand-typed value must degrade to the server's
 * configured default rather than 400 the whole request. Every field is optional, and an absent or
 * blank one means "use the server default" — which is why a client that sends none of them behaves
 * exactly as it did before this block existed.
 *
 * `.catch(undefined)` on every field is what actually delivers that promise, and it has to be
 * per-field. The string fields degrade on their own because any string parses, but a number does
 * not: a duration of `5.5` failed `.int()`, and because these fields are merged into the generate
 * request schemas below, one bad value rejected the WHOLE request — a 400 that killed the
 * generation instead of ignoring one control. `.catch(undefined)` turns any unusable value into an
 * absent one, which is already defined above as "use the server default".
 *
 * Two other readers depend on this for the same reason: `readOverrides` in routes/nodes.ts and
 * `readModelPrefs` in the web app both `safeParse` a whole bag, so without per-field recovery one
 * malformed value silently discarded every other choice the user had made.
 */
export const ModelOverridesSchema = z.object({
  image_provider: z.string().optional().catch(undefined),
  image_model: z.string().optional().catch(undefined),
  video_provider: z.string().optional().catch(undefined),
  video_model: z.string().optional().catch(undefined),
  video_resolution: z.string().optional().catch(undefined),
  video_duration_seconds: z.number().int().positive().optional().catch(undefined),
  gemini_image_size: z.string().optional().catch(undefined),
  openai_image_quality: z.string().optional().catch(undefined),
  ark_fallback_model: z.string().optional().catch(undefined),
});
export type ModelOverrides = z.infer<typeof ModelOverridesSchema>;

// Fields common to every generate mode (search / tap / edit). Hoisted and `.merge()`d into each
// branch — the same pattern ModelOverridesSchema uses below — so a change to one control (a default,
// a comment) is a single edit, not three that can drift. `current_node_id` is NOT here: search
// defaults it to "", the other two require it.
const CommonGenerateFieldsSchema = z.object({
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  // Whether the client's "Live motion" toggle is on. Gates background idle-loop AND morph
  // generation server-side, so no video quota is spent (and no provider call is attempted) when the
  // user isn't using video — display was already gated client-side, but generation was not. Optional
  // (injected by the client in one place); absent/undefined is treated as off, the safe default.
  video_loop: z.boolean().optional(),
  // Which block of art-style.md to append to the image prompt. Left as a free string rather than
  // an enum so the style list stays defined in exactly one place (art-style.md, parsed by
  // pipeline/artStyle.ts); the server falls back to its ART_STYLE default for anything it does
  // not recognise, so a stale client can never break a generation.
  art_style: z.string().optional(),
  // Which composition block (flat / diorama) to use — same free-string + server-default rationale
  // as art_style above; the server falls back to its COMPOSITION default for anything unrecognised.
  composition: z.string().optional(),
  session_id: z.string(),
});

// mode "search": user typed a query
export const GenerateSearchRequestSchema = z.object({
  mode: z.literal("search"),
  query: z.string().min(1),
  current_node_id: z.string().default(""),
}).merge(CommonGenerateFieldsSchema).merge(ModelOverridesSchema);
export type GenerateSearchRequest = z.infer<typeof GenerateSearchRequestSchema>;

// mode "tap": user clicked a point on the current image (marker already drawn client-side)
export const GenerateTapRequestSchema = z.object({
  mode: z.literal("tap"),
  // The current page image WITH a marker drawn at the click point. The VLM resolves the tapped
  // subject visually from the marker, not from x/y.
  markedImage: z.string().startsWith("data:image/"),
  // Click point as a fraction (0..1) of the displayed image's width/height — same coordinate
  // space as the marker drawn into `markedImage`. Used server-side for the tap-cache lookup:
  // the VLM never sees these, it still resolves the subject visually from the marker.
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  // Set only by the tap panel's "Draw a new version" button, which is an explicit, deliberate
  // request to spend. It suppresses the layer-3 prompt-hash image cache for this one generation.
  // Without it a repeat tap whose authored prompt happens to come out identical would be served the
  // earlier node's pixels, and the user would click "new version" and get the same picture back.
  // Layers 1 and 2 are untouched: the VLM cache still applies, and reuse mode never reaches here.
  force_new_image: z.boolean().default(false),
  parent_title: z.string(),
  current_node_id: z.string(),
}).merge(CommonGenerateFieldsSchema).merge(ModelOverridesSchema);
export type GenerateTapRequest = z.infer<typeof GenerateTapRequestSchema>;

// mode "edit": user typed a command while a page is open (re-render the current page)
export const GenerateEditRequestSchema = z.object({
  mode: z.literal("edit"),
  prompt: z.string().min(1),
  // The current page image, plain — unlike GenerateTapRequestSchema's markedImage, no marker is
  // ever drawn into this one.
  currentImage: z.string().startsWith("data:image/"),
  parent_title: z.string(),
  current_node_id: z.string(),
}).merge(CommonGenerateFieldsSchema).merge(ModelOverridesSchema);
export type GenerateEditRequest = z.infer<typeof GenerateEditRequestSchema>;

// A request that omits `mode` is treated as a search — the natural default for a bare `{query}`
// POST. This preprocess has to inject it BEFORE the discriminatedUnion runs: the union resolves its
// branch from the raw input, so a `.default("search")` living on the literal inside a branch never
// fires (the branch is never selected in the first place). Injecting here delivers the default the
// old dead code only advertised.
export const GenerateRequestSchema = z.preprocess(
  (val) => (val && typeof val === "object" && (val as { mode?: unknown }).mode == null ? { ...val, mode: "search" } : val),
  z.discriminatedUnion("mode", [GenerateSearchRequestSchema, GenerateTapRequestSchema, GenerateEditRequestSchema]),
);
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

// --- SSE events ---
export const StartEventSchema = z.object({
  event: z.literal("start"),
  data: z.object({}).default({}),
});

export const TapSubjectEventSchema = z.object({
  event: z.literal("tap_subject"),
  data: z.object({ subject: z.string() }),
});

/** Ordered phases of a generation, reported so the wait is legible instead of one silent minute.
 *  A page takes tens of seconds and the slowest stretch — authoring the prompt, then drawing —
 *  used to emit nothing at all between `start` and `preview`. */
export const GenerationStageSchema = z.enum(["searching", "authoring", "drawing"]);
export type GenerationStage = z.infer<typeof GenerationStageSchema>;

/** One extensible event rather than a new event type per phase — adding a phase later costs a
 *  single enum member and no protocol change. `pageTitle` is present from "drawing" onwards, as
 *  soon as the authoring model has named the page. */
export const StageEventSchema = z.object({
  event: z.literal("stage"),
  data: z.object({
    stage: GenerationStageSchema,
    pageTitle: z.string().optional(),
  }),
});

export const PreviewEventSchema = z.object({
  event: z.literal("preview"),
  data: z.object({
    aspectRatio: AspectRatioSchema,
    imageUrl: z.string(),
  }),
});

export const CompleteEventSchema = z.object({
  event: z.literal("complete"),
  data: NodeSchema,
});

/** A machine-readable reason for the error, alongside its human-readable message, so the client
 *  can react to specific failure modes (e.g. showing a distinct quota-exhausted banner) without
 *  pattern-matching the message text — which is free-form and provider-dependent. */
export const GenerateErrorCodeSchema = z.enum(["quota"]);
export type GenerateErrorCode = z.infer<typeof GenerateErrorCodeSchema>;

export const ErrorEventSchema = z.object({
  event: z.literal("error"),
  data: z.object({ message: z.string(), code: GenerateErrorCodeSchema.optional() }),
});

/** A non-fatal advisory emitted mid-generation. Distinct from `error`, which ends the stream: a
 *  notice means generation carried on and a page still arrives, so a client must surface it without
 *  treating the request as failed. Exists for the model-fallback case — an unknown image model
 *  substituted with the server default — where `requested`/`used` carry the two model ids. */
export const NoticeCodeSchema = z.enum(["model_fallback", "provider_fallback"]);
export type NoticeCode = z.infer<typeof NoticeCodeSchema>;

export const NoticeEventSchema = z.object({
  event: z.literal("notice"),
  data: z.object({
    code: NoticeCodeSchema,
    message: z.string(),
    requested: z.string().optional(),
    used: z.string().optional(),
  }),
});

export const GenerateEventSchema = z.discriminatedUnion("event", [
  StartEventSchema,
  TapSubjectEventSchema,
  StageEventSchema,
  PreviewEventSchema,
  CompleteEventSchema,
  ErrorEventSchema,
  NoticeEventSchema,
]);
export type GenerateEvent = z.infer<typeof GenerateEventSchema>;

// --- Nodes persistence API ---
// The four version fields are omitted as well as created_at/version: they are server-owned state.
// A client that could POST is_default or version_group_id would either trip the one-default-per-group
// unique index or hijack another group's default. The generate pipeline and the storage defaults are
// the only writers of these fields.
export const NodesCreateRequestSchema = NodeSchema.omit({
  created_at: true,
  version: true,
  version_group_id: true,
  edited_from_id: true,
  edit_command: true,
  is_default: true,
}).extend({
  id: z.string().optional(),
});
export type NodesCreateRequest = z.infer<typeof NodesCreateRequestSchema>;

export const NodesGetResponseSchema = z.object({
  node: NodeSchema,
  history: z.array(NodeSchema),
});
export type NodesGetResponse = z.infer<typeof NodesGetResponseSchema>;

export const NodeVariantResponseSchema = z.object({ node: NodeSchema });
export type NodeVariantResponse = z.infer<typeof NodeVariantResponseSchema>;

// --- Page versions API (see plans/PLAN-versions.md) ---
// A lightweight view of one version for the branch control's list — not the whole Node. Named
// `VersionSummary`, never `Version`, because the `nodes` table already has an unrelated `version`
// integer column.
export const VersionSummarySchema = z.object({
  id: z.string(),
  page_title: z.string(),
  // A representative thumbnail: the first available aspect-ratio variant, or null if none exists yet.
  image_url: z.string().nullable(),
  // The edit that produced this version ("make it night time"), or null for the original page.
  edit_command: z.string().nullable(),
  edited_from_id: z.string().nullable(),
  is_default: z.boolean(),
  created_at: z.string(),
});
export type VersionSummary = z.infer<typeof VersionSummarySchema>;

// Returned by GET /:id/versions and POST /:id/default, oldest version first.
export const NodesVersionsResponseSchema = z.object({ versions: z.array(VersionSummarySchema) });
export type NodesVersionsResponse = z.infer<typeof NodesVersionsResponseSchema>;

// --- Gallery listing (landing page) — reuses already-generated nodes, zero new generations ---
//
// The listing is keyset-paginated, not offset-paginated. The gallery is ordered newest first and
// the table grows while a visitor reads it, because every generation inserts a new root. An OFFSET
// therefore points at a different row by the time the second page is asked for, so cards repeat and
// cards go missing. A cursor names the last row of the previous batch instead of counting from the
// top, so inserts above it cannot disturb the sequence.
export const NodesListResponseSchema = z.object({
  nodes: z.array(NodeSchema),
  /**
   * Opaque key of the last returned row. Pass it back as `?cursor=` to get the next batch. A
   * `null` value means the last batch was served. The field is defaulted so that a response from
   * an older server, which has no such field, still parses as "one page, and no more".
   */
  next_cursor: z.string().nullable().default(null),
  /**
   * Per-card version count, keyed by the card's node id. A count above one means the page has edit
   * versions, so the client shows the branch badge. Defaulted so a response from an older server,
   * which has no such field, still parses (every card then reads as a single-version page).
   */
  version_counts: z.record(z.string(), z.number()).default({}),
});
export type NodesListResponse = z.infer<typeof NodesListResponseSchema>;

// --- Upload entry point ---
export const NodesUploadRequestSchema = z.object({
  image: z.string().startsWith("data:image/"),
  aspect_ratio: AspectRatioSchema,
  session_id: z.string(),
});
export type NodesUploadRequest = z.infer<typeof NodesUploadRequestSchema>;

// --- Server config, for feature-availability toggles in the UI ---

/** The View value meaning "let the chosen style pick its paired composition". Shared so the server
 *  (which resolves it per style) and the client (which labels it in the picker) never drift on the
 *  sentinel string. A page is never stored with this value — only ever the concrete view it drew in. */
export const AUTO_COMPOSITION = "auto";

export const ArtStyleOptionSchema = z.object({ name: z.string(), label: z.string() });
export type ArtStyleOption = z.infer<typeof ArtStyleOptionSchema>;

/** One selectable provider in the settings panel. */
export const ProviderOptionSchema = z.object({
  name: z.string(),
  label: z.string(),
  /** Whether this provider's API key is present on the server. A boolean only — the key itself is
   *  never sent. Picking an unavailable provider is not fatal: the server falls back to its
   *  configured one and says so with a `provider_fallback` notice. */
  available: z.boolean(),
  /** Known-good model ids, for the dropdown. Not exhaustive and not enforced — the panel also
   *  offers a free-text field, because model ids change faster than any catalog. */
  models: z.array(z.string()).default([]),
});
export type ProviderOption = z.infer<typeof ProviderOptionSchema>;

/**
 * Everything the settings panel needs to draw itself: what can be picked, and what the server is
 * using right now. The `provider`/`model` values are the EFFECTIVE ones — if a configured provider
 * is missing its key, these report the fallback that is really in use, not the wish in config.yml.
 *
 * Grouped under one key rather than flattened into ConfigResponse, so the client can hold it as a
 * single piece of state. Every field has a default, so an older server that omits the whole block
 * still yields a well-formed (empty) settings object rather than failing the response parse.
 */
export const ModelSettingsSchema = z
  .object({
    image: z
      .object({
        providers: z.array(ProviderOptionSchema).default([]),
        provider: z.string().default(""),
        model: z.string().default(""),
      })
      .default({}),
    video: z
      .object({
        providers: z.array(ProviderOptionSchema).default([]),
        provider: z.string().default(""),
        model: z.string().default(""),
        resolutions: z.array(z.string()).default([]),
        resolution: z.string().default(""),
        durationSeconds: z.number().default(5),
        /** Ceiling the server applies to a client-supplied duration, so the panel can cap its own
         *  input instead of letting a user ask for something that will be silently clamped. */
        maxDurationSeconds: z.number().default(12),
      })
      .default({}),
    /** Per-provider knobs that only apply to one provider each, shown conditionally. */
    extras: z
      .object({
        geminiImageSizes: z.array(z.string()).default([]),
        geminiImageSize: z.string().default(""),
        openaiImageQualities: z.array(z.string()).default([]),
        openaiImageQuality: z.string().default(""),
        arkFallbackModel: z.string().default(""),
      })
      .default({}),
  })
  .default({});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

export const ConfigResponseSchema = z.object({
  /** Provider/model choices for the settings panel — see ModelSettingsSchema. */
  modelSettings: ModelSettingsSchema,
  searchAvailable: z.boolean(),
  videoEnabled: z.boolean(),
  morphEnabled: z.boolean(),
  /** Whether the Upload-photo control is offered (server UPLOAD_ENABLED). Defaults off so an
   *  older server that doesn't send the field hides the button rather than showing a dead one. */
  uploadEnabled: z.boolean().default(false),
  /** Every style block available in art-style.md, for the picker. */
  artStyles: z.array(ArtStyleOptionSchema).default([]),
  /** The server's own default (the ART_STYLE env), used as the picker's initial value. */
  artStyle: z.string().default("felt"),
  /** Every composition block available in art-style.md, plus a leading "Auto" option, for the picker. */
  compositions: z.array(ArtStyleOptionSchema).default([]),
  /** The picker's initial View value. "auto" (the default) means "let the chosen style pick its
   *  paired view"; the server resolves it per style at generation time. */
  composition: z.string().default("auto"),
  /** Style -> paired concrete view, so the picker can show what "Auto" resolves to for the current
   *  style. A style absent here (or listed in viewLockedStyles) has no view choice. */
  autoView: z.record(z.string()).default({}),
  /** Styles whose View is fixed by the style itself (e.g. tilt-shift owns its camera). The picker
   *  shows "built-in" and offers no view choice for these. */
  viewLockedStyles: z.array(z.string()).default([]),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

// --- Cached tap points ---
/**
 * How the server deduplicates repeat taps. Declared here rather than server-side because the web
 * client must branch on it: the same marker means "free, opens the child" under `reuse` and
 * "explored before, a new draw costs money" under `variant`.
 */
export const TapDedupModeSchema = z.enum(["reuse", "variant", "off"]);
export type TapDedupMode = z.infer<typeof TapDedupModeSchema>;

/** One already-generated child page reachable from a cached tap point. */
export const CachedTapChildSchema = z.object({
  id: z.string(),
  page_title: z.string(),
  /** The child's image at the requested aspect ratio, or null when that variant was never drawn. */
  image_url: z.string().nullable(),
  created_at: z.string(),
});
export type CachedTapChild = z.infer<typeof CachedTapChildSchema>;

/**
 * A spot on a page that has already been tapped and whose child pages still exist. Coordinates are
 * normalized [0,1] fractions of image width/height, matching the tap-marker geometry in
 * ./tapMath.ts.
 *
 * `children` is a list, not a single id, because only `reuse` mode collapses one subject to one
 * child. Under `variant` every repeat tap adds another child for the same subject, and picking one
 * of them to show would be an arbitrary choice presented to the user as the answer.
 */
export const CachedTapSchema = z.object({
  x: z.number(),
  y: z.number(),
  subject: z.string(),
  children: z.array(CachedTapChildSchema).min(1),
});
export type CachedTap = z.infer<typeof CachedTapSchema>;

export const NodeTapsResponseSchema = z.object({
  mode: TapDedupModeSchema,
  taps: z.array(CachedTapSchema),
});
export type NodeTapsResponse = z.infer<typeof NodeTapsResponseSchema>;

// --- Idle-loop video ---
// GET /api/nodes/:id/video: 404 with { ready: false } until the background clip is ready.
export const NodeVideoResponseSchema = z.object({ ready: z.literal(true), video_url: z.string() });
export type NodeVideoResponse = z.infer<typeof NodeVideoResponseSchema>;

// --- Page-transition morphs ---
// GET /api/nodes/:id/morph: 404 with { ready: false } until the pre-generated clip is ready.
// Pre-generated and cached only — never generated on demand, so navigation never waits on one.
export const NodeMorphResponseSchema = z.object({ ready: z.literal(true), morph_url: z.string() });
export type NodeMorphResponse = z.infer<typeof NodeMorphResponseSchema>;
