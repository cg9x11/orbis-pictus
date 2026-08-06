/**
 * Idle-loop motion prompt (PLAN §3 Phase 5). Adapted from the original's own motion prompt
 * (PLAN §1.5: "Seamless continuous perfect loop... small objects idly animated, people walking,
 * cars driving, boats moving") but tuned for our house style: the source frame is a handmade
 * miniature-diorama photo that's mostly dense, readable text (title, callout plaques, footer
 * caption), so the prompt leans hard on "nothing textual moves" — confirmed necessary by the live
 * test clip (PLAN §2 Video findings: a secondary text line visibly mutated across frames even
 * with this instruction present, so this is a known residual risk, not a fully solved one).
 */
export const IDLE_LOOP_MOTION_PROMPT =
  "Seamless subtle looping ambient motion in this handmade miniature diorama scene: gentle ambient " +
  "movement only — things like steam or smoke drifting, water rippling, leaves or fabric swaying in " +
  "a light breeze, small figures shifting their weight or turning their head, light flickering " +
  "softly. Motion must be small and restrained, never energetic or fast. Camera is completely " +
  "static: fixed framing, fixed zoom, no camera movement, no pans, no dolly, no zoom. Do not add, " +
  "remove, or move any object, do not change the layout, composition, or colours, and do not change " +
  "or redraw any text, title, label, number, or caption anywhere in the frame — every word must " +
  "stay pixel-identical to the first frame throughout. This must remain recognizably the exact same " +
  "page, not a new scene.";

/**
 * Page-transition morph prompt (PLAN §3 Phase 5, gate-tested 2026-08-06 — see PLAN §2 for the
 * frame-by-frame judgment that produced this wording). First frame = parent page image, last
 * frame = child page image; the two differ completely in on-page text since they're different
 * pages, so unlike the idle-loop prompt this one *asks* for text to change over the clip.
 */
export const MORPH_TRANSITION_MOTION_PROMPT =
  "Smooth continuous transition inside this handmade miniature diorama scene: the page transforms " +
  "from the first image into the second image, as if the whole scene is being repainted while the " +
  "camera holds still. The main subject the two images share stays anchored in the same place on " +
  "screen throughout. Titles, labels, and callout text dissolve and repaint into the new page's " +
  "text over the course of the clip. Camera is completely static: fixed framing, fixed zoom, no " +
  "pans, no dolly, no zoom. End the clip landing cleanly on the second image.";
