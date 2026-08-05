import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Node } from "@flipbook/shared";
import { fetchGallery } from "../lib/api";

const SUGGESTIONS = [
  "A coral reef ecosystem",
  "How the Apollo 11 mission worked",
  "Tokyo street food tour",
  "The history of the printing press",
];

function thumbnailUrl(node: Node): string | undefined {
  return node.image_variants["16:9"] ?? Object.values(node.image_variants)[0];
}

export function Landing({ onSuggestion }: { onSuggestion: (query: string) => void }) {
  const [gallery, setGallery] = useState<Node[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGallery(8)
      .then((nodes) => {
        if (!cancelled) setGallery(nodes);
      })
      .catch(() => {
        if (!cancelled) setGallery([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="landing">
      <h1 className="landing-title">An infinite visual encyclopedia, drawn as you explore it</h1>
      <p className="landing-copy">
        Type anything in the address bar above and a page renders in real time — a single generated image, not a
        webpage. Click anything inside it and a new page opens exploring that thing in more depth. There's no
        pre-built content anywhere: every page you see was invented the moment you asked for it.
      </p>

      {gallery === null && <p className="landing-loading">Loading examples…</p>}

      {gallery !== null && gallery.length > 0 && (
        <div className="landing-gallery">
          {gallery.map((node) => (
            <Link key={node.id} to={`/n/${node.id}`} className="gallery-card">
              {thumbnailUrl(node) && <img src={thumbnailUrl(node)} alt="" loading="lazy" />}
              <span className="gallery-card-title">{node.page_title}</span>
            </Link>
          ))}
        </div>
      )}

      {gallery !== null && gallery.length === 0 && (
        <div className="landing-suggestions">
          <p>Not sure where to start? Try one of these:</p>
          <div className="suggestion-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="suggestion-chip" onClick={() => onSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
