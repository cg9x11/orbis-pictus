import { useRef, useState } from "react";
import { fileToDataUrl, loadImageDimensions, nearestAspectRatio } from "../lib/imageCapture";
import { uploadImage } from "../lib/api";
import type { Node } from "@flipbook/shared";

interface UploadButtonProps {
  sessionId: string;
  disabled: boolean;
  onUploaded: (node: Node) => void;
  onError: (message: string) => void;
}

export function UploadButton({ sessionId, disabled, onUploaded, onError }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { width, height } = await loadImageDimensions(dataUrl);
      const ratio = nearestAspectRatio(width, height);
      const node = await uploadImage(dataUrl, ratio, sessionId);
      onUploaded(node);
    } catch (err) {
      console.error(err);
      onError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleChange} />
      <button
        type="button"
        className="toolbar-button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "Uploading…" : "Upload photo"}
      </button>
    </>
  );
}
