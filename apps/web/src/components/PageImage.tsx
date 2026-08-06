import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { AspectRatio } from "@flipbook/shared";
import { TapRipple } from "./TapRipple";

interface PageImageProps {
  imageUrl?: string;
  /** PLAN §3 Phase 5: the ready idle-loop clip, or null while none is available/enabled. */
  videoUrl?: string | null;
  /** PLAN §3 Phase 5: a ready transition-morph clip to play once over the already-current image, or null. */
  morphUrl?: string | null;
  /** Called once the morph has finished playing (or its fade-out completes) so the caller can clear it. */
  onMorphEnded?: () => void;
  loading: boolean;
  /** What the loading overlay shows. Falls back to a plain word when the caller has nothing richer
   *  (e.g. an aspect-ratio re-render, which runs over plain HTTP with no event stream). */
  loadingContent?: ReactNode;
  /** Overlay pinned to the image's own coordinate space — the already-explored tap markers. */
  markers?: ReactNode;
  /** PLAN §3 Phase 5: a background idle-loop clip is being generated for this page. Unlike
   *  `loading`, the page is already finished and stays fully interactive — the indicator only says
   *  "a clip is coming", it must never block a tap. */
  videoGenerating?: boolean;
  onTap: (image: HTMLImageElement, clientX: number, clientY: number) => void;
  ripple: { xRatio: number; yRatio: number } | null;
  onRippleDone: () => void;
  imgRef: RefObject<HTMLImageElement>;
  aspectRatio: AspectRatio;
}

export function PageImage({
  imageUrl,
  videoUrl,
  morphUrl,
  onMorphEnded,
  loading,
  loadingContent,
  markers,
  videoGenerating,
  onTap,
  ripple,
  onRippleDone,
  imgRef,
  aspectRatio,
}: PageImageProps) {
  // Tracks whether the <video> has actually started rendering frames, so the crossfade only
  // begins once there's something to fade to (avoids a flash of black before the first frame).
  const [videoReady, setVideoReady] = useState(false);
  const [morphVisible, setMorphVisible] = useState(false);

  useEffect(() => {
    setVideoReady(false);
  }, [videoUrl]);

  useEffect(() => {
    setMorphVisible(false);
  }, [morphUrl]);

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || loading) return;
    onTap(imgRef.current, e.clientX, e.clientY);
  };

  const overlay = loading ? "loading" : videoGenerating ? "video-generating" : "none";

  return (
    <div className="page-image-container" style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
      {imageUrl ? (
        <>
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className={`page-image${loading ? " page-image-loading" : ""}`}
            onClick={handleClick}
          />
          {videoUrl && (
            // Purely decorative overlay: pointer-events none so taps always land on the <img>
            // beneath, keeping the whole tap-marker pipeline untouched by this feature.
            <video
              key={videoUrl}
              className={`page-video${videoReady ? " page-video-visible" : ""}`}
              src={videoUrl}
              muted
              autoPlay
              loop
              playsInline
              onCanPlay={() => setVideoReady(true)}
            />
          )}
          {morphUrl && (
            // Plays once over the already-current image (which is the real child page, so
            // whatever the clip's own last frame looks like, the underlying page is exact once
            // this fades out), then unmounts itself. Rendered after the idle-loop video so it
            // stacks above it while playing.
            <video
              key={morphUrl}
              className={`page-video page-morph${morphVisible ? " page-video-visible" : ""}`}
              src={morphUrl}
              muted
              autoPlay
              playsInline
              onCanPlay={() => setMorphVisible(true)}
              onEnded={() => {
                setMorphVisible(false);
                window.setTimeout(() => onMorphEnded?.(), 500);
              }}
            />
          )}
        </>
      ) : (
        <div className="page-image-empty">Type something in the address bar to begin.</div>
      )}
      {imageUrl && markers}
      {ripple && <TapRipple xRatio={ripple.xRatio} yRatio={ripple.yRatio} onDone={onRippleDone} />}
      {overlay !== "none" && <div className="page-loading-sheen" />}
      {overlay === "loading" && <div className="page-loading-overlay">{loadingContent ?? "Generating…"}</div>}
      {overlay === "video-generating" && (
        // Passive: the page is done and clickable, so this pill sits over it without swallowing taps.
        <div className="page-loading-overlay page-loading-overlay-passive">
          <span className="generation-progress-spinner" aria-hidden="true" />
          <span>Generating video…</span>
        </div>
      )}
    </div>
  );
}
