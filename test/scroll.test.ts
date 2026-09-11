import { describe, expect, test } from "vitest";
import { centeredScrollTop, isFullyVisible, revealDelta } from "../src/ui/scroll";

// Viewport spans 100..500. Boxes are {top, bottom} in the same coordinates.
const VIEW = { top: 100, bottom: 500 };

describe("isFullyVisible", () => {
	test("a card inside the viewport, touching its edges, is visible", () => {
		expect(isFullyVisible({ top: 100, bottom: 500 }, VIEW)).toBe(true);
		expect(isFullyVisible({ top: 200, bottom: 300 }, VIEW)).toBe(true);
	});

	test("a card clipped at either edge is not", () => {
		expect(isFullyVisible({ top: 90, bottom: 200 }, VIEW)).toBe(false);
		expect(isFullyVisible({ top: 400, bottom: 501 }, VIEW)).toBe(false);
	});

	test("a card entirely off screen is not", () => {
		expect(isFullyVisible({ top: 600, bottom: 700 }, VIEW)).toBe(false);
	});

	test("tolerance forgives sub-pixel overhang", () => {
		expect(isFullyVisible({ top: 99.5, bottom: 500.4 }, VIEW, 1)).toBe(true);
	});
});

describe("revealDelta", () => {
	test("does nothing for a card already fully visible", () => {
		expect(revealDelta({ top: 200, bottom: 300 }, VIEW, { top: 210, bottom: 230 })).toBe(0);
	});

	test("scrolls down just enough for a card clipped at the bottom", () => {
		// Bottom at 620 must land at 488 (500 - 12): scroll 132.
		expect(revealDelta({ top: 520, bottom: 620 }, VIEW, null)).toBe(132);
	});

	test("scrolls up just enough for a card above the viewport", () => {
		// Top at 20 must land at 112: scroll -92.
		expect(revealDelta({ top: 20, bottom: 80 }, VIEW, null)).toBe(-92);
	});

	test("keeps the hovered text on screen when both can fit", () => {
		// The card needs at least 132 down; an anchor at 300..320 tolerates up to
		// 188 of upward travel, so 132 satisfies both.
		expect(revealDelta({ top: 520, bottom: 620 }, VIEW, { top: 300, bottom: 320 })).toBe(132);
	});

	test("shows the whole card even when that scrolls the hovered text away", () => {
		// An anchor at 200..220 tolerates only 88; the card's 132 wins.
		expect(revealDelta({ top: 520, bottom: 620 }, VIEW, { top: 200, bottom: 220 })).toBe(132);
	});

	test("prefers the anchor-compatible delta when the card allows a range", () => {
		// Card 450..480 needs at least -8 (already visible: lo = -8, hi = 338) → 0.
		expect(revealDelta({ top: 450, bottom: 480 }, VIEW, { top: 120, bottom: 140 })).toBe(0);
	});

	test("aligns the top of a card taller than the viewport", () => {
		expect(revealDelta({ top: 600, bottom: 1200 }, VIEW, null)).toBe(488);
	});
});

describe("centeredScrollTop", () => {
	test("moves upward to center a block above the viewport", () => {
		expect(centeredScrollTop(300, 40, 400, 2000)).toBe(120);
	});

	test("moves downward to center a block below the viewport", () => {
		expect(centeredScrollTop(1300, 40, 400, 2000)).toBe(1120);
	});

	test("clamps at the beginning and end of the document", () => {
		expect(centeredScrollTop(20, 40, 400, 2000)).toBe(0);
		expect(centeredScrollTop(1950, 40, 400, 2000)).toBe(1600);
	});
});
