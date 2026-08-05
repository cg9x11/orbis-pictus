import type { AspectRatio, ConfigResponse, GenerateEvent, GenerateRequest, Node, NodesGetResponse } from "@flipbook/shared";
import { GenerateEventSchema } from "@flipbook/shared";
import { parseSSEStream } from "./sse";

export async function streamGenerate(
  request: GenerateRequest,
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`Generate request failed (${res.status}): ${body}`);
  }

  await parseSSEStream(res, (eventName, data) => {
    const parsed = GenerateEventSchema.safeParse({ event: eventName, data: JSON.parse(data) });
    if (parsed.success) onEvent(parsed.data);
  });
}

export async function fetchNode(id: string): Promise<NodesGetResponse> {
  const res = await fetch(`/api/nodes/${id}`);
  if (!res.ok) throw new Error(`Node ${id} not found`);
  return res.json();
}

export async function fetchVariant(id: string, ratio: AspectRatio): Promise<Node> {
  const res = await fetch(`/api/nodes/${id}/variant?ratio=${encodeURIComponent(ratio)}`);
  if (!res.ok) throw new Error(`Failed to fetch ${ratio} variant for node ${id}`);
  const { node } = (await res.json()) as { node: Node };
  return node;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function uploadImage(image: string, aspectRatio: AspectRatio, sessionId: string): Promise<Node> {
  const res = await fetch("/api/nodes/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, aspect_ratio: aspectRatio, session_id: sessionId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }
  const { node } = (await res.json()) as { node: Node };
  return node;
}
