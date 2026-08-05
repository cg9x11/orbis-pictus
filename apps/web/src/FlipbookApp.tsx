import { useEffect, useState } from "react";
import type { AspectRatio } from "@flipbook/shared";
import { BrowserFrame } from "./components/BrowserFrame";
import { AddressBar } from "./components/AddressBar";
import { PageImage } from "./components/PageImage";
import { useGenerationStream } from "./hooks/useGenerationStream";
import { useSessionTrail } from "./hooks/useSessionTrail";
import { useTapMarker } from "./hooks/useTapMarker";
import { fetchNode } from "./lib/api";

const ASPECT_RATIO: AspectRatio = "16:9";

function newSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

export function FlipbookApp({ initialNodeId }: { initialNodeId?: string }) {
  const [sessionId, setSessionId] = useState<string>(newSessionId);
  const [hydrating, setHydrating] = useState(!!initialNodeId);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const { trail, currentIndex, current, append, navigateTo, reset } = useSessionTrail();
  const { state, start, reset: resetGeneration } = useGenerationStream();
  const { captureTap } = useTapMarker();
  const [ripple, setRipple] = useState<{ xRatio: number; yRatio: number } | null>(null);

  useEffect(() => {
    if (!initialNodeId) return;
    let cancelled = false;
    fetchNode(initialNodeId)
      .then(({ node, history }) => {
        if (cancelled) return;
        reset([...history, node]);
        setSessionId(node.session_id);
        setHydrating(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHydrateError(err instanceof Error ? err.message : "Failed to load page");
        setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialNodeId, reset]);

  const isStreaming = state.status === "streaming";

  const handleSearch = async (query: string) => {
    const node = await start({
      mode: "search",
      query,
      aspect_ratio: ASPECT_RATIO,
      web_search: false,
      session_id: sessionId,
      current_node_id: current?.id ?? "",
    });
    append(node);
  };

  const handleTap = async (imageEl: HTMLImageElement, clientX: number, clientY: number) => {
    if (!current || isStreaming) return;
    const { dataUrl, xRatio, yRatio } = captureTap(imageEl, clientX, clientY);
    setRipple({ xRatio, yRatio });
    const node = await start({
      mode: "tap",
      image: dataUrl,
      aspect_ratio: ASPECT_RATIO,
      web_search: false,
      parent_query: current.query,
      parent_title: current.page_title,
      session_id: sessionId,
      current_node_id: current.id,
    });
    append(node);
  };

  const handleNavigate = (index: number) => {
    resetGeneration();
    navigateTo(index);
  };

  // previewImageUrl only wins while a generation is actively in flight; once it's done
  // (or the user has navigated elsewhere via breadcrumbs), the selected node's own image applies.
  const imageUrl = (isStreaming && state.previewImageUrl) || current?.image_variants[ASPECT_RATIO];

  if (hydrating) return <div className="loading-screen">Loading…</div>;
  if (hydrateError) return <div className="loading-screen">Couldn't load that page: {hydrateError}</div>;

  return (
    <BrowserFrame
      addressBar={
        <AddressBar
          trail={trail}
          currentIndex={currentIndex}
          onNavigate={handleNavigate}
          onSubmit={handleSearch}
          disabled={isStreaming}
        />
      }
    >
      <PageImage
        imageUrl={imageUrl}
        loading={isStreaming}
        onTap={handleTap}
        ripple={ripple}
        onRippleDone={() => setRipple(null)}
      />
      {isStreaming && state.tapSubject && <div className="tap-subject-banner">{state.tapSubject}</div>}
      {state.status === "error" && <div className="error-banner">{state.error}</div>}
    </BrowserFrame>
  );
}
