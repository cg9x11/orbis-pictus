import { BrowserFrame } from "./components/BrowserFrame";
import { AddressBar } from "./components/AddressBar";
import { PageImage } from "./components/PageImage";
import { AspectRatioPicker } from "./components/AspectRatioPicker";
import { UploadButton } from "./components/UploadButton";
import { WebSearchToggle } from "./components/WebSearchToggle";
import { HouseStylePicker } from "./components/HouseStylePicker";
import { CompositionPicker } from "./components/CompositionPicker";
import { VideoLoopToggle } from "./components/VideoLoopToggle";
import { GenerationProgress } from "./components/GenerationProgress";
import { CachedTapMarkers } from "./components/CachedTapMarkers";
import { Landing } from "./components/Landing";
import { classNames } from "./lib/classNames";
import { useFlipbookController } from "./hooks/useFlipbookController";

export function FlipbookApp({ initialNodeId }: { initialNodeId?: string }) {
  const {
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
    preparingClips,
    lastRequest,
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
    handleAddressSubmit,
    handleRetry,
    handleNavigate,
    handleRatioChange,
    handleUploaded,
    handleClear,
  } = useFlipbookController(initialNodeId);

  if (hydrating) return <div className="loading-screen">Loading…</div>;
  if (hydrateError) return <div className="loading-screen">Couldn't load that page: {hydrateError}</div>;

  return (
    <BrowserFrame
      onHome={handleClear}
      homeDisabled={busy || showLanding}
      addressBar={
        <AddressBar
          trail={trail}
          currentIndex={currentIndex}
          onNavigate={handleNavigate}
          onSubmit={handleAddressSubmit}
          disabled={busy}
          pendingLabel={isStreaming ? state.tapSubject : undefined}
          editMode={!!current}
        />
      }
      toolbar={
        <>
          <AspectRatioPicker value={aspectRatio} onChange={handleRatioChange} disabled={busy || variantLoading} />
          <WebSearchToggle enabled={config.webSearch} onChange={setWebSearch} disabled={busy} />
          <HouseStylePicker styles={config.houseStyles} value={config.houseStyle} onChange={setHouseStyle} disabled={busy} />
          <CompositionPicker compositions={config.compositions} value={config.composition} onChange={setComposition} disabled={busy} />
          {config.videoAvailable && (
            <VideoLoopToggle
              enabled={videoLoopEnabled}
              onChange={setVideoLoopEnabled}
              disabled={busy}
              // Once the poll has the clip in hand it is ready, whatever the node payload said when
              // the page loaded — that snapshot is never refreshed, so it would otherwise read
              // "generating…" forever on a page whose loop is already playing.
              status={idleLoopVideoUrl ? "ready" : current?.video_status}
            />
          )}
          {/* On-demand path (PLAN §3 Phase 5): a distinct, explicit action shown only when Live video
              is on and this page is missing a clip — turning the toggle's honest "none on this page"
              into something the user can act on, without conflating the global on/off toggle's
              meaning. Covers both clips, so the label names the outcome rather than just the video. */}
          {canGenerateVideo && (
            <button
              type="button"
              className={classNames("toolbar-button", { "toolbar-button-working": videoRequestPending })}
              onClick={handleGenerateVideo}
              disabled={videoRequestPending}
              title="Generate this page's looping motion clip, and its transition morph if it doesn't have one (uses video quota)"
            >
              {videoRequestPending ? "Starting…" : "✨ Animate page"}
            </button>
          )}
          {config.uploadAvailable && (
            <UploadButton
              sessionId={sessionId}
              disabled={busy || variantLoading}
              onUploaded={handleUploaded}
              onError={setActionError}
            />
          )}
          <button type="button" className="toolbar-button" onClick={handleClear} disabled={busy || trail.length === 0}>
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
          markers={<CachedTapMarkers taps={cachedTaps} onOpen={handleOpenCachedTap} hidden={busy} />}
          videoGenerating={videoGenerating}
          preparingClips={preparingClips}
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
