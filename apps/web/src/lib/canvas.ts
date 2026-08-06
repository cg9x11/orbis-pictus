/** Creates a canvas sized to `image`'s natural dimensions, draws the image onto it, and returns
 *  its 2D context (the canvas itself is reachable via `ctx.canvas`). */
export function imageToCanvas(image: HTMLImageElement): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return ctx;
}
