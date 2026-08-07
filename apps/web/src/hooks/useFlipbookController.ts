import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AspectRatio, CachedTap, GenerateRequest, HouseStyleOption, Node } from "@flipbook/shared";
import { useCachedTaps } from "./useCachedTaps";
import { useGenerationStream } from "./useGenerationStream";
import { useSessionTrail } from "./useSessionTrail";
import { useTapMarker } from "./useTapMarker";
import { useDelayedFlag } from "./useDelayedFlag";
import { usePageAnalytics } from "./usePageAnalytics";
import { useIdleLoopVideo } from "./useIdleLoopVideo";
import { useMorphTransition } from "./useMorphTransition";
import { useCancellableEffect } from "./useCancellableEffect";
import { fetchConfig, fetchNode, fetchVariant, requestNodeVideo, waitForMorphReady } from "../lib/api";
import { captureCurrentImage } from "../lib/imageCapture";

function newSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

// Fetched (and, for webSearch/houseStyle, later user-adjusted) as one unit — grouped into a single
// state object rather than one useState per field, matching useGenerationStream's GenerationState
// and useSessionTrail's TrailState.
interface AppConfig {
  webSearch: boolean;
  videoAvailable: boolean;
  morphAvailable: boolean;
  uploadAvailable: boolean;
  houseStyles: HouseStyleOption[];
  houseStyle: string;
  compositions: HouseStyleOption[];
  composition: string;
}

const DEFAULT_CONFIG: AppConfig = {
  webSearch: false,
  videoAvailable: false,
  morphAvailable: false,
  uploadAvailable: false,
  houseStyles: [],
  houseStyle: "",
  compositions: [],
  composition: "",
};

/**
 * All of FlipbookApp's non-rendering state and behavior — session/trail, config, generation
 * requests, video/morph/tap-cache side state, and every handler — leaving the component itself as
 * render/composition only. Named per the app it drives; not meant to be reused elsewhere.
 */
export function useFlipbookController(initialNodeId?: string) {
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
  const setHouseStyle = (houseStyle: string) => setConfig((c) => ({ ...c, houseStyle }));
  const setComposition = (composition: string) => setConfig((c) => ({ ...c, composition }));
  const [videoLoopEnabled, setVideoLoopEnabled] = useState(false);
  // First-step-morph flow: true while navigation is being held on the parent, waiting for a freshly
  // generated child's transition-morph to finish so it plays on this first step (not only a revisit).
  const [preparingMorph, setPreparingMorph] = useState(false);
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
          houseStyles: fetched.houseStyles,
          houseStyle: fetched.houseStyle,
          compositions: fetched.compositions,
          composition: fetched.composition,
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
  const busy = isStreaming || preparingMorph;
  // Real generations and cache-hit instant navigations both count as a "page" (PLAN §1.4).
  const showLoadingIndicator = useDelayedFlag(isStreaming || variantLoading, 150);
  // PLAN §3 Phase 5: purely additive — polls for a background idle-loop clip once the page is
  // settled (never while still streaming in a new one) and the experimental toggle is on.
  const idleLoopVideoUrl = useIdleLoopVideo(current?.id, videoLoopEnabled && !isStreaming, current?.video_status);
  // PLAN §3 Phase 5: the parent page is already shown, but its idle-loop clip is still rendering in
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
  // PLAN §3 Phase 5 on-demand path: a page created while Live video was off has no clip and never
  // will automatically (video_status null), and a prior on-demand attempt may have failed — both are
  // retryable by explicit request. Offer the action only when the feature is actually available and
  // the toggle is on, and never mid-generation.
  const canGenerateVideo =
    config.videoAvailable &&
    videoLoopEnabled &&
    !isStreaming &&
    !idleLoopVideoUrl &&
    !!current &&
    (current.video_status === null || current.video_status === "failed");
  // PLAN §3 Phase 5: a single non-blocking check per navigation, never gates the page render.
  const [morphUrl, clearMorph] = useMorphTransition(current?.id, current?.parent_id, config.morphAvailable);
  // PLAN §2.3: spots on this page already explored, shown as markers so a free tap is visible
  // before it is made.
  const cachedTaps = useCachedTaps(current?.id, aspectRatio);

  // A deep-linked page arrives with its title already rendered into the HTML by the server (for
  // link unfurling), and nothing updated it afterwards — so going Home, or opening any other page,
  // left the browser tab still naming the page you had left.
  useEffect(() => {
    document.title = current ? `${current.page_title} — flipbook` : "flipbook";
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
      house_style: config.houseStyle || undefined,
      composition: config.composition || undefined,
      // Gates background idle-loop and morph generation server-side: no video quota is spent unless
      // the user actually has Live video on. Mirrors the toggle that already controls display.
      video_loop: videoLoopEnabled,
    };
    setLastRequest(withStyle);
    setActionError(null);
    try {
      const node = await start(withStyle);
      // First-step-morph flow: if the server actually kicked off a transition-morph for this child
      // (morph_status is "pending" — which it only sets, before `complete`, when Live video is on,
      // the child has a parent, and the per-session cap has not been hit), hold on the parent until
      // that clip is ready so the morph plays on this very first step. useMorphTransition then fetches
      // and plays it the moment we append below. Over the cap / off / no parent, morph_status is null,
      // waitForMorphReady is never called, and navigation stays instant exactly as before. The wait is
      // bounded (timeout + failure bail inside waitForMorphReady) so it can never hang the transition.
      if (config.morphAvailable && node.morph_status === "pending") {
        setPreparingMorph(true);
        try {
          await waitForMorphReady(node.id);
        } finally {
          setPreparingMorph(false);
        }
      }
      append(node);
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
    if (!current || busy) return;
    const { dataUrl, xRatio, yRatio } = captureTap(imageEl, clientX, clientY);
    setRipple({ xRatio, yRatio });
    return runRequest({
      mode: "tap",
      markedImage: dataUrl,
      x: xRatio,
      y: yRatio,
      parent_title: current.page_title,
      ...baseRequestFields(),
    });
  };

  /**
   * Opens an already-generated child from a cached-tap marker (PLAN §2.3). Deliberately does not go
   * through runRequest: the whole point of the marker is that this path touches no provider at all,
   * so it fetches the stored node and appends it to the trail directly.
   */
  const handleOpenCachedTap = async (tap: CachedTap) => {
    if (busy) return;
    setActionError(null);
    try {
      const { node } = await fetchNode(tap.child_id);
      append(node);
      recordPage();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Couldn't open that page");
    }
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
    if (preparingMorph) return;
    resetGeneration();
    setActionError(null);
    navigateTo(index);
  };

  const handleRatioChange = async (ratio: AspectRatio) => {
    if (preparingMorph) return;
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
   * On-demand idle-loop generation (PLAN §3 Phase 5) for the current page, which was created without
   * a clip. Optimistically flips the node's video_status to "pending" (or "ready" if the server says
   * one already existed) so useIdleLoopVideo starts polling and the "generating" indicator shows —
   * exactly the state the automatic path leaves a node in — without waiting on a node re-fetch.
   */
  const handleGenerateVideo = async () => {
    if (!current || videoRequestPending || preparingMorph) return;
    setActionError(null);
    setVideoRequestPending(true);
    try {
      const { status } = await requestNodeVideo(current.id);
      updateNode({ ...current, video_status: status === "ready" ? "ready" : "pending" });
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Couldn't generate video for this page");
    } finally {
      setVideoRequestPending(false);
    }
  };

  const handleClear = () => {
    if (preparingMorph) return;
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
    hydrating,
    hydrateError,
    sessionId,
    trail,
    currentIndex,
    current,
    config,
    setWebSearch,
    setHouseStyle,
    setComposition,
    state,
    isStreaming,
    busy,
    preparingMorph,
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
    clearMorph,
    cachedTaps,
    milestone,
    dismissMilestone,
    handleSearch,
    handleTap,
    handleOpenCachedTap,
    handleEdit,
    handleAddressSubmit,
    handleRetry,
    handleNavigate,
    handleRatioChange,
    handleUploaded,
    handleClear,
  };
}
