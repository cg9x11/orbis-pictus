import { BrowserFrame } from "./components/BrowserFrame";
import { AddressBar } from "./components/AddressBar";
import { PageImage } from "./components/PageImage";
import { AspectRatioPicker } from "./components/AspectRatioPicker";
import { UploadButton } from "./components/UploadButton";
import { WebSearchToggle } from "./components/WebSearchToggle";
import { ArtStylePicker } from "./components/ArtStylePicker";
import { CompositionPicker } from "./components/CompositionPicker";
import { ModelSettingsPanel } from "./components/ModelSettingsPanel";
import { VideoLoopToggle } from "./components/VideoLoopToggle";
import { GenerationProgress } from "./components/GenerationProgress";
import { CachedTapMarkers } from "./components/CachedTapMarkers";
import { PageVersions } from "./components/PageVersions";
import { TapVariantPanel } from "./components/TapVariantPanel";
import { Landing } from "./components/Landing";
import { classNames } from "./lib/classNames";
import { useOrbisController } from "./hooks/useOrbisController";

export function OrbisApp({ initialNodeId }: { initialNodeId?: string }) {
  const {
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
    modelPrefs,
    setModelPrefs,
    notices,
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
    isDemo,
    displayRatio,
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
    versions,
    milestone,
    dismissMilestone,
    handleSearch,
    handleTap,
    handleOpenCachedTap,
    handleInspectCachedTap,
    handleCloseVariantPanel,
    handleDrawNewVariant,
    openExistingChild,
    openVersion,
    handleSetDefaultVersion,
    handleAddressSubmit,
    handleRetry,
    handleNavigate,
    handleRatioChange,
    handleUploaded,
    handleClear,
  } = useOrbisController(initialNodeId);

  if (hydrating) return <div className="loading-screen">Loading…</div>;
  if (hydrateError) return <div className="loading-screen">Couldn't load that page: {hydrateError}</div>;

  return (
    <div className="app-shell">
    <header className="app-masthead">
      <span className="app-wordmark">Orbis Pictus</span>
      <span className="app-tagline">An infinite visual encyclopedia, drawn as you explore it</span>
    </header>
    <BrowserFrame
      onHome={handleClear}
      // Already at the start in the demo, so Home has nowhere to go.
      homeDisabled={busy || showLanding || isDemo}
      addressBar={
        <AddressBar
          trail={trail}
          currentIndex={currentIndex}
          onNavigate={handleNavigate}
          onSubmit={handleAddressSubmit}
          disabled={busy}
          pendingLabel={isStreaming ? state.tapSubject : undefined}
          // In the demo the address bar starts a fresh search, so it must not look like an edit box.
          editMode={!!current && !isDemo}
        />
      }
      toolbar={
        <>
          {/* On a real page the shape is locked to it. On the demo it is unlocked: it sets the shape
              of the user's FIRST real page, so it stays usable even though a page is on screen. */}
          <AspectRatioPicker value={aspectRatio} onChange={handleRatioChange} disabled={busy || variantLoading || (!!current && !isDemo)} />
          <WebSearchToggle enabled={config.webSearch} onChange={setWebSearch} disabled={busy} />
          <ArtStylePicker styles={config.artStyles} value={config.artStyle} onChange={setArtStyle} disabled={busy} />
          <CompositionPicker
            compositions={config.compositions}
            value={config.composition}
            onChange={setComposition}
            disabled={busy}
            artStyle={config.artStyle}
            autoView={config.autoView}
            viewLockedStyles={config.viewLockedStyles}
          />
          <ModelSettingsPanel settings={config.modelSettings} prefs={modelPrefs} onChange={setModelPrefs} disabled={busy} />
          {config.videoAvailable && (
            <VideoLoopToggle
              enabled={videoLoopEnabled}
              onChange={setVideoLoopEnabled}
              disabled={busy}
              // Once the poll has the clip in hand it is ready, whatever the node payload said when
              // the page loaded - that snapshot is never refreshed, so it would otherwise read
              // "generating…" forever on a page whose loop is already playing.
              status={idleLoopVideoUrl ? "ready" : current?.video_status}
            />
          )}
          {/* On-demand path: a distinct, explicit action shown only when Live video
              is on and this page is missing a clip - turning the toggle's honest "none on this page"
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
              disabled={busy || variantLoading || isDemo}
              onUploaded={handleUploaded}
              onError={setActionError}
            />
          )}
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
          morphActive={morphActive}
          onMorphEnded={clearMorph}
          markers={
            <CachedTapMarkers
              taps={cachedTaps}
              mode={tapDedupMode}
              onOpen={handleOpenCachedTap}
              onInspect={handleInspectCachedTap}
              hidden={busy || morphActive}
            />
          }
          versions={
            <PageVersions
              versions={versions}
              currentId={current?.id}
              onOpen={openVersion}
              onSetDefault={handleSetDefaultVersion}
              hidden={busy || morphActive}
            />
          }
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
          aspectRatio={displayRatio}
        />
      )}
      {variantPanelTap && (
        <TapVariantPanel
          tap={variantPanelTap}
          onOpen={openExistingChild}
          onDrawNew={handleDrawNewVariant}
          onClose={handleCloseVariantPanel}
          busy={busy}
          readOnly={isDemo}
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
      {/* Advisories, not failures: the page did arrive, drawn by something other than what was
          picked. Kept visually distinct from the error banner above so a working page never looks
          broken, and shown after it so a real error stays the most prominent thing on screen. */}
      {notices.map((notice) => (
        <div key={`${notice.code}-${notice.requested ?? ""}`} className="notice-banner">
          <span className="notice-banner-icon">ℹ️</span>
          <span className="notice-banner-message">{notice.message}</span>
        </div>
      ))}
      {milestone !== null && (
        <div key={milestone} className="milestone-toast" onAnimationEnd={dismissMilestone}>
          🎉 You've explored {milestone} pages this session
        </div>
      )}
    </BrowserFrame>
    {/* Sits directly under the mocked browser frame on every view - before the demo's intro/gallery
        below - so it reads as a caption on the browser, not a footer pinned to the page bottom. It
        states the plain fact that the whole app is AI-generated. */}
    <p className="app-disclaimer">
      Everything here is AI-generated. Images and text may be inaccurate or entirely made up - please don't
      rely on it as fact.
    </p>
    {/* The intro text and gallery live BELOW the browser during the read-only demo. Once a real
        session starts (isDemo false) they hide, leaving just the working page. The empty-trail
        fallback (showLanding) still renders its own copy inside the frame, so this is suppressed
        then to avoid showing it twice. */}
    {isDemo && !showLanding && (
      <div className="landing-below">
        <Landing onSuggestion={handleSearch} />
      </div>
    )}
    </div>
  );
}
