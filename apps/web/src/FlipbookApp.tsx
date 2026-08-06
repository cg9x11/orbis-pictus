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

function newSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

const QUOTA_ERROR_PATTERN = /quota/i;

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
  const [webSearch, setWebSearch] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [videoLoopEnabled, setVideoLoopEnabled] = useState(false);
  const [morphAvailable, setMorphAvailable] = useState(false);
  const [uploadAvailable, setUploadAvailable] = useState(false);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [houseStyles, setHouseStyles] = useState<HouseStyleOption[]>([]);
  const [houseStyle, setHouseStyle] = useState<string>("");
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        setWebSearch(config.searchAvailable);
        setVideoAvailable(config.videoEnabled);
        setMorphAvailable(config.morphEnabled);
        setUploadAvailable(config.uploadEnabled);
        setHouseStyles(config.houseStyles);
        setHouseStyle(config.houseStyle);
      })
      .catch((err: unknown) => console.error(err));
  }, []);

  useEffect(() => {
    if (!initialNodeId) return;
    let cancelled = false;
    fetchNode(initialNodeId)
      .then(({ node, history }) => {
        if (cancelled) return;
        reset([...history, node]);
        setSessionId(node.session_id);
        setHydrating(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHydrateError(err instanceof Error ? err.message : "Failed to load page");
        setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialNodeId, reset]);

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
  const [morphUrl, clearMorph] = useMorphTransition(current?.id, current?.parent_id, morphAvailable);
  // PLAN §2.3: spots on this page already explored, shown as markers so a free tap is visible
  // before it is made.
  const cachedTaps = useCachedTaps(current?.id, aspectRatio);

  // A deep-linked page arrives with its title already rendered into the HTML by the server (for
  // link unfurling), and nothing updated it afterwards — so going Home, or opening any other page,
  // left the browser tab still naming the page you had left.
  useEffect(() => {
    document.title = current ? `${current.page_title} — flipbook` : "flipbook";
  }, [current]);

  const runRequest = async (request: GenerateRequest) => {
    // Injected in one place rather than at each call site, so no generation path can silently fall
    // back to the server's default style. Empty until /api/config has answered, and omitted rather
    // than sent blank so the server keeps its own default in that window.
    const withStyle = { ...request, house_style: houseStyle || undefined };
    setLastRequest(withStyle);
    const node = await start(withStyle);
    append(node);
    recordPage();
  };

  const handleSearch = (query: string) =>
    runRequest({
      mode: "search",
      query,
      aspect_ratio: aspectRatio,
      web_search: webSearch,
      session_id: sessionId,
      current_node_id: current?.id ?? "",
    });

  const handleTap = (imageEl: HTMLImageElement, clientX: number, clientY: number) => {
    if (!current || isStreaming) return;
    const { dataUrl, xRatio, yRatio } = captureTap(imageEl, clientX, clientY);
    setRipple({ xRatio, yRatio });
    return runRequest({
      mode: "tap",
      image: dataUrl,
      x: xRatio,
      y: yRatio,
      aspect_ratio: aspectRatio,
      web_search: webSearch,
      parent_query: current.query,
      parent_title: current.page_title,
      session_id: sessionId,
      current_node_id: current.id,
    });
  };

  /**
   * Opens an already-generated child from a cached-tap marker (PLAN §2.3). Deliberately does not go
   * through runRequest: the whole point of the marker is that this path touches no provider at all,
   * so it fetches the stored node and appends it to the trail directly.
   */
  const handleOpenCachedTap = async (tap: CachedTap) => {
    if (isStreaming) return;
    try {
      const { node } = await fetchNode(tap.child_id);
      append(node);
      recordPage();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = (command: string) => {
    if (!current || !imgRef.current || isStreaming) return;
    const dataUrl = captureCurrentImage(imgRef.current);
    return runRequest({
      mode: "edit",
      prompt: command,
      image: dataUrl,
      aspect_ratio: aspectRatio,
      web_search: webSearch,
      parent_query: current.query,
      parent_title: current.page_title,
      session_id: sessionId,
      current_node_id: current.id,
    });
  };

  const handleAddressSubmit = current ? handleEdit : handleSearch;

  const handleRetry = () => {
    if (!lastRequest || isStreaming) return;
    runRequest(lastRequest).catch((err: unknown) => console.error(err));
  };

  const handleNavigate = (index: number) => {
    resetGeneration();
    navigateTo(index);
  };

  const handleRatioChange = async (ratio: AspectRatio) => {
    setAspectRatio(ratio);
    if (!current || current.image_variants[ratio]) return;
    setVariantLoading(true);
    try {
      const node = await fetchVariant(current.id, ratio);
      updateNode(node);
    } catch (err) {
      console.error(err);
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
    navigate("/");
  };

  // previewImageUrl only wins while a generation is actively in flight; once it's done
  // (or the user has navigated elsewhere via breadcrumbs), the selected node's own image applies.
  const imageUrl = (isStreaming && state.previewImageUrl) || current?.image_variants[aspectRatio];
  // Landing state: nothing in the trail yet and nothing currently generating. Once the very
  // first search starts streaming, this flips to the normal PageImage loading view.
  const showLanding = trail.length === 0 && !isStreaming;
  const isQuotaError = state.status === "error" && QUOTA_ERROR_PATTERN.test(state.error ?? "");

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
          <WebSearchToggle enabled={webSearch} onChange={setWebSearch} disabled={isStreaming} />
          <HouseStylePicker styles={houseStyles} value={houseStyle} onChange={setHouseStyle} disabled={isStreaming} />
          {videoAvailable && (
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
          {uploadAvailable && (
            <UploadButton sessionId={sessionId} disabled={isStreaming || variantLoading} onUploaded={handleUploaded} />
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
      {state.status === "error" && (
        <div className={`error-banner${isQuotaError ? " error-banner-quota" : ""}`}>
          <span className="error-banner-icon">{isQuotaError ? "⚠️" : "✕"}</span>
          <span className="error-banner-message">{state.error}</span>
          {lastRequest && (
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
