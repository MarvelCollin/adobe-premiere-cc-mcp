export function toHostPath(path: string): string {
  return String(path).replace(/\//g, "\\");
}
