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

// --- Node (PLAN §1.2) ---
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
});
export type Node = z.infer<typeof NodeSchema>;

// --- Generate request (PLAN §1.3) ---
// mode "search": user typed a query
export const GenerateSearchRequestSchema = z.object({
  mode: z.literal("search").default("search"),
  query: z.string().min(1),
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  session_id: z.string(),
  current_node_id: z.string().default(""),
});
export type GenerateSearchRequest = z.infer<typeof GenerateSearchRequestSchema>;

// mode "tap": user clicked a point on the current image (marker already drawn client-side)
export const GenerateTapRequestSchema = z.object({
  mode: z.literal("tap"),
  image: z.string().startsWith("data:image/"),
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  parent_query: z.string(),
  parent_title: z.string(),
  session_id: z.string(),
  current_node_id: z.string(),
});
export type GenerateTapRequest = z.infer<typeof GenerateTapRequestSchema>;

// mode "edit": user typed a command while a page is open (re-render the current page)
export const GenerateEditRequestSchema = z.object({
  mode: z.literal("edit"),
  prompt: z.string().min(1),
  image: z.string().startsWith("data:image/"),
  aspect_ratio: AspectRatioSchema.default("16:9"),
  web_search: z.boolean().default(false),
  parent_query: z.string(),
  parent_title: z.string(),
  session_id: z.string(),
  current_node_id: z.string(),
});
export type GenerateEditRequest = z.infer<typeof GenerateEditRequestSchema>;

export const GenerateRequestSchema = z.discriminatedUnion("mode", [
  GenerateSearchRequestSchema,
  GenerateTapRequestSchema,
  GenerateEditRequestSchema,
]);
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

// --- SSE events (PLAN §1.3) ---
export const StartEventSchema = z.object({
  event: z.literal("start"),
  data: z.object({}).default({}),
});

export const TapSubjectEventSchema = z.object({
  event: z.literal("tap_subject"),
  data: z.object({ subject: z.string() }),
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

export const ErrorEventSchema = z.object({
  event: z.literal("error"),
  data: z.object({ message: z.string() }),
});

export const GenerateEventSchema = z.discriminatedUnion("event", [
  StartEventSchema,
  TapSubjectEventSchema,
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
