import { useCallback } from "react";
import { drawTapMarker } from "../lib/tapMarker";

/** Converts a click on a displayed <img> into a marked-up JPEG data URL (PLAN §1.3). */
export function useTapMarker() {
  const captureTap = useCallback((image: HTMLImageElement, clientX: number, clientY: number) => {
    const rect = image.getBoundingClientRect();
    const xRatio = (clientX - rect.left) / rect.width;
    const yRatio = (clientY - rect.top) / rect.height;
    const dataUrl = drawTapMarker(image, xRatio, yRatio);
    return { dataUrl, xRatio, yRatio };
  }, []);

  return { captureTap };
}
