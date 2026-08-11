import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DEMO_ROOT_ID, type Node } from "@orbis/shared";
import { deleteNode, fetchGalleryPage } from "../lib/api";
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

/** The trash-can glyph (Lucide-style), matching BranchIcon/StarIcon's stroke-based convention. Only
 *  used on the gallery card's delete control, so it lives here rather than in a shared icon file. */
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/** The gallery card's delete flow: an inline confirm/deleting/error overlay, keyed by card id so
 *  only one card shows it at a time - clicking a second card's trash icon just moves it there. */
type DeleteFlow = { id: string; phase: "confirm" | "deleting" | "error"; message?: string };

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
  // The one card currently showing a delete confirm/deleting/error overlay, or null. See DeleteFlow.
  const [deleteFlow, setDeleteFlow] = useState<DeleteFlow | null>(null);

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
        // which offers the suggestion chips - a usable page rather than a dead one.
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

  // Hard delete, deep (the whole subtree - see plans/PLAN-delete-gallery.md). On success the card
  // drops out of `gallery` in place, no refetch; on failure the card stays and the overlay switches
  // to an error message the user can dismiss without losing their place in the grid. No unmount
  // guard: Landing stays mounted while the overlay is open (clicking another card just moves it),
  // and React 18 makes a setState after unmount a harmless no-op regardless.
  const confirmDelete = useCallback((id: string) => {
    setDeleteFlow({ id, phase: "deleting" });
    deleteNode(id)
      .then(() => {
        setGallery((prev) => (prev ?? []).filter((n) => n.id !== id));
        setVersionCounts((prev) => {
          const { [id]: _removed, ...rest } = prev;
          return rest;
        });
        setDeleteFlow(null);
      })
      .catch((err: unknown) => {
        setDeleteFlow({ id, phase: "error", message: err instanceof Error ? err.message : "Couldn't delete page" });
      });
  }, []);

  return (
    <div className="landing">
      {/* The headline tagline now lives in the app masthead above the browser, so it is not
          repeated here - this section leads with the how-it-works copy and the gallery. Note the
          copy must match the read-only demo above: it is pre-built, so the old "nothing is
          pre-built anywhere" claim no longer holds and would read as a contradiction. */}
      <p className="landing-copy">
        The page above is a live demo - tap a glowing spot to open it, and use the trail to step back. It's
        read-only, so nothing you do there spends anything.
      </p>
      <p className="landing-copy">
        Ready for your own? Type anything in the address bar. Each page renders in real time as a single
        generated image - not a webpage - and tapping anything inside it opens a new page about that thing.
        Apart from this demo, nothing is pre-built: every page you make is invented the moment you ask.
      </p>

      {gallery === null && <p className="landing-loading">Loading examples…</p>}

      {gallery !== null && gallery.length > 0 && (
        <>
          <div className="landing-gallery">
            {gallery.map((node) => {
              const count = versionCounts[node.id] ?? 0;
              const flow = deleteFlow?.id === node.id ? deleteFlow : null;
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
                  {/* The built-in demo card has no delete control - deleting it would break the home
                      page's "/" boot (see DEMO_ROOT_ID). The server enforces this too, with a 403. */}
                  {node.id !== DEMO_ROOT_ID && (
                    <button
                      type="button"
                      className="card-delete-button"
                      aria-label="Delete this page"
                      title="Delete this page"
                      // The card itself is a <Link>: preventDefault stops the navigation the anchor
                      // would otherwise fire on click, and stopPropagation keeps the click from
                      // reaching any other ancestor listener.
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteFlow({ id: node.id, phase: "confirm" });
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                  <span className="gallery-card-title">{node.page_title}</span>

                  {flow && (
                    // Swallows every click on the overlay, including empty scrim space, so a stray
                    // tap while confirming/erroring never falls through to the Link underneath.
                    <div className="card-delete-overlay" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      {flow.phase === "error" ? (
                        <>
                          <p className="card-delete-message">{flow.message}</p>
                          <button type="button" className="card-delete-dismiss" onClick={() => setDeleteFlow(null)}>
                            OK
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="card-delete-message">
                            Delete this page and everything under it? This can't be undone.
                          </p>
                          <div className="card-delete-actions">
                            <button
                              type="button"
                              className="card-delete-confirm"
                              disabled={flow.phase === "deleting"}
                              onClick={() => confirmDelete(node.id)}
                            >
                              {flow.phase === "deleting" ? "Deleting…" : "Delete"}
                            </button>
                            <button
                              type="button"
                              className="card-delete-cancel"
                              disabled={flow.phase === "deleting"}
                              onClick={() => setDeleteFlow(null)}
                            >
                              No
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
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
