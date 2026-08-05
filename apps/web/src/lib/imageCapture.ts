import type { AspectRatio } from "@flipbook/shared";

/** Exports the currently displayed page image as a plain (unmarked) JPEG data URL, for edit-mode reference input. */
export function captureCurrentImage(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** Picks the AspectRatio bucket whose ratio is closest to an arbitrary image's own dimensions. */
export function nearestAspectRatio(width: number, height: number): AspectRatio {
  const target = width / height;
  const candidates: [AspectRatio, number][] = [
    ["16:9", 16 / 9],
    ["3:4", 3 / 4],
    ["1:1", 1],
  ];
  let best: AspectRatio = "16:9";
  let bestDiff = Infinity;
  for (const [ratio, value] of candidates) {
    const diff = Math.abs(Math.log(target / value));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }
  return best;
}

/** Reads a File as a data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Loads a data URL into an Image to read its natural dimensions. */
export function loadImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}
