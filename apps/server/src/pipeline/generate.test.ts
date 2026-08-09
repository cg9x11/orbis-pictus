import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@orbis/shared";
import type {
  AuthorPromptInput,
  AuthorPromptOutput,
  ImageGenInput,
  ImageGenResult,
  ImageProvider,
  SearchProvider,
} from "../providers/types.js";

// Must be set before ./generate.js (imports storage/nodes.js -> storage/db.js) runs its
// module-level migrate(), same pattern as storage/nodes.test.ts.
process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orbis-generate-")), "test.db");

const { runGenerate } = await import("./generate.js");
const { getArtStyleBlock } = await import("./artStyle.js");
const { saveImageVariant } = await import("./imageStorage.js");
const { insertNode } = await import("../storage/nodes.js");
const { MockLlmProvider } = await import("../providers/llm/mock.js");
const { MockVideoProvider } = await import("../providers/video/mock.js");
const { createVideoPipeline } = await import("./video.js");
const { createMorphPipeline } = await import("./morph.js");

class SpyImageProvider implements ImageProvider {
  readonly modelId = "spy-image";
  readonly providerId = "spy";
  lastInput: ImageGenInput | undefined;
  /** How many times the provider was actually asked to draw — the only honest way to tell a real
   *  generation from a cache hit, since both return a usable image URL. */
  calls = 0;

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    this.lastInput = input;
    this.calls += 1;
    return { bytes: Buffer.from("fake-image-bytes"), contentType: "image/jpeg" };
  }
}

const noSearch: SearchProvider = { available: false, search: async () => null };

/** MockLlmProvider that records the input to authorPrompt, so a test can assert exactly what
 *  (if any) web-search summary the pipeline handed the authoring model. */
class SpyLlmProvider extends MockLlmProvider {
  lastAuthorInput: AuthorPromptInput | undefined;
  describeTapCalls = 0;
  async authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput> {
    this.lastAuthorInput = input;
    return super.authorPrompt(input);
  }
  async describeTap(markedImageDataUrl: string) {
    this.describeTapCalls++;
    return super.describeTap(markedImageDataUrl);
  }
}

// KNOWN OPEN ISSUE: a numeral badge stamped next to each callout ("numbered 1-6") is
// reliably duplicated/skipped by the image model. No built prompt, in any mode, should ask for one.
const NUMERAL_BADGE_INSTRUCTION = /numbered\s+1-\d+|numeral badge|pin number|digit badge/i;

function makeContext(image: ImageProvider) {
  return {
    providers: { llm: new MockLlmProvider(), image, video: new MockVideoProvider(), search: noSearch },
    imagesDir: fs.mkdtempSync(path.join(os.tmpdir(), "orbis-images-")),
    video: createVideoPipeline(),
    morph: createMorphPipeline(),
  };
}

test("search mode: the built image prompt includes the house style, authored_prompt does not", async () => {
  const image = new SpyImageProvider();
  const node = await runGenerate(
    { mode: "search", query: "Ha Noi street food", aspect_ratio: "16:9", web_search: false, video_loop: false, session_id: "s1", current_node_id: "" },
    makeContext(image),
    () => {},
  );

  const artStyle = getArtStyleBlock();
  assert.ok(image.lastInput?.prompt.includes(artStyle), "image prompt sent to the provider should include the art style block");
  assert.ok(!node.authored_prompt.includes(artStyle), "stored authored_prompt (content-only) should not include the art style block");
  assert.doesNotMatch(image.lastInput!.prompt, NUMERAL_BADGE_INSTRUCTION);
});

// The client's progress readout is driven entirely by these events, so their presence and order is
// a contract, not decoration: without them the UI falls back to one static word for the whole
// 30-60 second wait, which is what made a generation look like a frozen page.
test("emits ordered stage events, with the page title available from `drawing` onwards", async () => {
  const events: { event: string; data: unknown }[] = [];
  await runGenerate(
    { mode: "search", query: "lighthouse lenses", aspect_ratio: "16:9", web_search: false, video_loop: false, session_id: "s-stage", current_node_id: "" },
    makeContext(new SpyImageProvider()),
    (event) => {
      events.push({ event: event.event, data: event.data });
    },
  );

  const stages = events.filter((e) => e.event === "stage").map((e) => e.data as { stage: string; pageTitle?: string });
  // No web_search on this request, so "searching" must be absent rather than reported and skipped.
  assert.deepEqual(
    stages.map((s) => s.stage),
    ["authoring", "drawing"],
  );
  assert.equal(stages[0]?.pageTitle, undefined, "the page is not named until the authoring model has run");
  assert.ok(stages[1]?.pageTitle, "the drawing stage should carry the authored page title");

  // Every stage must land before the image does, or the readout describes work already finished.
  const order = events.map((e) => e.event);
  assert.ok(order.lastIndexOf("stage") < order.indexOf("preview"));
  assert.ok(order.indexOf("preview") < order.indexOf("complete"));
});

test("a web-search generation reports the lookup as its own stage", async () => {
  const events: string[] = [];
  const search: SearchProvider = { available: true, search: async () => ({ summary: "some findings" }) };
  await runGenerate(
    { mode: "search", query: "lighthouse lenses", aspect_ratio: "16:9", web_search: true, video_loop: false, session_id: "s-stage-search", current_node_id: "" },
    { ...makeContext(new SpyImageProvider()), providers: { ...makeContext(new SpyImageProvider()).providers, search } },
    (event) => {
      if (event.event === "stage") events.push(event.data.stage);
    },
  );

  assert.deepEqual(events, ["searching", "authoring", "drawing"]);
});

test("web search: the query is sharpened with the parent page title as context (node.query stays the bare topic)", async () => {
  const parent: Node = {
    id: "parent-search-ctx",
    parent_id: null,
    session_id: "s-enrich",
    query: "kyoto temples",
    page_title: "Kyoto Temple Guide",
    image_variants: {},
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    labels: [],
    footer: "",
    labels_aspect: null,
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const seen: string[] = [];
  const search: SearchProvider = {
    available: true,
    search: async (q) => {
      seen.push(q);
      return { summary: "temple facts" };
    },
  };
  const base = makeContext(new SpyImageProvider());
  const node = await runGenerate(
    { mode: "search", query: "the pagoda", aspect_ratio: "16:9", web_search: true, video_loop: false, session_id: "s-enrich", current_node_id: "parent-search-ctx" },
    { ...base, providers: { ...base.providers, search } },
    () => {},
  );

  assert.deepEqual(seen, ["the pagoda (in the context of Kyoto Temple Guide)"]);
  assert.equal(node.query, "the pagoda", "the persisted topic must stay the bare subject, not the enriched search query");
});

test("web search degraded: the model-knowledge-only summary is dropped, not passed to the author as grounding", async () => {
  const spyLlm = new SpyLlmProvider();
  const search: SearchProvider = { available: true, search: async () => ({ summary: "unverified model text", degraded: true }) };
  const base = makeContext(new SpyImageProvider());
  await runGenerate(
    { mode: "search", query: "this weekend's lineup", aspect_ratio: "16:9", web_search: true, video_loop: false, session_id: "s-degraded", current_node_id: "" },
    { ...base, providers: { ...base.providers, llm: spyLlm, search } },
    () => {},
  );

  assert.equal(spyLlm.lastAuthorInput?.webSearchSummary, undefined);
});

test("web search genuine: a non-degraded summary IS forwarded to the author", async () => {
  const spyLlm = new SpyLlmProvider();
  const search: SearchProvider = { available: true, search: async () => ({ summary: "verified web facts" }) };
  const base = makeContext(new SpyImageProvider());
  await runGenerate(
    { mode: "search", query: "opening hours", aspect_ratio: "16:9", web_search: true, video_loop: false, session_id: "s-genuine", current_node_id: "" },
    { ...base, providers: { ...base.providers, llm: spyLlm, search } },
    () => {},
  );

  assert.equal(spyLlm.lastAuthorInput?.webSearchSummary, "verified web facts");
});

test("edit mode: the built image prompt includes the house style and passes the current image as reference", async () => {
  const ctx = makeContext(new SpyImageProvider());
  const parentImageBytes = Buffer.from("parent-page-pixels");
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-edit", "16:9", parentImageBytes, "image/jpeg");
  const parent: Node = {
    id: "parent-edit",
    parent_id: null,
    session_id: "s1",
    query: "Ha Noi street food",
    page_title: "Ha Noi Street Food",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    labels: [],
    footer: "",
    labels_aspect: null,
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const currentImageDataUrl = `data:image/jpeg;base64,${Buffer.from("current-page-pixels").toString("base64")}`;
  const image = ctx.providers.image as SpyImageProvider;
  const node = await runGenerate(
    {
      mode: "edit",
      prompt: "make it night time",
      currentImage: currentImageDataUrl,
      aspect_ratio: "16:9",
      web_search: false,
      video_loop: false,
      parent_title: "Ha Noi Street Food",
      session_id: "s1",
      current_node_id: "parent-edit",
    },
    ctx,
    () => {},
  );

  const artStyle = getArtStyleBlock();
  assert.ok(image.lastInput?.prompt.includes(artStyle));
  assert.ok(!node.authored_prompt.includes(artStyle));
  assert.equal(image.lastInput?.referenceImageDataUrl, currentImageDataUrl);
  assert.doesNotMatch(image.lastInput!.prompt, NUMERAL_BADGE_INSTRUCTION);

  // An edit has no topic of its own: the node's query/topic must inherit the parent's ("Ha Noi
  // street food"), never the edit command itself ("make it night time") — otherwise a web search
  // (when enabled) would search for the edit instruction, and the persisted query would be it too.
  assert.equal(node.query, parent.query);
  assert.notEqual(node.query, "make it night time");
});

test("edit mode: a ratio-changing edit drops the carried labels and stamps its own ratio, so no callout is ever misplaced", async () => {
  // Regression: an edit carries the parent's labels VERBATIM (their {x,y} live in the parent's
  // composition). If the aspect picker was switched before the edit, those coordinates cannot be
  // placed on the new, differently-composed image. So the labels are dropped and labels_aspect is
  // this node's own ratio — the callouts never show misplaced (the fixed title/footer still render).
  const ctx = makeContext(new SpyImageProvider());
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-edit-ratio", "16:9", Buffer.from("px"), "image/jpeg");
  const parent: Node = {
    id: "parent-edit-ratio",
    parent_id: null,
    session_id: "s1",
    query: "Ha Noi street food",
    page_title: "Ha Noi Street Food",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    labels: [{ text: "Pho", description: "", subject: "a bowl of pho", x: 0.5, y: 0.5 }],
    footer: "",
    labels_aspect: "16:9",
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const node = await runGenerate(
    {
      mode: "edit",
      prompt: "make it night time",
      currentImage: `data:image/jpeg;base64,${Buffer.from("cur").toString("base64")}`,
      aspect_ratio: "3:4", // picker switched away from the parent's 16:9 before editing
      web_search: false,
      video_loop: false,
      parent_title: "Ha Noi Street Food",
      session_id: "s1",
      current_node_id: "parent-edit-ratio",
    },
    ctx,
    () => {},
  );

  assert.equal(node.labels_aspect, "3:4"); // this node's own image ratio, not the parent's
  assert.deepEqual(node.labels, []); // carried 16:9 labels dropped — they can't be placed at 3:4
});

test("tap mode: the built image prompt includes the house style and reuses the parent page image as reference", async () => {
  const ctx = makeContext(new SpyImageProvider());
  const parentImageBytes = Buffer.from("parent-page-pixels-for-tap");
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-tap", "16:9", parentImageBytes, "image/jpeg");
  const parent: Node = {
    id: "parent-tap",
    parent_id: null,
    session_id: "s1",
    query: "Ha Noi street food",
    page_title: "Ha Noi Street Food",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    labels: [],
    footer: "",
    labels_aspect: null,
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const markedImageDataUrl = `data:image/jpeg;base64,${Buffer.from("marked-with-tap-circle").toString("base64")}`;
  const image = ctx.providers.image as SpyImageProvider;
  const node = await runGenerate(
    {
      mode: "tap",
      markedImage: markedImageDataUrl,
      x: 0.5,
      y: 0.5,
      aspect_ratio: "16:9",
      web_search: false,
      video_loop: false,
      force_new_image: false,
      parent_title: "Ha Noi Street Food",
      session_id: "s1",
      current_node_id: "parent-tap",
    },
    ctx,
    () => {},
  );

  const artStyle = getArtStyleBlock();
  assert.ok(image.lastInput?.prompt.includes(artStyle));
  assert.ok(!node.authored_prompt.includes(artStyle));

  // The reference image must be the parent's own stored page image, not the marked tap image.
  const expectedReference = `data:image/jpeg;base64,${parentImageBytes.toString("base64")}`;
  assert.equal(image.lastInput?.referenceImageDataUrl, expectedReference);
  assert.notEqual(image.lastInput?.referenceImageDataUrl, markedImageDataUrl);
  assert.doesNotMatch(image.lastInput!.prompt, NUMERAL_BADGE_INSTRUCTION);
});

test("tap mode: a known_subject (label tap) skips the VLM and generates a child for that subject", async () => {
  // Phase 6a: tapping a label plaque carries the subject, so the server must NOT call describeTap.
  const ctx = makeContext(new SpyImageProvider());
  const spyLlm = new SpyLlmProvider();
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-label-tap", "16:9", Buffer.from("px"), "image/jpeg");
  const parent: Node = {
    id: "parent-label-tap",
    parent_id: null,
    session_id: "s1",
    query: "Ho Chi Minh City",
    page_title: "Ho Chi Minh City",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    labels: [{ text: "Notre-Dame", description: "", subject: "twin-spired red-brick cathedral", x: 0.2, y: 0.25 }],
    footer: "",
    labels_aspect: "16:9",
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const node = await runGenerate(
    {
      mode: "tap",
      known_subject: "twin-spired red-brick cathedral", // no markedImage — this is a label tap
      x: 0.2,
      y: 0.25,
      aspect_ratio: "16:9",
      web_search: false,
      video_loop: false,
      force_new_image: false,
      parent_title: "Ho Chi Minh City",
      session_id: "s1",
      current_node_id: "parent-label-tap",
    },
    { ...ctx, providers: { ...ctx.providers, llm: spyLlm } },
    () => {},
  );

  assert.equal(spyLlm.describeTapCalls, 0); // the VLM was never asked
  assert.equal(node.query, "twin-spired red-brick cathedral"); // child is about the label's subject
  assert.equal(node.parent_id, "parent-label-tap");
});

test("tap mode: a free-form tap ON a labelled subject reuses the label's subject and skips the VLM", async () => {
  // Phase 6a dedup: tapping the drawn object (not the plaque) within a label's hotspot must resolve
  // to that label's subject, so a tap on the object and a tap on its plaque produce ONE child, not
  // two — and the VLM is not called for a spot we already have a subject for.
  const ctx = makeContext(new SpyImageProvider());
  const spyLlm = new SpyLlmProvider();
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-hotspot", "16:9", Buffer.from("px"), "image/jpeg");
  const parent: Node = {
    id: "parent-hotspot",
    parent_id: null,
    session_id: "s1",
    query: "Ho Chi Minh City",
    page_title: "Ho Chi Minh City",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    labels: [{ text: "Notre-Dame", description: "", subject: "twin-spired red-brick cathedral", x: 0.2, y: 0.25 }],
    footer: "",
    labels_aspect: "16:9",
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const node = await runGenerate(
    {
      mode: "tap",
      markedImage: `data:image/jpeg;base64,${Buffer.from("marked").toString("base64")}`,
      x: 0.21, // inside the cathedral label's hotspot (anchor 0.2, 0.25)
      y: 0.26,
      aspect_ratio: "16:9",
      web_search: false,
      video_loop: false,
      force_new_image: false,
      parent_title: "Ho Chi Minh City",
      session_id: "s1",
      current_node_id: "parent-hotspot",
    },
    { ...ctx, providers: { ...ctx.providers, llm: spyLlm } },
    () => {},
  );

  assert.equal(spyLlm.describeTapCalls, 0); // resolved from the label, not the VLM
  assert.equal(node.query, "twin-spired red-brick cathedral"); // same subject a plaque tap would give
});

// The tap panel's "Draw a new version" button is the user choosing to spend. If layer 3 could still
// answer it, the button would sometimes return the identical picture and look broken. The mock LLM
// is deterministic, so a repeat tap authors a byte-identical prompt — exactly the collision that
// makes this reachable in production, reproduced here without depending on model temperature.
test("tap mode: force_new_image bypasses the layer-3 prompt-hash cache", async () => {
  const previousMode = process.env.TAP_DEDUP;
  // Layer 2 would return the existing child before layer 3 is ever consulted, so the reuse default
  // cannot exercise this path. Variant mode is where the button lives anyway.
  process.env.TAP_DEDUP = "variant";
  try {
    const image = new SpyImageProvider();
    const ctx = makeContext(image);
    const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-force", "16:9", Buffer.from("parent-pixels"), "image/jpeg");
    const parent: Node = {
      id: "parent-force",
      parent_id: null,
      session_id: "s-force",
      query: "force new image parent",
      page_title: "Force New Image Parent",
      image_variants: { "16:9": parentImageUrl },
      image_model: "mock-image",
      image_provider: "mock",
      art_style: "felt",
      composition: "diorama",
      prompt_author_model: "mock-llm",
      authored_prompt: "content prompt for the force-new parent",
      labels: [],
      footer: "",
      labels_aspect: null,
      created_at: new Date().toISOString(),
      version: 1,
      video_status: null,
      morph_status: null,
    };
    insertNode(parent, { normalizedSubject: "root-force" });

    const tap = (force: boolean) =>
      runGenerate(
        {
          mode: "tap" as const,
          markedImage: `data:image/jpeg;base64,${Buffer.from("marked").toString("base64")}`,
          x: 0.3,
          y: 0.3,
          aspect_ratio: "16:9" as const,
          web_search: false,
          video_loop: false,
          force_new_image: force,
          parent_title: "Force New Image Parent",
          session_id: "s-force",
          current_node_id: "parent-force",
        },
        ctx,
        () => {},
      );

    const first = await tap(false);
    assert.equal(image.calls, 1, "the first tap must actually draw");

    // Same spot, same subject, same authored prompt: layer 3 answers and nothing is drawn.
    const second = await tap(false);
    assert.equal(image.calls, 1, "an ordinary repeat tap should be served from the prompt-hash cache");
    assert.equal(second.image_variants["16:9"], first.image_variants["16:9"], "cached hit reuses the earlier pixels");

    // Same request again, but asked for outright: the cache must be skipped.
    const third = await tap(true);
    assert.equal(image.calls, 2, "force_new_image must reach the provider");
    assert.notEqual(third.image_variants["16:9"], first.image_variants["16:9"], "a forced draw must store its own image");
  } finally {
    if (previousMode === undefined) delete process.env.TAP_DEDUP;
    else process.env.TAP_DEDUP = previousMode;
  }
});
