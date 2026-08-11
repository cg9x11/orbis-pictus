/**
 * Idle-loop motion prompt - the GENERIC FALLBACK used only when the per-page VLM
 * motion prompt (LlmProvider.describeIdleMotion / idle-motion.md) is unavailable or errors; the
 * primary path tailors the motion to what's actually in each page. Style-agnostic on purpose: this
 * is i2v, so the model already sees the rendered frame - naming a specific medium here would only
 * fight it. Pages are mostly dense, readable text, so it still leans hard on "nothing textual moves"
 * - a known residual risk, not fully solved (a text line visibly mutated
 * across frames even with this instruction present).
 */
export const IDLE_LOOP_MOTION_PROMPT =
  "Seamless subtle looping ambient motion: gentle ambient movement only - things like steam or smoke " +
  "drifting, water rippling, leaves or fabric swaying in a light breeze, small figures shifting their " +
  "weight or turning their head, light flickering softly, wherever such elements appear. Motion must " +
  "be small and restrained, never energetic or fast. Camera is completely static: fixed framing, " +
  "fixed zoom, no camera movement, no pans, no dolly, no zoom. Do not add, remove, or move any " +
  "object, do not change the layout, composition, colours, or rendering style, and do not change or " +
  "redraw any text, title, label, number, or caption anywhere in the frame - every word must stay " +
  "pixel-identical to the first frame throughout. This must remain recognizably the exact same page, " +
  "not a new scene.";

/**
 * Page-transition morph prompt (gate-tested 2026-08-06 against the frame-by-frame judgment that
 * produced this wording) - the GENERIC FALLBACK used only when the
 * per-transition VLM prompt (LlmProvider.describeMorphMotion / morph-motion.md) is unavailable or
 * errors. First frame = parent page image, last frame = child page image; the two differ completely
 * in on-page text since they're different pages, so unlike the idle-loop prompt this one *asks* for
 * text to change over the clip. Style-agnostic (i2v/flf2v already sees the frames).
 */
export const MORPH_TRANSITION_MOTION_PROMPT =
  "Smooth continuous transition: the page transforms from the first image into the second image, as " +
  "if the whole scene is being repainted while the camera holds still. The main subject the two " +
  "images share stays anchored in the same place on screen throughout. Titles, labels, and callout " +
  "text dissolve and repaint into the new page's text over the course of the clip. Camera is " +
  "completely static: fixed framing, fixed zoom, no pans, no dolly, no zoom. End the clip landing " +
  "cleanly on the second image.";
