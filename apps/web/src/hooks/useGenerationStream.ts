import { useCallback, useRef, useState } from "react";
import type { GenerateRequest, Node } from "@flipbook/shared";
import { streamGenerate } from "../lib/api";

export interface GenerationState {
  status: "idle" | "streaming" | "done" | "error";
  tapSubject?: string;
  previewImageUrl?: string;
  node?: Node;
  error?: string;
}

export function useGenerationStream() {
  const [state, setState] = useState<GenerationState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback((request: GenerateRequest): Promise<Node> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "streaming" });

    return new Promise<Node>((resolve, reject) => {
      streamGenerate(
        request,
        (event) => {
          switch (event.event) {
            case "tap_subject":
              setState((s) => ({ ...s, tapSubject: event.data.subject }));
              break;
            case "preview":
              setState((s) => ({ ...s, previewImageUrl: event.data.imageUrl }));
              break;
            case "complete":
              setState((s) => ({ ...s, status: "done", node: event.data }));
              resolve(event.data);
              break;
            case "error":
              setState((s) => ({ ...s, status: "error", error: event.data.message }));
              reject(new Error(event.data.message));
              break;
          }
        },
        controller.signal,
      ).catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((s) => ({ ...s, status: "error", error: message }));
        reject(err instanceof Error ? err : new Error(message));
      });
    });
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, start, reset };
}
