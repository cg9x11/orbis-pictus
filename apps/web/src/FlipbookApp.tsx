import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AspectRatio, CachedTap, GenerateRequest, HouseStyleOption, Node } from "@flipbook/shared";
import { BrowserFrame } from "./components/BrowserFrame";
import { AddressBar } from "./components/AddressBar";
import { PageImage } from "./components/PageImage";
import { AspectRatioPicker } from "./components/AspectRatioPicker";
import { UploadButton } from "./components/UploadButton";
import { WebSearchToggle } from "./components/WebSearchToggle";
import { HouseStylePicker } from "./components/HouseStylePicker";
import { VideoLoopToggle } from "./components/VideoLoopToggle";
import { GenerationProgress } from "./components/GenerationProgress";
import { CachedTapMarkers } from "./components/CachedTapMarkers";
import { useCachedTaps } from "./hooks/useCachedTaps";
import { Landing } from "./components/Landing";
import { useGenerationStream } from "./hooks/useGenerationStream";
import { useSessionTrail } from "./hooks/useSessionTrail";
import { useTapMarker } from "./hooks/useTapMarker";
import { useDelayedFlag } from "./hooks/useDelayedFlag";
import { usePageAnalytics } from "./hooks/usePageAnalytics";
import { useIdleLoopVideo } from "./hooks/useIdleLoopVideo";
import { useMorphTransition } from "./hooks/useMorphTransition";
import { fetchConfig, fetchNode, fetchVariant } from "./lib/api";
import { captureCurrentImage } from "./lib/imageCapture";
import { classNames } from "./lib/classNames";
import { useCancellableEffect } from "./hooks/useCancellableEffect";

function newSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

const QUOTA_ERROR_PATTERN = /quota/i;

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
}

const DEFAULT_CONFIG: AppConfig = {
  webSearch: false,
  videoAvailable: false,
  morphAvailable: false,
  uploadAvailable: false,
  houseStyles: [],
  houseStyle: "",
};

export function FlipbookApp({ initialNodeId }: { initialNodeId?: string }) {
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
  const [videoLoopEnabled, setVideoLoopEnabled] = useState(false);
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

  const runRequest = async (request: GenerateRequest) => {
    // Injected in one place rather than at each call site, so no generation path can silently fall
    // back to the server's default style. Empty until /api/config has answered, and omitted rather
    // than sent blank so the server keeps its own default in that window.
    const withStyle = { ...request, house_style: config.houseStyle || undefined };
    setLastRequest(withStyle);
    setActionError(null);
    try {
      const node = await start(withStyle);
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

  const handleSearch = (query: string) =>
    runRequest({
      mode: "search",
      query,
      ...baseRequestFields(),
    });

  const handleTap = (imageEl: HTMLImageElement, clientX: number, clientY: number) => {
    if (!current || isStreaming) return;
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
    if (isStreaming) return;
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
    if (!current || !imgRef.current || isStreaming) return;
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
    if (!lastRequest || isStreaming) return;
    runRequest(lastRequest);
  };

  const handleNavigate = (index: number) => {
    resetGeneration();
    setActionError(null);
    navigateTo(index);
  };

  const handleRatioChange = async (ratio: AspectRatio) => {
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

  const handleClear = () => {
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
  const isQuotaError = state.status === "error" && QUOTA_ERROR_PATTERN.test(state.error ?? "");
  const bannerMessage = state.status === "error" ? state.error : actionError;

  if (hydrating) return <div className="loading-screen">Loading…</div>;
  if (hydrateError) return <div className="loading-screen">Couldn't load that page: {hydrateError}</div>;

  return (
    <BrowserFrame
      onHome={handleClear}
      homeDisabled={isStreaming || showLanding}
      addressBar={
        <AddressBar
          trail={trail}
          currentIndex={currentIndex}
          onNavigate={handleNavigate}
          onSubmit={handleAddressSubmit}
          disabled={isStreaming}
          pendingLabel={isStreaming ? state.tapSubject : undefined}
          editMode={!!current}
        />
      }
      toolbar={
        <>
          <AspectRatioPicker value={aspectRatio} onChange={handleRatioChange} disabled={isStreaming || variantLoading} />
          <WebSearchToggle enabled={config.webSearch} onChange={setWebSearch} disabled={isStreaming} />
          <HouseStylePicker styles={config.houseStyles} value={config.houseStyle} onChange={setHouseStyle} disabled={isStreaming} />
          {config.videoAvailable && (
            <VideoLoopToggle
              enabled={videoLoopEnabled}
              onChange={setVideoLoopEnabled}
              disabled={isStreaming}
              // Once the poll has the clip in hand it is ready, whatever the node payload said when
              // the page loaded — that snapshot is never refreshed, so it would otherwise read
              // "generating…" forever on a page whose loop is already playing.
              status={idleLoopVideoUrl ? "ready" : current?.video_status}
            />
          )}
          {config.uploadAvailable && (
            <UploadButton
              sessionId={sessionId}
              disabled={isStreaming || variantLoading}
              onUploaded={handleUploaded}
              onError={setActionError}
            />
          )}
          <button type="button" className="toolbar-button" onClick={handleClear} disabled={isStreaming || trail.length === 0}>
            Clear
          </button>
        </>
      }
    >
      {showLanding ? (
        <Landing onSuggestion={handleSearch} />
      ) : (
        <PageImage
          imageUrl={imageUrl}
          videoUrl={idleLoopVideoUrl}
          morphUrl={morphUrl}
          onMorphEnded={clearMorph}
          markers={<CachedTapMarkers taps={cachedTaps} onOpen={handleOpenCachedTap} hidden={isStreaming} />}
          videoGenerating={videoGenerating}
          loading={showLoadingIndicator}
          loadingContent={
            isStreaming ? (
              <GenerationProgress
                stage={state.stage}
                tapSubject={state.tapSubject}
                pageTitle={state.pageTitle}
                startedAt={state.startedAt}
              />
            ) : undefined
          }
          onTap={handleTap}
          ripple={ripple}
          onRippleDone={() => setRipple(null)}
          imgRef={imgRef}
          aspectRatio={aspectRatio}
        />
      )}
      {isStreaming && state.tapSubject && <div className="tap-subject-banner">{state.tapSubject}</div>}
      {bannerMessage && (
        <div className={classNames("error-banner", { "error-banner-quota": isQuotaError })}>
          <span className="error-banner-icon">{isQuotaError ? "⚠️" : "✕"}</span>
          <span className="error-banner-message">{bannerMessage}</span>
          {state.status === "error" && lastRequest && (
            <button type="button" className="error-banner-retry" onClick={handleRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      {milestone !== null && (
        <div key={milestone} className="milestone-toast" onAnimationEnd={dismissMilestone}>
          🎉 You've explored {milestone} pages this session
        </div>
      )}
    </BrowserFrame>
  );
}
