/** A transition duration that collapses to zero when the user prefers reduced motion. */
export function motion(ms: number): number {
  if (typeof window === "undefined") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}
