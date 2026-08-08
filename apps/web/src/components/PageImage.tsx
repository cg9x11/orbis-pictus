import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AspectRatio } from "@flipbook/shared";
import { TapRipple } from "./TapRipple";
import { classNames } from "../lib/classNames";

// Must match the `.page-video` opacity transition duration in styles.css — this is how long the
// morph clip takes to fade out after setMorphVisible(false), before it's safe to unmount it.
const MORPH_FADE_OUT_MS = 500;

// Must match the `.page-image-outgoing` animation duration in styles.css — how long the page being
// left stays mounted while it fades away. Short on purpose: this is the fallback for every move an
// AI morph clip cannot cover (a breadcrumb jump of more than one step spans several parent/child
// pairs, so no single clip could represent it), and going back should feel immediate.
const PAGE_CROSSFADE_MS = 320;

// How long the page being left may stay held while a morph clip is fetched and buffered. Generous
// enough for a local file to start on a slow machine, short enough that a clip which never plays
// doesn't strand the viewer on a page they already navigated away from.
const MORPH_WAIT_MAX_MS = 2500;

interface PageImageProps {
  imageUrl?: string;
  /** The ready idle-loop clip, or null while none is available/enabled. */
  videoUrl?: string | null;
  /** A ready transition-morph clip to play once over the already-current image, or null. */
  morphUrl?: string | null;
  /** A transition is under way — its clip is being looked up, or is playing. While this is true the
   *  page being left stays painted over the destination, so the destination is never glimpsed before
   *  the clip that is supposed to lead into it. */
  morphActive?: boolean;
  /** Called once the morph has finished playing (or its fade-out completes) so the caller can clear it. */
  onMorphEnded?: () => void;
  loading: boolean;
  /** What the loading overlay shows. Falls back to a plain word when the caller has nothing richer
   *  (e.g. an aspect-ratio re-render, which runs over plain HTTP with no event stream). */
  loadingContent?: ReactNode;
  /** Overlay pinned to the image's own coordinate space — the already-explored tap markers. */
  markers?: ReactNode;
  /** A background idle-loop clip is being generated for this page. Unlike
   *  `loading`, the page is already finished and stays fully interactive — the indicator only says
   *  "a clip is coming", it must never block a tap. */
  videoGenerating?: boolean;
  /** First-step animation flow: navigation is being held while this page's clips finish generating,
   *  so the transition plays through without a gap. The page underneath stays visible (its own idle
   *  loop keeps playing); this only shows a passive "preparing" pill. Taps are already blocked
   *  upstream by the controller's `busy` guard while this is true. */
  preparingClips?: boolean;
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
  morphActive,
  onMorphEnded,
  loading,
  loadingContent,
  markers,
  videoGenerating,
  preparingClips,
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
  // The page being left, kept painted on top and faded out to reveal the new one underneath. Fading
  // the OUTGOING image out (rather than fading the incoming one in) means the live <img> is never
  // remounted, so there is no blank frame while the new picture decodes and imgRef stays put.
  const [outgoingUrl, setOutgoingUrl] = useState<string | null>(null);
  const shownUrlRef = useRef<string | undefined>(imageUrl);

  useEffect(() => {
    setVideoReady(false);
  }, [videoUrl]);

  useEffect(() => {
    setMorphVisible(false);
  }, [morphUrl]);

  useEffect(() => {
    const previous = shownUrlRef.current;
    shownUrlRef.current = imageUrl;
    if (!previous || !imageUrl || previous === imageUrl) return;
    setOutgoingUrl(previous);
  }, [imageUrl]);

  // With no clip coming, this is the plain crossfade: the outgoing page fades out and unmounts.
  // With one coming it must NOT: React swaps `imageUrl` to the destination on the very commit that
  // navigation happens, while the clip is still being fetched and buffered, so releasing here would
  // show the destination and only then fade in a clip whose first frame is the page we just left.
  // Holding until the clip ends keeps the order the transition is meant to have.
  useEffect(() => {
    if (!outgoingUrl || morphActive) return;
    const timer = setTimeout(() => setOutgoingUrl(null), PAGE_CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [outgoingUrl, morphActive]);

  // Safety valve for the window before the clip is on screen: if it never becomes playable (a broken
  // file, a fetch that resolves to nothing), release the held page rather than sitting on it forever.
  // Only armed while waiting — once the clip is visible, its own `ended`/`error` handlers take over.
  useEffect(() => {
    if (!outgoingUrl || !morphActive || morphVisible) return;
    const timer = setTimeout(() => setOutgoingUrl(null), MORPH_WAIT_MAX_MS);
    return () => clearTimeout(timer);
  }, [outgoingUrl, morphActive, morphVisible]);

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || loading) return;
    onTap(imgRef.current, e.clientX, e.clientY);
  };

  const overlay = loading
    ? "loading"
    : preparingClips
      ? "preparing-clips"
      : videoGenerating
        ? "video-generating"
        : "none";

  return (
    <div className="page-image-container" style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
      {imageUrl ? (
        <>
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className={classNames("page-image", { "page-image-loading": loading })}
            onClick={handleClick}
          />
          {videoUrl && (
            // Purely decorative overlay: pointer-events none so taps always land on the <img>
            // beneath, keeping the whole tap-marker pipeline untouched by this feature.
            <video
              key={videoUrl}
              className={classNames("page-video", { "page-video-visible": videoReady })}
              src={videoUrl}
              muted
              autoPlay
              loop
              playsInline
              onCanPlay={() => setVideoReady(true)}
            />
          )}
          {outgoingUrl && (
            // Deliberately rendered after the idle-loop clip and before the morph: these are all
            // absolutely positioned with auto z-index, so DOM order is paint order. The destination's
            // own loop starts the moment we arrive, and sitting above it is the only way this layer
            // actually covers the destination — above the <img> alone would leave the loop showing
            // through. The morph still comes last, so it plays over the top of everything.
            // The destination <img> stays mounted underneath throughout, so the browser keeps it
            // decoded and revealing it costs nothing.
            <img
              key={outgoingUrl}
              src={outgoingUrl}
              alt=""
              aria-hidden="true"
              className={classNames("page-image page-image-outgoing", { "page-image-outgoing-held": morphActive })}
            />
          )}
          {morphUrl && (
            // Plays once over the already-current image (which is the real child page, so
            // whatever the clip's own last frame looks like, the underlying page is exact once
            // this fades out), then unmounts itself. Rendered after the idle-loop video so it
            // stacks above it while playing.
            <video
              key={morphUrl}
              className={classNames("page-video page-morph", { "page-video-visible": morphVisible })}
              src={morphUrl}
              muted
              autoPlay
              playsInline
              onCanPlay={() => setMorphVisible(true)}
              // A clip that can't load would otherwise leave the page held until the safety valve
              // fires; treat it as a finished transition so the destination appears right away.
              onError={() => {
                setOutgoingUrl(null);
                onMorphEnded?.();
              }}
              onEnded={() => {
                // Drop the held page here, not after the fade: this clip's last frame IS the
                // destination, and it is still fully opaque at this instant, so swapping what sits
                // underneath is invisible — and by the time the clip fades out, the destination is
                // already the thing behind it.
                setOutgoingUrl(null);
                setMorphVisible(false);
                window.setTimeout(() => onMorphEnded?.(), MORPH_FADE_OUT_MS);
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
      {overlay === "preparing-clips" && (
        // First-step animation wait: the parent page stays visible (and its idle loop keeps playing)
        // while the next page's morph and idle loop finish rendering; the controller blocks taps
        // meanwhile. Named for the outcome, since the wait now covers both clips, not just the morph.
        <div className="page-loading-overlay page-loading-overlay-passive">
          <span className="generation-progress-spinner" aria-hidden="true" />
          <span>Preparing animation…</span>
        </div>
      )}
    </div>
  );
}
