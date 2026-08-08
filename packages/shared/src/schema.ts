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
});
export type Node = z.infer<typeof NodeSchema>;

// --- Generate request ---
// mode "search": user typed a query
export const GenerateSearchRequestSchema = z.object({
  mode: z.literal("search"),
  query: z.string().min(1),
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  // Whether the client's "Live video stream" toggle is on. Gates background idle-loop AND morph
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
  current_node_id: z.string().default(""),
});
export type GenerateSearchRequest = z.infer<typeof GenerateSearchRequestSchema>;

// mode "tap": user clicked a point on the current image (marker already drawn client-side)
export const GenerateTapRequestSchema = z.object({
  mode: z.literal("tap"),
  // The current page image WITH a marker drawn at the click point — never the plain image. The
  // VLM resolves the tapped subject visually from the marker, not from x/y.
  markedImage: z.string().startsWith("data:image/"),
  // Click point as a fraction (0..1) of the displayed image's width/height — same coordinate
  // space as the marker drawn into `markedImage`. Used server-side for the tap-cache lookup:
  // the VLM never sees these, it still resolves the subject visually from the marker.
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  // Whether the client's "Live video stream" toggle is on. Gates background idle-loop AND morph
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
  parent_title: z.string(),
  session_id: z.string(),
  current_node_id: z.string(),
});
export type GenerateTapRequest = z.infer<typeof GenerateTapRequestSchema>;

// mode "edit": user typed a command while a page is open (re-render the current page)
export const GenerateEditRequestSchema = z.object({
  mode: z.literal("edit"),
  prompt: z.string().min(1),
  // The current page image, plain — unlike GenerateTapRequestSchema's markedImage, no marker is
  // ever drawn into this one.
  currentImage: z.string().startsWith("data:image/"),
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  // Whether the client's "Live video stream" toggle is on. Gates background idle-loop AND morph
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
  parent_title: z.string(),
  session_id: z.string(),
  current_node_id: z.string(),
});
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

export const GenerateEventSchema = z.discriminatedUnion("event", [
  StartEventSchema,
  TapSubjectEventSchema,
  StageEventSchema,
  PreviewEventSchema,
  CompleteEventSchema,
  ErrorEventSchema,
]);
export type GenerateEvent = z.infer<typeof GenerateEventSchema>;

// --- Nodes persistence API ---
export const NodesCreateRequestSchema = NodeSchema.omit({ created_at: true, version: true }).extend({
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

// --- Gallery listing (landing page) — reuses already-generated nodes, zero new generations ---
export const NodesListResponseSchema = z.object({ nodes: z.array(NodeSchema) });
export type NodesListResponse = z.infer<typeof NodesListResponseSchema>;

// --- Upload entry point ---
export const NodesUploadRequestSchema = z.object({
  image: z.string().startsWith("data:image/"),
  aspect_ratio: AspectRatioSchema,
  session_id: z.string(),
});
export type NodesUploadRequest = z.infer<typeof NodesUploadRequestSchema>;

// --- Server config, for feature-availability toggles in the UI ---
export const ArtStyleOptionSchema = z.object({ name: z.string(), label: z.string() });
export type ArtStyleOption = z.infer<typeof ArtStyleOptionSchema>;

export const ConfigResponseSchema = z.object({
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
  /** Every composition block available in art-style.md (flat / diorama), for the picker. */
  compositions: z.array(ArtStyleOptionSchema).default([]),
  /** The server's own default (the COMPOSITION env), used as the picker's initial value. */
  composition: z.string().default("diorama"),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

// --- Cached tap points ---
/**
 * A spot on a page that has already been tapped and whose child page still exists, so tapping it
 * again opens that child immediately and generates nothing. Coordinates are normalized [0,1]
 * fractions of image width/height, matching the tap-marker geometry in pipeline/tapMath.ts.
 */
export const CachedTapSchema = z.object({
  x: z.number(),
  y: z.number(),
  subject: z.string(),
  child_id: z.string(),
});
export type CachedTap = z.infer<typeof CachedTapSchema>;

export const NodeTapsResponseSchema = z.object({ taps: z.array(CachedTapSchema) });
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
