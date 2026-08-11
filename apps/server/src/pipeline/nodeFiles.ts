import fs from "node:fs";
import path from "node:path";

/**
 * Removes each node's on-disk folder (`imagesDir/<id>/`, the same path every writer in
 * imageStorage.ts / videoStorage.ts / morphStorage.ts uses) after its DB rows are already gone.
 * Best-effort: `force: true` swallows a missing folder (ENOENT) rather than throwing, since a
 * node can legitimately have no files yet (e.g. deleted mid-generation).
 *
 * `isReferenced` lets the caller skip a folder that a SURVIVING node's image_variants still
 * points into - the prompt-hash image-reuse cache can make a newer node's image live in an older
 * node's directory (see storage/nodes.ts's referencedImageFolders). Removing a referenced folder
 * would delete pixels a living page still shows; keeping it is a small, acceptable disk leak.
 */
export function deleteNodeDirs(imagesDir: string, ids: string[], isReferenced: (id: string) => boolean): void {
  for (const id of ids) {
    if (isReferenced(id)) continue;
    fs.rmSync(path.join(imagesDir, id), { recursive: true, force: true });
  }
}
