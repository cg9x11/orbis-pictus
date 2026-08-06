export interface ParsedDataUrl {
  mimeType: string;
  base64: string;
}

/** Parses a `data:image/<type>;base64,<data>` URL. Throws if the string isn't one. */
export function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const match = /^data:(image\/\w+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a data: URL");
  const [, mimeType, base64] = match;
  return { mimeType: mimeType!, base64: base64! };
}
