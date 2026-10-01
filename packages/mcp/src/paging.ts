/** Slice a long snapshot at a line boundary so each tool result stays under the client's output limit. */
export function pageOf(tree: string, offset: number, limit: number): { text: string; next?: number } {
  const start = Math.min(Math.max(0, offset), tree.length);
  if (tree.length - start <= limit) return { text: tree.slice(start) };
  const newline = tree.lastIndexOf('\n', start + limit);
  if (newline > start) return { text: tree.slice(start, newline), next: newline + 1 };
  return { text: tree.slice(start, start + limit), next: start + limit };
}
