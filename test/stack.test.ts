import { describe, expect, test } from "vitest";
import { stackTops } from "../src/ui/stack";

describe("stackTops", () => {
	test("returns tops in the original input order", () => {
		const tops = stackTops(
			[
				{ top: 200, height: 40 },
				{ top: 0, height: 40 },
			],
			8,
		);
		expect(tops).toEqual([200, 0]);
	});

	test("pushes an overlapping card down past the previous one plus the gap", () => {
		// Second card wants top 30 but the first occupies 0..40; it gets 40 + gap.
		expect(
			stackTops(
				[
					{ top: 0, height: 40 },
					{ top: 30, height: 20 },
				],
				8,
			),
		).toEqual([0, 48]);
	});

	test("keeps a card whose anchor scrolled above the viewport at its negative top", () => {
		// First floor is -Infinity, so the top card keeps its negative anchor top.
		const tops = stackTops(
			[
				{ top: -100, height: 40 },
				{ top: -50, height: 40 },
			],
			8,
		);
		expect(tops[0]).toBe(-100);
		expect(tops[1]).toBe(-50); // -50 already clears -100 + 40 + 8 = -52
	});

	test("stacks in anchor order regardless of input order", () => {
		const tops = stackTops(
			[
				{ top: 100, height: 40 },
				{ top: 0, height: 40 },
				{ top: 50, height: 40 },
			],
			8,
		);
		// sorted anchors 0, 50, 100 → 0, 50, 100 (none overlaps the previous + gap)
		expect(tops).toEqual([100, 0, 50]);
	});
});

describe("stackTops with a pivot", () => {
	// Four cards anchored close together; plain stacking pushes the later ones far down.
	const crowded = [
		{ top: 0, height: 100 },
		{ top: 10, height: 100 },
		{ top: 20, height: 100 },
		{ top: 30, height: 100 },
	];

	test("plain stacking displaces every card after the first", () => {
		expect(stackTops(crowded, 8)).toEqual([0, 108, 216, 324]);
	});

	test("the pivot sits at its own anchor and later cards stack below it", () => {
		const tops = stackTops(crowded, 8, 2);
		expect(tops[2]).toBe(20);
		expect(tops[3]).toBe(128);
	});

	test("earlier cards are pushed up out of the pivot's way, cascading", () => {
		const tops = stackTops(crowded, 8, 2);
		// Card 1 must end above 20 - 8 = 12: top -88. Card 0 above that: -196.
		expect(tops[1]).toBe(-88);
		expect(tops[0]).toBe(-196);
	});

	test("a pivot the plain stack would not have displaced changes nothing", () => {
		const spread = [
			{ top: 0, height: 40 },
			{ top: 100, height: 40 },
			{ top: 200, height: 40 },
		];
		expect(stackTops(spread, 8, 1)).toEqual(stackTops(spread, 8));
	});

	test("earlier cards that already fit above the pivot keep their own tops", () => {
		const tops = stackTops(
			[
				{ top: 0, height: 40 },
				{ top: 50, height: 40 },
				{ top: 100, height: 40 },
			],
			8,
			2,
		);
		expect(tops).toEqual([0, 50, 100]);
	});

	test("only the earlier cards that collide move, and they cascade upward", () => {
		const tops = stackTops(
			[
				{ top: 0, height: 40 },
				{ top: 60, height: 40 },
				{ top: 70, height: 40 },
			],
			8,
			2,
		);
		// Card 1 must end above 70 - 8: top 22. Card 0 (0..40) then overlaps it: -26.
		expect(tops).toEqual([-26, 22, 70]);
	});

	test("ignores a pivot index that is out of range", () => {
		expect(stackTops(crowded, 8, 9)).toEqual(stackTops(crowded, 8));
	});
});
