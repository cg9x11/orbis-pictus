import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerateErrorCode, GenerateEvent, GenerateRequest, GenerationStage, Node } from "@orbis/shared";
import { streamGenerate } from "../lib/api";

/** Payload of the server's `notice` event, derived from the event union so it cannot drift from it. */
export type GenerationNotice = Extract<GenerateEvent, { event: "notice" }>["data"];

export interface GenerationState {
  status: "idle" | "streaming" | "done" | "error";
  tapSubject?: string;
  /** Latest phase reported by the server (the `stage` event). */
  stage?: GenerationStage;
  /** Known from the "drawing" stage onwards, once the authoring model has named the page. */
  pageTitle?: string;
  /** Epoch ms the current generation began, for the elapsed-time readout. */
  startedAt?: number;
  previewImageUrl?: string;
  node?: Node;
  error?: string;
  /** Machine-readable reason for `error`, when the server's `error` event carried one — e.g. "quota"
   *  drives the quota-specific error banner. Unset for a network-level failure (the stream's own
   *  .catch below), since those never reach the server's structured error event at all. */
  errorCode?: GenerateErrorCode;
  /**
   * Non-fatal advisories from the server: the provider or model you picked could not be used, and
   * something else drew instead. The page still arrives, so these must never be shown as an error.
   *
   * Collected into a list rather than overwritten, because one generation can raise two (a provider
   * swap and then a model swap), and the second must not erase the first.
   */
  notices?: GenerationNotice[];
}

export function useGenerationStream() {
  const [state, setState] = useState<GenerationState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback((request: GenerateRequest): Promise<Node> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "streaming", startedAt: Date.now() });

    return new Promise<Node>((resolve, reject) => {
      streamGenerate(
        request,
        (event) => {
          switch (event.event) {
            case "tap_subject":
              setState((s) => ({ ...s, tapSubject: event.data.subject }));
              break;
            case "stage":
              setState((s) => ({ ...s, stage: event.data.stage, pageTitle: event.data.pageTitle ?? s.pageTitle }));
              break;
            case "preview":
              setState((s) => ({ ...s, previewImageUrl: event.data.imageUrl }));
              break;
            case "notice":
              setState((s) => ({ ...s, notices: [...(s.notices ?? []), event.data] }));
              break;
            case "complete":
              setState((s) => ({ ...s, status: "done", node: event.data }));
              resolve(event.data);
              break;
            case "error":
              setState((s) => ({ ...s, status: "error", error: event.data.message, errorCode: event.data.code }));
              reject(new Error(event.data.message));
              break;
          }
        },
        controller.signal,
      ).catch((err) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((s) => ({ ...s, status: "error", error: message, errorCode: undefined }));
        reject(err instanceof Error ? err : new Error(message));
      });
    });
  }, []);

  // Abort the in-flight stream, not just clear the UI state. Callers reset() when the user
  // navigates away mid-generation (e.g. a breadcrumb click); without the abort the orphaned SSE
  // keeps running and its eventual `complete` would resolve start()'s promise, firing the caller's
  // append() against the page the user already moved to — truncating the trail and yanking them
  // forward. The aborted stream's own `.catch` sees `signal.aborted` and stays silent.
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  // A stream must never outlive the component: on unmount, abort whatever is in flight so its
  // network work and setState callbacks don't dangle after teardown.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, reset };
}
