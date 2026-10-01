/**
 * Multi-select semantics for the board grid (STEP 3).
 *
 * Kept as a pure function over an id list so the shift/ctrl behaviour can be
 * unit-tested without a DOM. `BoardGrid` just calls it and hands the result to
 * the store.
 */

/**
 * Computes the next selection for a click at `id`.
 *
 * Rules, matching Miro/Eraser/tldraw conventions:
 *
 * - plain click        → selection becomes exactly [id]
 * - ctrl/cmd click     → toggle just this board, keeping the rest
 * - shift click        → extend from the last anchor to `id`, replacing the
 *                        selection. With no anchor it behaves like a plain click.
 *
 * `ids` must be the *visible, ordered* id list — range selection is meaningless
 * against the raw store order because the grid can be sorted and filtered.
 */
export const nextSelection = (
  ids: string[],
  current: string[],
  id: string,
  modifiers: { shift?: boolean; meta?: boolean; ctrl?: boolean } = {},
  anchor: string | null = null,
): { selected: string[]; anchor: string | null } => {
  const additive = Boolean(modifiers.meta || modifiers.ctrl);

  if (modifiers.shift && anchor) {
    const from = ids.indexOf(anchor);
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) {
      // Anchor scrolled out of the current view; fall back to a plain click
      // rather than producing a nonsensical range.
      return { selected: [id], anchor: id };
    }
    const [start, end] = from < to ? [from, to] : [to, from];
    return { selected: ids.slice(start, end + 1), anchor };
  }

  if (additive) {
    return {
      selected: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
      // Ctrl-clicking does not move the anchor: shift after a ctrl-click should
      // still range from where the range selection started.
      anchor,
    };
  }

  return { selected: [id], anchor: id };
};

/** Ids removed by a bulk action should disappear from the selection. */
export const pruneSelection = (selected: string[], alive: string[]): string[] =>
  selected.filter((id) => alive.includes(id));
