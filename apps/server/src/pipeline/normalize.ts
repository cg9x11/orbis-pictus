/** PLAN §2.3 layer 2: lowercase, trim, collapse whitespace — so "Phở Bowl" and "phở   bowl " match. */
export function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/\s+/g, " ");
}
