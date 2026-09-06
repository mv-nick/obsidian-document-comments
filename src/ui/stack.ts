export type Placement = {
	top: number;
	height: number;
};

/**
 * Stack margin cards top-down without overlap: honor anchor order (by `top`),
 * and push each card past the previous one plus a gap. Returns the resolved top
 * for each input in its ORIGINAL order.
 *
 * The first card's floor is -Infinity, so a card whose anchor has scrolled above
 * the viewport keeps a negative top and slides off the top edge instead of
 * sticking there in view.
 *
 * With a `pivot` (an index into `placements`), that card is placed exactly at its
 * own top — it is the one being hovered or worked on, so it must sit beside its
 * text — and the others are pushed away from it: later cards stack downward from
 * its bottom, earlier cards stack upward from its top (off the top edge if they
 * must). On a heavily annotated note the plain stack can run past the end of the
 * document, where no scroll can reach; pivoting brings the card you point at to
 * where you are pointing instead. A pivot that the plain stack would not have
 * displaced yields the same layout as the plain stack.
 */
export const stackTops = (placements: Placement[], gap: number, pivot?: number): number[] => {
	const order = placements.map((p, index) => ({ ...p, index })).sort((a, b) => a.top - b.top);
	const tops = Array.from<number>({ length: placements.length });
	const at = pivot === undefined ? -1 : order.findIndex((p) => p.index === pivot);

	// Downward pass: from the pivot (or the top of the stack) each card sits at its
	// own top unless the card above it reaches lower.
	let cursor = Number.NEGATIVE_INFINITY;
	for (let i = Math.max(at, 0); i < order.length; i++) {
		const p = order[i];
		if (!p) continue;
		const y = i === at ? p.top : Math.max(p.top, cursor);
		tops[p.index] = y;
		cursor = y + p.height + gap;
	}
	// Upward pass, pivot mode only: each earlier card sits at its own top unless
	// that would run into the card below it, in which case it moves up.
	let ceiling = at >= 0 ? (order[at]?.top ?? 0) : 0;
	for (let i = at - 1; i >= 0; i--) {
		const p = order[i];
		if (!p) continue;
		const y = Math.min(p.top, ceiling - gap - p.height);
		tops[p.index] = y;
		ceiling = y;
	}
	return tops;
};
