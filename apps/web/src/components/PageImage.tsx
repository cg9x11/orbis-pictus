import type { RefObject } from "react";
import type { AspectRatio } from "@flipbook/shared";
import { TapRipple } from "./TapRipple";

interface PageImageProps {
  imageUrl?: string;
  loading: boolean;
  onTap: (image: HTMLImageElement, clientX: number, clientY: number) => void;
  ripple: { xRatio: number; yRatio: number } | null;
  onRippleDone: () => void;
  imgRef: RefObject<HTMLImageElement>;
  aspectRatio: AspectRatio;
}

export function PageImage({ imageUrl, loading, onTap, ripple, onRippleDone, imgRef, aspectRatio }: PageImageProps) {
  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || loading) return;
    onTap(imgRef.current, e.clientX, e.clientY);
  };

  return (
    <div className="page-image-container" style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
      {imageUrl ? (
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          className={`page-image${loading ? " page-image-loading" : ""}`}
          onClick={handleClick}
        />
      ) : (
        <div className="page-image-empty">Type something in the address bar to begin.</div>
      )}
      {ripple && <TapRipple xRatio={ripple.xRatio} yRatio={ripple.yRatio} onDone={onRippleDone} />}
      {loading && <div className="page-loading-overlay">Generating…</div>}
    </div>
  );
}
