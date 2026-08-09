import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Node } from "@orbis/shared";
import { fetchGalleryPage } from "../lib/api";
import { useCancellableEffect } from "../hooks/useCancellableEffect";
import { BranchIcon } from "./PageVersions";

const GALLERY_PAGE_SIZE = 12;

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
  // `gallery` accumulates across batches. null means the first batch has not arrived yet, which is
  // the loading state. An empty array means the first batch arrived and the gallery is genuinely
  // empty, which is the suggestions state. The two are different and must not be collapsed.
  const [gallery, setGallery] = useState<Node[] | null>(null);
  // Per-card version count, keyed by card node id, accumulated across batches alongside `gallery`. A
  // count above one shows the branch badge on that card.
  const [versionCounts, setVersionCounts] = useState<Record<string, number>>({});
  // The cursor for the NEXT batch. Null means there is no next batch, so no "Load more" button.
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Set only when a "Load more" click fails. It leaves the cards already on screen untouched and
  // offers a retry, rather than replacing the gallery with an error.
  const [loadMoreError, setLoadMoreError] = useState(false);

  // The in-flight guard is a ref, not the `loadingMore` state. Two clicks in the same tick both read
  // the same render's `loadingMore` (still false) and would each start a fetch with the same cursor,
  // appending the batch twice. A ref updates synchronously, so the second click sees the lock.
  const loadingRef = useRef(false);

  useCancellableEffect((cancelled) => {
    fetchGalleryPage(GALLERY_PAGE_SIZE)
      .then((page) => {
        if (cancelled()) return;
        setGallery(page.nodes);
        setVersionCounts(page.versionCounts);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        // A failed FIRST load has no cards to preserve, so it falls through to the empty state,
        // which offers the suggestion chips — a usable page rather than a dead one.
        if (!cancelled()) setGallery([]);
      });
  }, []);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    fetchGalleryPage(GALLERY_PAGE_SIZE, cursor)
      .then((page) => {
        setGallery((prev) => [...(prev ?? []), ...page.nodes]);
        setVersionCounts((prev) => ({ ...prev, ...page.versionCounts }));
        setCursor(page.nextCursor);
      })
      .catch(() => setLoadMoreError(true))
      .finally(() => {
        loadingRef.current = false;
        setLoadingMore(false);
      });
  }, [cursor]);

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
        <>
          <div className="landing-gallery">
            {gallery.map((node) => {
              const count = versionCounts[node.id] ?? 0;
              return (
                <Link key={node.id} to={`/n/${node.id}`} className="gallery-card">
                  {thumbnailUrl(node) && <img src={thumbnailUrl(node)} alt="" loading="lazy" />}
                  {count > 1 && (
                    // Only when a page has edit versions. The card already opens the DEFAULT version
                    // (the gallery lists default rows), and the branch button inside surfaces the rest.
                    <span className="card-branch-badge" title={`${count} versions`}>
                      <BranchIcon strokeWidth={2.4} />
                      {count}
                    </span>
                  )}
                  <span className="gallery-card-title">{node.page_title}</span>
                </Link>
              );
            })}
          </div>

          {loadMoreError && (
            <p className="landing-error">Could not load more pages. Try again.</p>
          )}

          {cursor !== null && (
            <button type="button" className="load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
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
