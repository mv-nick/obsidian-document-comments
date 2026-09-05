// Integrity and robustness guarantees added in the fork: malformed body blocks are
// detected and refused by every rewrite path, the parser stays linear on hostile
// input, the thread-line grammar rejects prose, and the delete sweep respects the
// same code masks the parser does.
import { describe, expect, it } from "vitest";
import {
	allBodyRanges,
	existingIds,
	fencedRanges,
	frontmatterRange,
	isMarkerOnly,
	isUneditable,
	parseComments,
	parseThreadLine,
} from "../src/format/parse";
import { serializeBody } from "../src/format/serialize";
import {
	applyChanges,
	computeAddComment,
	computeAppendReply,
	computeDeleteComment,
	computeDeleteEntry,
	computeEditEntry,
	computeSetResolved,
} from "../src/editor/edits";
import { ensureAuthorColor, readAuthorColor } from "../src/author-colors";

const ZWSP = "​";
const ENTRY = { createdAt: "2026-09-05T10:00:00.000Z", author: "me", text: "hi" };

const timed = (fn: () => void): number => {
	const start = performance.now();
	fn();
	return performance.now() - start;
};

describe("malformed body blocks", () => {
	const truncated = [
		"Intro <!--c:x1-->text<!--/c:x1--> here.",
		'<!--co:x1 by:anthony status:open quote:"text"',
		"anthony: functions from (a, b) --> (c, d) are incentivized",
		"lukas: agreed",
		"-->",
		"",
		"Later prose.",
	].join("\n");

	it("flags a block ended early by a --> typed in its text and refuses every rewrite", () => {
		const [c] = parseComments(truncated);
		expect(c.malformed).toBe("terminator-in-text");
		expect(isUneditable(c)).toBe(true);
		expect(computeDeleteComment(truncated, "x1").isErr()).toBe(true);
		expect(computeSetResolved(truncated, "x1", true).isErr()).toBe(true);
		expect(computeAppendReply(truncated, "x1", ENTRY).isErr()).toBe(true);
		expect(computeEditEntry(truncated, "x1", 0, "x").isErr()).toBe(true);
	});

	it("reads the same block whole once the arrow is broken with a zero-width space", () => {
		const repaired = truncated.replace("(a, b) --> (c, d)", `(a, b) --${ZWSP}> (c, d)`);
		const [c] = parseComments(repaired);
		expect(c.malformed).toBeUndefined();
		expect(c.thread.map((e) => e.author)).toEqual(["anthony", "lukas"]);
		expect(computeSetResolved(repaired, "x1", true).isOk()).toBe(true);
	});

	it("flags a block with no terminator that runs into a later comment, and deletes nothing", () => {
		const doc = [
			"<!--c:aaa-->First anchored sentence.<!--/c:aaa-->",
			'<!--co:aaa by:alice status:open quote:"First anchored sentence."',
			"alice: nice",
			"",
			"## Section that must not be lost",
			"",
			"Paragraph of important prose the user wrote. Budget is $250k.",
			"",
			"<!--co:bbb by:bob status:open",
			"bob: also nice",
			"-->",
		].join("\n");
		const aaa = parseComments(doc).find((c) => c.id === "aaa")!;
		expect(aaa.malformed).toBe("overrun");
		expect(computeDeleteComment(doc, "aaa").isErr()).toBe(true);
		expect(computeSetResolved(doc, "aaa", true).isErr()).toBe(true);
		// The later, well-formed comment is unaffected.
		const bbb = parseComments(doc).find((c) => c.id === "bbb")!;
		expect(bbb.malformed).toBeUndefined();
		expect(computeDeleteComment(doc, "bbb").isOk()).toBe(true);
	});

	it("flags a block whose missing terminator is supplied by another comment's anchor marker", () => {
		const doc = [
			'<!--co:aaa by:alice status:open quote:"x"',
			"alice: nice",
			"",
			"Prose that must survive.",
			"",
			"<!--c:bbb-->Second<!--/c:bbb-->",
			'<!--co:bbb by:bob status:open quote:"Second"',
			"bob: hi",
			"-->",
		].join("\n");
		const aaa = parseComments(doc).find((c) => c.id === "aaa")!;
		expect(aaa.malformed).toBe("terminator-in-text");
		expect(computeDeleteComment(doc, "aaa").isErr()).toBe(true);
	});

	it("reads a quote that copied nested markers tolerantly, flags it, and repairs it on rewrite", () => {
		const doc = [
			"To <!--c:m1-->roughly<!--/c:m1--> summarize, Bob chooses.",
			'<!--co:z1 by:anthony status:open quote:"To <!--c:m1-->roughly<!--/c:m1--> summarize"',
			"anthony: following up",
			"-->",
			'<!--co:m1 by:anthony status:open quote:"roughly"',
			"anthony: don't overuse",
			"-->",
		].join("\n");
		const z1 = parseComments(doc).find((c) => c.id === "z1")!;
		expect(z1.malformed).toBe("terminator-in-header");
		expect(isUneditable(z1)).toBe(false);
		expect(z1.thread).toHaveLength(1);
		expect(z1.thread[0].text).toBe("following up");
		const resolved = computeSetResolved(doc, "z1", true).unwrap();
		const next = applyChanges(doc, resolved);
		const after = parseComments(next).find((c) => c.id === "z1")!;
		expect(after.malformed).toBeUndefined();
		expect(after.status).toBe("resolved");
		expect(after.quote).toContain(`--${ZWSP}>`);
		expect(parseComments(next).find((c) => c.id === "m1")!.thread[0].text).toBe("don't overuse");
	});

	it("deletes a header-leaking block whole, using the parsed range rather than the first -->", () => {
		const doc = [
			"Some <!--c:q1-->text<!--/c:q1--> here.",
			'<!--co:q1 by:nick status:open quote:"text<!--/c:zz-->"',
			"nick: reply that must go too",
			"-->",
			"",
			"Kept paragraph.",
		].join("\n");
		const out = applyChanges(doc, computeDeleteComment(doc, "q1").unwrap());
		expect(out).toBe("Some text here.\n\nKept paragraph.");
	});

	it("reports an unterminated block without hiding or editing anything", () => {
		const doc = 'Text.\n<!--co:u1 by:a status:open quote:"x"\na: hi';
		const [c] = parseComments(doc);
		expect(c.malformed).toBe("unterminated");
		expect(c.body).toBeNull();
		expect(c.author).toBe("a");
		expect(computeDeleteComment(doc, "u1").isErr()).toBe(true);
	});

	it("accepts a single-line empty body", () => {
		const doc = "Some <!--c:s1-->text<!--/c:s1--> here.\n<!--co:s1 status:open-->\n";
		const [c] = parseComments(doc);
		expect(c.malformed).toBeUndefined();
		expect(c.body).toEqual({ from: doc.indexOf("<!--co:s1"), to: doc.indexOf("-->\n") + 3 });
		expect(c.thread).toEqual([]);
	});

	it("allows trailing spaces before a terminator on its own line", () => {
		const doc = "<!--co:t1 status:open\nme: hi\n   -->";
		expect(parseComments(doc)[0].malformed).toBeUndefined();
	});
});

describe("parse time stays linear on hostile input", () => {
	// Generous for slow CI machines; the pre-fix parser took seconds to minutes here.
	const budgetMs = 150;

	it("a trailing unterminated opener followed by 8 KB of spaces", () => {
		const doc = "ok <!--c:a-->x<!--/c:a-->\n<!--co:a status:open\na: hi\n-->\n\n<!--co:zz" + " ".repeat(8000);
		expect(timed(() => parseComments(doc))).toBeLessThan(budgetMs);
	});

	it("a header that is one 128 KB token", () => {
		const doc = "<!--co:aa " + "a".repeat(128000) + "\nalice: hi\n-->";
		expect(timed(() => parseComments(doc))).toBeLessThan(budgetMs);
	});

	it("a thread line of 128 KB of unclosed parens", () => {
		const doc = "<!--co:aa status:open\n" + " (".repeat(64000) + "\n-->";
		expect(timed(() => parseComments(doc))).toBeLessThan(budgetMs);
	});

	it("16,000 openers with no terminator anywhere", () => {
		const doc = "<!--co:aa \n".repeat(16000);
		expect(timed(() => parseComments(doc))).toBeLessThan(budgetMs);
	});

	it("a 3 KB body opener holding a long URL, the shape that hung the bundled validator", () => {
		const doc =
			"<!--c:a-->x<!--/c:a-->\n<!--co:a status:open\na: hi\n-->\n\n<!--co:https://example.com/" +
			"b".repeat(3000);
		expect(timed(() => parseComments(doc))).toBeLessThan(budgetMs);
	});
});

describe("thread-line grammar", () => {
	it("accepts the shapes the serializer writes", () => {
		expect(parseThreadLine("nick (2026-02-06T17:05:35Z): (*My most important comment:*)")).toEqual({
			author: "nick",
			timestamp: "2026-02-06T17:05:35Z",
			text: "(*My most important comment:*)",
		});
		expect(parseThreadLine("kyle: I thought we agreed Thursday?")).toEqual({
			author: "kyle",
			timestamp: undefined,
			text: "I thought we agreed Thursday?",
		});
		expect(parseThreadLine("=>: ship on Thursday")).toEqual({
			author: "=>",
			timestamp: undefined,
			text: "ship on Thursday",
		});
		expect(parseThreadLine("=>: ")).toEqual({ author: "=>", timestamp: undefined, text: "" });
		expect(parseThreadLine("=>:")).toEqual({ author: "=>", timestamp: undefined, text: "" });
	});

	it("still reads legacy multi-word authors", () => {
		expect(parseThreadLine("Kyle McDonald (2026-01-01T00:00:00Z): hi")).toEqual({
			author: "Kyle McDonald",
			timestamp: "2026-01-01T00:00:00Z",
			text: "hi",
		});
		expect(parseThreadLine("Kyle McDonald: hi")?.author).toBe("Kyle McDonald");
	});

	it("treats prose with a colon in it as continuation, not as an author", () => {
		for (const line of [
			"11:11 Today: pasted from a Google Doc",
			"http://example.com/x: see this",
			"12:34: timestamp-looking author",
			"    FWIW, I tend to think discussions about SPI will generally be a lot clearer if we:",
			"But I assume what's going on is that you think about it differently: right?",
			"nick:text without the separating space",
			": no author",
		]) {
			expect(parseThreadLine(line), line).toBeNull();
		}
	});

	it("folds prose continuation lines into the previous entry instead of minting authors", () => {
		const doc = [
			"<!--co:f1 by:anthony status:open",
			"anthony: My most important comment:",
			"    FWIW, discussions will be clearer if we:",
			"    - taboo default, and",
			"lukas (2026-02-06T19:08:13Z): Trying to expand:",
			"-->",
		].join("\n");
		const [c] = parseComments(doc);
		expect(c.thread.map((e) => e.author)).toEqual(["anthony", "lukas"]);
		expect(c.thread[0].text).toContain("- taboo default, and");
	});
});

describe("serializer normalization", () => {
	it("writes authors as single tokens so entries round-trip through the strict grammar", () => {
		const body = serializeBody("s1", {
			status: "open",
			thread: [{ author: "Kyle McDonald", timestamp: "2026-01-01T00:00:00Z", text: "hi" }],
			reactions: [],
		});
		expect(body).toContain("\nKyle_McDonald (2026-01-01T00:00:00Z): hi\n");
		expect(parseComments(body)[0].thread[0].author).toBe("Kyle_McDonald");
	});

	it("keeps a hostile reaction author from ending the block or forging a reply", () => {
		const body = serializeBody("r1", {
			status: "open",
			thread: [{ author: "a", text: "x" }],
			reactions: [{ emoji: "👍", authors: ["eve --> pwn", "mallory\nb: injected reply"] }],
		});
		expect(body.split("-->").length).toBe(2); // exactly one terminator, the real one
		expect(body).not.toContain("\nb: injected");
		const [c] = parseComments(body);
		expect(c.malformed).toBeUndefined();
		expect(c.thread).toHaveLength(1);
		expect(c.reactions[0].authors).toHaveLength(2);
	});
});

describe("code masks are honoured everywhere", () => {
	const doc = [
		"Live <!--c:zz1-->comment<!--/c:zz1--> here.",
		'<!--co:zz1 by:me status:open quote:"comment"',
		"me: hi",
		"-->",
		"",
		"```markdown",
		"Example: <!--c:zz1-->documented<!--/c:zz1-->",
		"<!--co:zz1 status:open",
		"me: example body",
		"-->",
		"```",
		"",
		"And inline `<!--c:zz1-->`.",
	].join("\n");

	it("deleting the live comment leaves the fenced and inline examples untouched", () => {
		const out = applyChanges(doc, computeDeleteComment(doc, "zz1").unwrap());
		expect(out).toContain("Example: <!--c:zz1-->documented<!--/c:zz1-->");
		expect(out).toContain("me: example body");
		expect(out).toContain("And inline `<!--c:zz1-->`.");
		expect(out).toContain("Live comment here.");
		expect(parseComments(out)).toHaveLength(0);
	});

	it("id generation avoids ids used only inside code", () => {
		const fenced = "```\n<!--c:abc-->x<!--/c:abc-->\n```\n";
		expect(parseComments(fenced)).toHaveLength(0);
		expect(existingIds(fenced).has("abc")).toBe(true);
	});

	it("body ranges for an id skip masked copies", () => {
		expect(allBodyRanges(doc, "zz1")).toHaveLength(1);
	});
});

describe("fences follow CommonMark closing rules", () => {
	it("a shorter or different-character fence does not close an opener", () => {
		const doc = "````\ncode\n```\nstill code\n~~~\nstill code\n````\nprose";
		expect(fencedRanges(doc)).toEqual([[0, doc.indexOf("\nprose")]]);
	});

	it("a closing fence with an info string does not close", () => {
		const doc = "```\ncode\n``` not-a-close\nstill code\n```\nprose";
		expect(fencedRanges(doc)).toEqual([[0, doc.indexOf("\nprose")]]);
	});
});

describe("edit-path guards", () => {
	const doc = "---\ntitle: My note\neph-note: 01ABC\n---\nBody text here.\n";

	it("refuses to anchor inside frontmatter", () => {
		expect(frontmatterRange(doc)).toEqual({ from: 0, to: doc.indexOf("\n---\n") + 4 });
		const from = doc.indexOf("My note");
		const result = computeAddComment(doc, from, from + 7, { id: "n1", createdAt: "t", author: "me", text: "hi" });
		expect(result.isErr()).toBe(true);
		const ok = computeAddComment(doc, doc.indexOf("Body"), doc.indexOf("Body") + 4, {
			id: "n2",
			createdAt: "t",
			author: "me",
			text: "hi",
		});
		expect(ok.isOk()).toBe(true);
	});

	it("refuses out-of-range offsets instead of writing at the wrong place", () => {
		const input = { id: "n1", createdAt: "t", author: "me", text: "hi" };
		expect(computeAddComment("Short document.", -5, 3, input).isErr()).toBe(true);
		expect(computeAddComment("Short document.", 0, 9999, input).isErr()).toBe(true);
		expect(computeAddComment("Short document.", 1.5, 3, input).isErr()).toBe(true);
	});

	it("rejects NaN and fractional entry indices", () => {
		const commented = "a <!--c:e1-->b<!--/c:e1--> c\n<!--co:e1 status:open\nme: one\nme: two\n-->";
		expect(computeEditEntry(commented, "e1", NaN, "x").isErr()).toBe(true);
		expect(computeEditEntry(commented, "e1", 1.5, "x").isErr()).toBe(true);
		expect(computeDeleteEntry(commented, "e1", NaN).isErr()).toBe(true);
		expect(computeDeleteEntry(commented, "e1", 1).isOk()).toBe(true);
	});

	it("applyChanges throws on an out-of-range change rather than reordering text", () => {
		expect(() => applyChanges("Short document.", [{ from: -5, to: 3, insert: "" }])).toThrow(RangeError);
		expect(() => applyChanges("Short document.", [{ from: 0, to: 99, insert: "" }])).toThrow(RangeError);
	});

	it("gives a marker-only comment a body when someone replies, so the stray highlight becomes removable", () => {
		const markerOnly = "Some <!--c:m1-->text<!--/c:m1--> here.\n\nNext paragraph.\n";
		const [before] = parseComments(markerOnly);
		expect(isMarkerOnly(before)).toBe(true);
		const out = applyChanges(markerOnly, computeAppendReply(markerOnly, "m1", ENTRY).unwrap());
		const [after] = parseComments(out);
		expect(after.body).not.toBeNull();
		expect(after.thread).toHaveLength(1);
		expect(out).toContain("here.\n<!--co:m1");
		expect(computeDeleteComment(markerOnly, "m1").isOk()).toBe(true);
	});
});

describe("author names that are prototype properties", () => {
	it("get an own assignment and read back their color", () => {
		const assignments = {};
		const { created } = ensureAuthorColor(assignments, "__proto__");
		expect(created).toBe(true);
		expect(Object.getPrototypeOf(assignments)).toBe(Object.prototype);
		expect(readAuthorColor(assignments, new Set(), "__proto__", true)).toMatch(/^#[0-9a-f]{6}$/);
		expect(readAuthorColor({}, new Set(), "constructor", true)).toBeNull();
	});
});
