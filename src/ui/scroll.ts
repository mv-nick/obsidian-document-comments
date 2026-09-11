export type Box = { top: number; bottom: number };

/** True when `box` lies entirely inside `viewport` (with `pad` px of tolerance at
 *  each edge). The check that gates every automatic re-stack or scroll: a card the
 *  reader can already see is never moved. */
export const isFullyVisible = (box: Box, viewport: Box, pad = 0): boolean => {
	return box.top >= viewport.top - pad && box.bottom <= viewport.bottom + pad;
};

/**
 * How far to scroll (positive = down) so that `card` sits fully inside `viewport`
 * with `pad` px to spare, moving as little as possible. When `anchor` (the hovered
 * text) is given and both can fit, the scroll also keeps the anchor on screen;
 * when they can't both fit, the card wins — showing the whole comment is the
 * point. A card taller than the viewport aligns its top. Returns 0 when the card
 * is already visible.
 */
export const revealDelta = (card: Box, viewport: Box, anchor: Box | null, pad = 12): number => {
	// The scroll deltas that leave a box fully visible: at least `lo`, at most `hi`.
	const fits = (box: Box): [number, number] => [box.bottom - (viewport.bottom - pad), box.top - (viewport.top + pad)];
	const nearestToZero = ([lo, hi]: [number, number]): number => (lo > hi ? hi : lo > 0 ? lo : hi < 0 ? hi : 0);
	const forCard = fits(card);
	if (anchor) {
		const forAnchor = fits(anchor);
		const both: [number, number] = [Math.max(forCard[0], forAnchor[0]), Math.min(forCard[1], forAnchor[1])];
		if (both[0] <= both[1]) return Math.round(nearestToZero(both));
	}
	return Math.round(nearestToZero(forCard));
};

/** Center a document block in a scroll viewport, clamped to both scroll edges. */
export const centeredScrollTop = (
	blockTop: number,
	blockHeight: number,
	viewportHeight: number,
	scrollHeight: number,
): number => {
	const centered = blockTop + blockHeight / 2 - viewportHeight / 2;
	return Math.max(0, Math.min(centered, Math.max(0, scrollHeight - viewportHeight)));
};
