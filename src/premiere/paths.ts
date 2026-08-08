/**
 * Premiere's file APIs are inconsistent about separators on Windows.
 * `File()` happily takes forward slashes, but `exportAsMediaDirect` fails with a
 * bare "Error: Unknown Error" unless both the output and the preset are native
 * backslash paths. Normalising everything on the way in avoids the whole class
 * of problem, and callers can pass whichever style they like.
 */
export function toHostPath(path: string): string {
  return String(path).replace(/\//g, "\\");
}
