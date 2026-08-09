import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  isWithinTapRadius,
  type AspectRatio,
  type CachedTap,
  type GenerateRequest,
  type ArtStyleOption,
  type ModelSettings,
  type Node,
} from "@orbis/shared";
import { pruneEmptyPrefs, readModelPrefs, writeModelPrefs, type ModelPrefs } from "../lib/persistedPrefs";
import { useCachedTaps } from "./useCachedTaps";
import { useGenerationStream } from "./useGenerationStream";
import { useSessionTrail } from "./useSessionTrail";
import { useTapMarker } from "./useTapMarker";
import { useDelayedFlag } from "./useDelayedFlag";
import { usePageAnalytics } from "./usePageAnalytics";
import { useIdleLoopVideo } from "./useIdleLoopVideo";
import { useMorphTransition } from "./useMorphTransition";
import { useCancellableEffect } from "./useCancellableEffect";
import {
  fetchConfig,
  fetchNode,
  fetchVariant,
  requestNodeMorph,
  requestNodeVideo,
  waitForMorphReady,
  waitForVideoReady,
} from "../lib/api";
import { captureCurrentImage } from "../lib/imageCapture";
import { drawTapMarker } from "../lib/tapMarker";

function newSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

// Fetched (and, for webSearch/artStyle, later user-adjusted) as one unit — grouped into a single
// state object rather than one useState per field, matching useGenerationStream's GenerationState
// and useSessionTrail's TrailState.
interface AppConfig {
  webSearch: boolean;
  videoAvailable: boolean;
  morphAvailable: boolean;
  uploadAvailable: boolean;
  artStyles: ArtStyleOption[];
  artStyle: string;
  compositions: ArtStyleOption[];
  composition: string;
  /** What the settings panel can offer, and what the server is using — see ModelSettingsSchema. */
  modelSettings: ModelSettings;
}

/** Empty until /api/config answers. The panel hides itself while the provider lists are empty,
 *  the same way ArtStylePicker does with fewer than two styles. */
const EMPTY_MODEL_SETTINGS: ModelSettings = {
  image: { providers: [], provider: "", model: "" },
  video: {
    providers: [],
    provider: "",
    model: "",
    resolutions: [],
    resolution: "",
    durationSeconds: 5,
    maxDurationSeconds: 12,
  },
  extras: {
    geminiImageSizes: [],
    geminiImageSize: "",
    openaiImageQualities: [],
    openaiImageQuality: "",
    arkFallbackModel: "",
  },
};

const DEFAULT_CONFIG: AppConfig = {
  webSearch: false,
  videoAvailable: false,
  morphAvailable: false,
  uploadAvailable: false,
  artStyles: [],
  artStyle: "",
  compositions: [],
  composition: "",
  modelSettings: EMPTY_MODEL_SETTINGS,
};

/**
 * All of OrbisApp's non-rendering state and behavior — session/trail, config, generation
 * requests, video/morph/tap-cache side state, and every handler — leaving the component itself as
 * render/composition only. Named per the app it drives; not meant to be reused elsewhere.
 */
export function useOrbisController(initialNodeId?: string) {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string>(newSessionId);
  const [hydrating, setHydrating] = useState(!!initialNodeId);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const { trail, currentIndex, current, append, navigateTo, reset, updateNode } = useSessionTrail();
  const { state, start, reset: resetGeneration } = useGenerationStream();
  const { captureTap } = useTapMarker();
  const { milestone, recordPage, dismissMilestone } = usePageAnalytics();
  const [ripple, setRipple] = useState<{ xRatio: number; yRatio: number } | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [variantLoading, setVariantLoading] = useState(false);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const setWebSearch = (webSearch: boolean) => setConfig((c) => ({ ...c, webSearch }));
  const setArtStyle = (artStyle: string) => setConfig((c) => ({ ...c, artStyle }));
  const setComposition = (composition: string) => setConfig((c) => ({ ...c, composition }));
  // Unlike the style pickers above, these survive a reload: a provider/model is a setup choice, not
  // a per-page creative one, so re-picking it on every visit would be tedious.
  const [modelPrefs, setModelPrefsState] = useState<ModelPrefs>(readModelPrefs);
  const setModelPrefs = (next: ModelPrefs) => {
    setModelPrefsState(next);
    writeModelPrefs(next);
  };
  const [videoLoopEnabled, setVideoLoopEnabled] = useState(false);
  // First-step animation flow: true while navigation is being held on the parent, waiting for the
  // freshly generated child's clips so the whole transition plays through without a gap.
  const [preparingClips, setPreparingClips] = useState(false);
  // True only for the brief POST round-trip of an on-demand video request, so the "Generate video"
  // button can't be double-fired; once the node flips to "pending" the button hides on its own.
  const [videoRequestPending, setVideoRequestPending] = useState(false);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  // Surfaces a non-generation failure (open a cached tap, switch ratio, upload) in the same error
  // banner the generation flow uses, instead of the spinner just stopping with no explanation.
  const [actionError, setActionError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useCancellableEffect((cancelled) => {
    fetchConfig()
      .then((fetched) => {
        if (cancelled()) return;
        setConfig({
          webSearch: fetched.searchAvailable,
          videoAvailable: fetched.videoEnabled,
          morphAvailable: fetched.morphEnabled,
          uploadAvailable: fetched.uploadEnabled,
          artStyles: fetched.artStyles,
          artStyle: fetched.artStyle,
          compositions: fetched.compositions,
          composition: fetched.composition,
          modelSettings: fetched.modelSettings,
        });
      })
      .catch((err) => console.error(err));
  }, []);

  useCancellableEffect(
    (cancelled) => {
      if (!initialNodeId) return;
      fetchNode(initialNodeId)
        .then(({ node, history }) => {
          if (cancelled()) return;
          reset([...history, node]);
          setSessionId(node.session_id);
          setHydrating(false);
        })
        .catch((err) => {
          if (cancelled()) return;
          setHydrateError(err instanceof Error ? err.message : "Failed to load page");
          setHydrating(false);
        });
    },
    [initialNodeId, reset],
  );

  const isStreaming = state.status === "streaming";
  // "The app is busy and must not accept a new action": either a generation is streaming, or we are
  // holding navigation for a first-step morph. Interaction guards and disabled states key off this
  // rather than isStreaming alone so nothing new can start during the morph wait; streaming-only
  // rendering (the progress overlay, preview image, tap-subject banner) still keys off isStreaming.
  const busy = isStreaming || preparingClips;
  // Real generations and cache-hit instant navigations both count as a "page".
  const showLoadingIndicator = useDelayedFlag(isStreaming || variantLoading, 150);
  // Purely additive — polls for a background idle-loop clip once the page is
  // settled (never while still streaming in a new one) and the experimental toggle is on.
  const idleLoopVideoUrl = useIdleLoopVideo(current?.id, videoLoopEnabled && !isStreaming, current?.video_status);
  // The parent page is already shown, but its idle-loop clip is still rendering in
  // the background (video_status "pending", not yet fetched). Mirror the toggle's own "generating"
  // state onto the image so the wait is visible there too — this stops right when the clip either
  // arrives (idleLoopVideoUrl set) or the page is left. It never blocks tapping; see PageImage.
  const videoGenerating = videoLoopEnabled && !isStreaming && !idleLoopVideoUrl && current?.video_status === "pending";
  // Once a page's background idle-loop clip has actually been fetched, record "ready" on its trail
  // node. The `complete` event first delivered it as "pending" and nothing else updates it, so
  // without this a later revisit re-reads the stale "pending", polls from a 4s delay, and re-shows
  // "Generating video…" for that whole window even though the clip finished long ago.
  useEffect(() => {
    if (idleLoopVideoUrl && current && current.video_status !== "ready") {
      updateNode({ ...current, video_status: "ready" });
    }
  }, [idleLoopVideoUrl, current, updateNode]);
  // On-demand path: a page created while Live video was off has no clips and never
  // will automatically (both statuses null), and a prior on-demand attempt may have failed — all
  // retryable by explicit request. The two clips are tracked separately because a page can genuinely
  // be missing just one of them, so the action stays on offer while EITHER is absent. A morph needs
  // a parent to morph from, so a root page can only ever want the idle loop.
  const missingIdleLoop = !idleLoopVideoUrl && (current?.video_status === null || current?.video_status === "failed");
  const missingMorph =
    !!current?.parent_id && (current.morph_status === null || current.morph_status === "failed");
  // Offer the action only when the feature is actually available and the toggle is on, never mid-generation.
  const canGenerateVideo =
    config.videoAvailable && videoLoopEnabled && !isStreaming && !!current && (missingIdleLoop || missingMorph);
  // A single non-blocking check per navigation, never gates the page render.
  const { morphUrl, morphPending, clearMorph } = useMorphTransition(current, config.morphAvailable);
  // A transition is under way: its clip is being looked up, or is on screen. The destination image
  // stays covered and its tap markers stay hidden for this whole window — during a morph the pixels
  // on screen are the clip, not the page underneath, so a tap would land on coordinates of a page
  // the user cannot currently see. Deliberately NOT folded into `busy`: the toolbar and breadcrumbs
  // stay live, this only governs what the picture itself accepts and shows.
  const morphActive = morphPending || morphUrl !== null;
  // Spots on this page already explored, shown as markers so a free tap is visible
  // before it is made.
  const { taps: cachedTaps, mode: tapDedupMode, loading: tapsLoading } = useCachedTaps(current?.id, aspectRatio);

  // The explored spot a variant-mode tap landed on, or null when no panel is open. Holding the tap
  // itself (not just its id) keeps the panel's own subject and child list stable while it is open,
  // even if a refetch swaps the underlying array.
  const [variantPanelTap, setVariantPanelTap] = useState<CachedTap | null>(null);

  // Any tap the cache would treat as a repeat of this one. This is the SAME predicate the server
  // uses for its layer-1 lookup, imported from @orbis/shared rather than re-derived here: if the two
  // ever disagreed, a click could be a cache hit server-side while the UI called it new ground.
  const findExploredTapAt = (x: number, y: number): CachedTap | undefined =>
    cachedTaps.find((tap) => isWithinTapRadius(aspectRatio, tap.x, tap.y, x, y));

  // The panel describes one spot on one page at one aspect ratio. When any of those change the tap
  // it was opened for no longer refers to anything on screen, so it must close rather than keep
  // offering to draw at coordinates belonging to a page the user has left.
  useEffect(() => {
    setVariantPanelTap(null);
  }, [current?.id, aspectRatio]);

  // A deep-linked page arrives with its title already rendered into the HTML by the server (for
  // link unfurling), and nothing updated it afterwards — so going Home, or opening any other page,
  // left the browser tab still naming the page you had left.
  useEffect(() => {
    document.title = current ? `${current.page_title} — Orbis Pictus` : "Orbis Pictus";
  }, [current?.id, current?.page_title]);

  // Keep the address bar pointed at the current node so a full page reload (a manual refresh, or the
  // Vite/dev server restarting after a code edit) restores the exact page instead of dropping to an
  // empty session. The node is always already persisted server-side — pipeline/generate.ts inserts
  // it before the `complete` event — so only the in-memory trail is at risk; on reload the browser
  // loads this `/n/:id` URL and the existing hydrate path rebuilds the trail from the node's stored
  // ancestry. We use history.replaceState rather than react-router navigation on purpose: it updates
  // the URL silently, without remounting the app or re-triggering the `/n/:id` hydrate mid-session,
  // and adds no Back-button entry per page (the in-app breadcrumb already handles going back).
  useEffect(() => {
    const path = current?.id ? `/n/${current.id}` : "/";
    if (window.location.pathname !== path) {
      window.history.replaceState(window.history.state, "", path);
    }
  }, [current?.id]);

  const runRequest = async (request: GenerateRequest) => {
    // Injected in one place rather than at each call site, so no generation path can silently fall
    // back to the server's default style. Empty until /api/config has answered, and omitted rather
    // than sent blank so the server keeps its own default in that window.
    const withStyle = {
      ...request,
      // Pruned, not sent raw: an empty duration field would otherwise fail the request schema and
      // 400 the whole generation rather than just being ignored.
      ...pruneEmptyPrefs(modelPrefs),
      art_style: config.artStyle || undefined,
      composition: config.composition || undefined,
      // Gates background idle-loop and morph generation server-side: no video quota is spent unless
      // the user actually has Live video on. Mirrors the toggle that already controls display.
      video_loop: videoLoopEnabled,
    };
    setLastRequest(withStyle);
    setActionError(null);
    try {
      const node = await start(withStyle);
      // First-step animation flow: hold on the parent until every clip the server actually started
      // for this child is in hand, then show the child with all of them ready. A "pending" status is
      // set before `complete` and only when that clip is genuinely on its way (Live video on, and for
      // a morph also a parent plus room under the per-session cap), so anything still null is never
      // waited for and navigation stays instant exactly as before.
      //
      // Both clips are waited on together, not one after the other: the server fires them in parallel,
      // and waiting only for the morph — as this first did — meant the page arrived mid-render of its
      // idle loop and sat under a "Generating video…" badge right after the transition, which is the
      // gap the wait exists to remove. The wait is bounded (timeout + failure bail inside each waiter)
      // so a stalled generation can never hang the transition.
      const needsMorph = config.morphAvailable && node.morph_status === "pending";
      const needsVideo = node.video_status === "pending";
      let ready = node;
      if (needsMorph || needsVideo) {
        setPreparingClips(true);
        try {
          const [morphUrl, videoUrl] = await Promise.all([
            needsMorph ? waitForMorphReady(node.id) : Promise.resolve(null),
            needsVideo ? waitForVideoReady(node.id) : Promise.resolve(null),
          ]);
          // Record what actually landed. Without this the node still says "pending" on arrival, and
          // useIdleLoopVideo holds its first request back by a full backoff step — so a clip we just
          // finished waiting for would sit unused for another few seconds after the morph played.
          ready = {
            ...node,
            morph_status: morphUrl ? "ready" : node.morph_status,
            video_status: videoUrl ? "ready" : node.video_status,
          };
        } finally {
          setPreparingClips(false);
        }
      }
      append(ready);
      recordPage();
    } catch (err) {
      // useGenerationStream already set state.error/status before rejecting, so the error banner
      // is already showing — this only stops the rejection from reaching handleTap/handleEdit/
      // handleSearch's callers (PageImage's onClick, AddressBar's onSubmit, a suggestion chip's
      // onClick) as an unhandled promise rejection.
      console.error(err);
    }
  };

  // Shared across all three request modes; current_node_id defaults to "" for a mode-less first
  // search, and is otherwise guaranteed present by each handler's own `if (!current) return` guard.
  const baseRequestFields = () => ({
    aspect_ratio: aspectRatio,
    web_search: config.webSearch,
    session_id: sessionId,
    current_node_id: current?.id ?? "",
  });

  const handleSearch = (query: string) => {
    if (busy) return;
    return runRequest({
      mode: "search",
      query,
      ...baseRequestFields(),
    });
  };

  const handleTap = (imageEl: HTMLImageElement, clientX: number, clientY: number) => {
    // `tapsLoading` guards money, not correctness of display. Until /taps answers, this page's
    // explored spots are UNKNOWN, and generating on an unknown is the one mistake that cannot be
    // undone — it spends. Waiting costs a few tens of milliseconds against a local database, and
    // the fetch always settles (the failure path clears the flag too), so a tap is never dead.
    if (!current || busy || morphActive || tapsLoading) return;
    const { dataUrl, xRatio, yRatio } = captureTap(imageEl, clientX, clientY);

    // Decide BEFORE spending. The marker dot is ~9px wide but the cache treats anything within
    // 8.5% of the image's shorter side as the same tap, so gating on "did you hit the dot" would
    // make a precise click free and a click 30px away cost an image — the same intent billed two
    // different ways. Gating on the real radius instead means every click the server would call a
    // repeat is routed identically, wherever inside the circle it lands.
    const explored = tapDedupMode === "variant" ? findExploredTapAt(xRatio, yRatio) : undefined;
    if (explored) {
      setRipple({ xRatio, yRatio });
      setVariantPanelTap(explored);
      return;
    }

    setRipple({ xRatio, yRatio });
    return runRequest({
      mode: "tap",
      markedImage: dataUrl,
      x: xRatio,
      y: yRatio,
      force_new_image: false,
      parent_title: current.page_title,
      ...baseRequestFields(),
    });
  };

  /**
   * Phase 6a: a tap on a layered-page label plaque. The label already carries its subject, so this
   * sends `known_subject` and NO marked image — the server skips the VLM entirely. Everything else
   * mirrors handleTap: the same money/busy guards, the same variant-mode "already explored" gate
   * (so a second tap on a labelled spot opens the panel instead of spending), the same runRequest.
   */
  const handleLabelTap = (subject: string, x: number, y: number) => {
    if (!current || busy || morphActive || tapsLoading) return;

    const explored = tapDedupMode === "variant" ? findExploredTapAt(x, y) : undefined;
    if (explored) {
      setRipple({ xRatio: x, yRatio: y });
      setVariantPanelTap(explored);
      return;
    }

    setRipple({ xRatio: x, yRatio: y });
    return runRequest({
      mode: "tap",
      known_subject: subject,
      x,
      y,
      force_new_image: false,
      parent_title: current.page_title,
      ...baseRequestFields(),
    });
  };

  /**
   * Opens an already-generated child by id. Deliberately does not go through runRequest: both
   * callers (the free `reuse` marker and the variant panel's list) exist precisely because this
   * path touches no provider at all, so it fetches the stored node and appends it to the trail.
   */
  const openExistingChild = async (childId: string) => {
    if (busy) return;
    setActionError(null);
    try {
      const { node } = await fetchNode(childId);
      setVariantPanelTap(null);
      append(node);
      recordPage();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Couldn't open that page");
    }
  };

  /** `reuse` mode only: the green marker is a shortcut to the single child behind it. */
  const handleOpenCachedTap = (tap: CachedTap) => {
    // The schema promises min(1) and fetchNodeTaps now parses rather than casts, so this is
    // belt-and-braces — but the cost of being wrong is an uncaught TypeError in a click handler
    // with no error boundary above it, which blanks the page.
    const first = tap.children[0];
    if (!first) return;
    return openExistingChild(first.id);
  };

  /** `variant` mode only: the amber marker opens the panel. Same destination as tapping anywhere
   *  else inside the marker radius, so the dot and its surroundings never disagree. */
  const handleInspectCachedTap = (tap: CachedTap) => {
    if (busy || morphActive) return;
    // Ripple too, so hitting the dot and hitting the surrounding radius look the same as well as
    // behaving the same. Drawn at the stored coordinates, which is where the dot sits.
    setRipple({ xRatio: tap.x, yRatio: tap.y });
    setVariantPanelTap(tap);
  };

  const handleCloseVariantPanel = () => setVariantPanelTap(null);

  /**
   * The panel's "Draw a new version": a deliberate, explicitly-paid generation at an already-known
   * spot. `force_new_image` stops layer 3 from answering it with the earlier node's pixels — without
   * that the button could return the identical picture and look broken.
   */
  const handleDrawNewVariant = (tap: CachedTap) => {
    if (!current || !imgRef.current || busy || morphActive) return;
    // Re-marked from the stored ratios rather than a click position: the panel is open, so there is
    // no cursor to read, and the VLM still resolves the subject from the drawn marker.
    const markedImage = drawTapMarker(imgRef.current, tap.x, tap.y);
    setVariantPanelTap(null);
    return runRequest({
      mode: "tap",
      markedImage,
      x: tap.x,
      y: tap.y,
      force_new_image: true,
      parent_title: current.page_title,
      ...baseRequestFields(),
    });
  };

  const handleEdit = (command: string) => {
    if (!current || !imgRef.current || busy) return;
    const dataUrl = captureCurrentImage(imgRef.current);
    return runRequest({
      mode: "edit",
      prompt: command,
      currentImage: dataUrl,
      parent_title: current.page_title,
      ...baseRequestFields(),
    });
  };

  const handleAddressSubmit = current ? handleEdit : handleSearch;

  const handleRetry = () => {
    if (!lastRequest || busy) return;
    runRequest(lastRequest);
  };

  const handleNavigate = (index: number) => {
    if (preparingClips) return;
    resetGeneration();
    setActionError(null);
    navigateTo(index);
  };

  const handleRatioChange = async (ratio: AspectRatio) => {
    if (preparingClips) return;
    setAspectRatio(ratio);
    if (!current || current.image_variants[ratio]) return;
    setVariantLoading(true);
    setActionError(null);
    try {
      const node = await fetchVariant(current.id, ratio);
      updateNode(node);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Couldn't switch aspect ratio");
    } finally {
      setVariantLoading(false);
    }
  };

  const handleUploaded = (node: Node) => {
    const ratio = (Object.keys(node.image_variants)[0] as AspectRatio | undefined) ?? "16:9";
    setAspectRatio(ratio);
    reset([node]);
  };

  /**
   * On-demand animation for the current page, which was created without clips.
   * Asks for whichever of the two is missing, mirroring what generate.ts does automatically when a
   * page is made with Live video on: one `video_loop` flag there starts both the idle loop and the
   * morph, so one action here does the same. Each status is optimistically flipped to "pending" (or
   * "ready" if the server says one already existed) so useIdleLoopVideo starts polling and the
   * "generating" indicator shows — exactly the state the automatic path leaves a node in — without
   * waiting on a node re-fetch.
   */
  const handleGenerateVideo = async () => {
    if (!current || videoRequestPending || preparingClips) return;
    setActionError(null);
    setVideoRequestPending(true);
    try {
      let next = current;
      if (missingIdleLoop) {
        const { status } = await requestNodeVideo(current.id, pruneEmptyPrefs(modelPrefs));
        next = { ...next, video_status: status === "ready" ? "ready" : "pending" };
      }
      if (missingMorph) {
        // Non-fatal on its own: the morph only pays off on a later visit to this page, so a failure
        // here (session cap, say) must not surface as an error that buries the idle loop we just
        // successfully started — nor abort the status write-back below.
        try {
          const { status } = await requestNodeMorph(current.id, pruneEmptyPrefs(modelPrefs));
          next = { ...next, morph_status: status === "ready" ? "ready" : "pending" };
        } catch (err) {
          console.error(err);
        }
      }
      updateNode(next);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Couldn't animate this page");
    } finally {
      setVideoRequestPending(false);
    }
  };

  const handleClear = () => {
    if (preparingClips) return;
    resetGeneration();
    reset([]);
    setSessionId(newSessionId());
    setAspectRatio("16:9");
    setLastRequest(null);
    setActionError(null);
    navigate("/");
  };

  // previewImageUrl only wins while a generation is actively in flight; once it's done
  // (or the user has navigated elsewhere via breadcrumbs), the selected node's own image applies.
  const imageUrl = (isStreaming && state.previewImageUrl) || current?.image_variants[aspectRatio];
  // Landing state: nothing in the trail yet and nothing currently generating. Once the very
  // first search starts streaming, this flips to the normal PageImage loading view.
  const showLanding = trail.length === 0 && !isStreaming;
  const isQuotaError = state.status === "error" && state.errorCode === "quota";
  const bannerMessage = state.status === "error" ? state.error : actionError;

  return {
    modelPrefs,
    setModelPrefs,
    /** Non-fatal "your pick could not be used" advisories from the last generation. */
    notices: state.notices ?? [],
    hydrating,
    hydrateError,
    sessionId,
    trail,
    currentIndex,
    current,
    config,
    setWebSearch,
    setArtStyle,
    setComposition,
    state,
    isStreaming,
    busy,
    preparingClips,
    lastRequest,
    actionError,
    setActionError,
    isQuotaError,
    bannerMessage,
    aspectRatio,
    variantLoading,
    showLoadingIndicator,
    showLanding,
    imageUrl,
    ripple,
    setRipple,
    imgRef,
    videoLoopEnabled,
    setVideoLoopEnabled,
    idleLoopVideoUrl,
    videoGenerating,
    canGenerateVideo,
    videoRequestPending,
    handleGenerateVideo,
    morphUrl,
    morphActive,
    clearMorph,
    cachedTaps,
    tapDedupMode,
    variantPanelTap,
    milestone,
    dismissMilestone,
    handleSearch,
    handleTap,
    handleLabelTap,
    handleOpenCachedTap,
    handleInspectCachedTap,
    handleCloseVariantPanel,
    handleDrawNewVariant,
    openExistingChild,
    handleEdit,
    handleAddressSubmit,
    handleRetry,
    handleNavigate,
    handleRatioChange,
    handleUploaded,
    handleClear,
  };
}
