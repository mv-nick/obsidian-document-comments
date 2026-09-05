// Suggestions: a comment whose first body line `=>: text` proposes replacing the
// anchored range with `text`. Insert = empty anchor, delete = empty proposal.
import { describe, expect, it } from "vitest";
import { anchorRange, isSuggestion, parseComments, suggestionKind } from "../src/format/parse";
import { PROPOSAL_AUTHOR, serializeBody } from "../src/format/serialize";
import {
	applyChanges,
	computeAcceptSuggestion,
	computeAddComment,
	computeAddSuggestion,
	computeAppendReply,
	computeRejectSuggestion,
	computeResolveAllSuggestions,
	computeSetProposal,
	computeToggleReaction,
} from "../src/editor/edits";

const DOC = "We should ship on Friday regardless of the QA timeline.\n\nNext paragraph.\n";
const FROM = DOC.indexOf("ship on Friday");
const TO = FROM + "ship on Friday".length;
const INPUT = { id: "s1", createdAt: "2026-09-05T10:00:00.000Z", author: "nick" };

const suggest = (doc: string, from: number, to: number, proposal: string, text?: string): string =>
	applyChanges(doc, computeAddSuggestion(doc, from, to, { ...INPUT, proposal, text }).unwrap());

describe("suggestion format", () => {
	it("serializes the proposal as the first body line by the reserved author", () => {
		const body = serializeBody("s1", {
			author: "nick",
			status: "open",
			quote: "ship on Friday",
			proposal: "ship on Thursday",
			thread: [{ author: "nick", timestamp: "t", text: "QA needs the day." }],
			reactions: [{ emoji: "👍", authors: ["jesse"] }],
		});
		expect(body).toBe(
			[
				'<!--co:s1 by:nick status:open quote:"ship on Friday"',
				`${PROPOSAL_AUTHOR}: ship on Thursday`,
				"nick (t): QA needs the day.",
				"+@1 👍 jesse",
				"-->",
			].join("\n"),
		);
	});

	it("round-trips proposal, thread and reaction indices", () => {
		const doc =
			"We should <!--c:s1-->ship on Friday<!--/c:s1--> regardless.\n" +
			serializeBody("s1", {
				status: "open",
				proposal: "ship on Thursday",
				thread: [
					{ author: "nick", text: "first" },
					{ author: "jesse", text: "second" },
				],
				reactions: [
					{ emoji: "👍", authors: ["a"] },
					{ emoji: "🎉", authors: ["b"], entry: 1 },
				],
			});
		const [c] = parseComments(doc);
		expect(isSuggestion(c)).toBe(true);
		expect(c.proposal).toBe("ship on Thursday");
		expect(c.thread.map((e) => e.text)).toEqual(["first", "second"]);
		expect(c.reactions).toEqual([
			{ emoji: "👍", authors: ["a"] },
			{ emoji: "🎉", authors: ["b"], entry: 1 },
		]);
		expect(suggestionKind(c)).toBe("replace");
		// Re-serializing reproduces the raw indices (@1, @2) exactly.
		const again = serializeBody("s1", {
			status: c.status,
			proposal: c.proposal,
			thread: c.thread,
			reactions: c.reactions,
		});
		expect(again).toContain("\n+@1 👍 a\n+@2 🎉 b\n");
	});

	it("reads an empty proposal as a deletion and an empty anchor as an insertion", () => {
		const del = "a <!--c:d1-->gone<!--/c:d1--> b\n<!--co:d1 status:open\n=>: \n-->";
		expect(suggestionKind(parseComments(del)[0])).toBe("delete");
		const delTrimmed = "a <!--c:d1-->gone<!--/c:d1--> b\n<!--co:d1 status:open\n=>:\n-->";
		expect(parseComments(delTrimmed)[0].proposal).toBe("");
		const ins = "a <!--c:i1--><!--/c:i1--> b\n<!--co:i1 status:open\n=>: new words\n-->";
		const [c] = parseComments(ins);
		expect(suggestionKind(c)).toBe("insert");
		expect(anchorRange(c)).toEqual({ from: c.open!.to, to: c.close!.from });
	});

	it("only treats a first-position => line as the proposal", () => {
		const doc = "<!--co:p1 status:open\nnick: note\n=>: later\n-->";
		const [c] = parseComments(doc);
		expect(isSuggestion(c)).toBe(false);
		expect(c.thread.map((e) => e.author)).toEqual(["nick", "=>"]);
	});

	it("a plain comment has no proposal and no kind", () => {
		const doc = "<!--c:k1-->x<!--/c:k1-->\n<!--co:k1 status:open\nnick: hi\n-->";
		const [c] = parseComments(doc);
		expect(isSuggestion(c)).toBe(false);
		expect(suggestionKind(c)).toBeNull();
	});
});

describe("computeAddSuggestion", () => {
	it("anchors a replacement and records the proposal", () => {
		const out = suggest(DOC, FROM, TO, "ship on Thursday", "QA needs the day.");
		expect(out).toContain("<!--c:s1-->ship on Friday<!--/c:s1-->");
		expect(out).toContain(
			'QA timeline.\n<!--co:s1 by:nick at:2026-09-05T10:00:00.000Z status:open quote:"ship on Friday"\n=>: ship on Thursday\nnick (2026-09-05T10:00:00.000Z): QA needs the day.\n-->',
		);
		const [c] = parseComments(out);
		expect(suggestionKind(c)).toBe("replace");
	});

	it("anchors an insertion at a point with an empty marker pair", () => {
		const at = DOC.indexOf(" regardless");
		const out = suggest(DOC, at, at, ", not Thursday,");
		expect(out).toContain("ship on Friday<!--c:s1--><!--/c:s1--> regardless");
		expect(suggestionKind(parseComments(out)[0])).toBe("insert");
		expect(parseComments(out)[0].quote).toBeUndefined();
	});

	it("records a deletion as an empty proposal", () => {
		const out = suggest(DOC, FROM, TO, "");
		expect(out).toContain("\n=>: \n");
		expect(suggestionKind(parseComments(out)[0])).toBe("delete");
	});

	it("refuses an empty insertion, code blocks, frontmatter and overlapping suggestions", () => {
		expect(computeAddSuggestion(DOC, FROM, FROM, { ...INPUT, proposal: "" }).isErr()).toBe(true);
		const fenced = "```\ncode here\n```\n";
		expect(computeAddSuggestion(fenced, 4, 8, { ...INPUT, proposal: "x" }).isErr()).toBe(true);
		const fm = "---\ntitle: T\n---\nBody.";
		expect(computeAddSuggestion(fm, 11, 12, { ...INPUT, proposal: "x" }).isErr()).toBe(true);
		const first = suggest(DOC, FROM, TO, "Thursday");
		const inside = first.indexOf("on Friday");
		const overlap = computeAddSuggestion(first, inside, inside + 2, { ...INPUT, id: "s2", proposal: "at" });
		expect(overlap.isErr()).toBe(true);
		const point = first.indexOf("Friday") + 2;
		expect(computeAddSuggestion(first, point, point, { ...INPUT, id: "s3", proposal: "x" }).isErr()).toBe(true);
		// A suggestion elsewhere in the note is fine.
		const elsewhere = first.indexOf("Next");
		expect(
			computeAddSuggestion(first, elsewhere, elsewhere + 4, { ...INPUT, id: "s4", proposal: "Following" }).isOk(),
		).toBe(true);
	});

	it("still allows a plain comment on suggested text", () => {
		const first = suggest(DOC, FROM, TO, "Thursday");
		const inside = first.indexOf("on Friday");
		const result = computeAddComment(first, inside, inside + 2, {
			id: "c1",
			createdAt: "t",
			author: "me",
			text: "why?",
		});
		expect(result.isOk()).toBe(true);
	});
});

describe("accept / reject", () => {
	it("accepting a replacement swaps the text and removes markers and body", () => {
		const doc = suggest(DOC, FROM, TO, "ship on Thursday", "QA needs the day.");
		const out = applyChanges(doc, computeAcceptSuggestion(doc, "s1").unwrap());
		expect(out).toBe("We should ship on Thursday regardless of the QA timeline.\n\nNext paragraph.\n");
	});

	it("accepting an insertion inserts the proposal", () => {
		const at = DOC.indexOf(" regardless");
		const doc = suggest(DOC, at, at, ", not Thursday,");
		const out = applyChanges(doc, computeAcceptSuggestion(doc, "s1").unwrap());
		expect(out).toBe("We should ship on Friday, not Thursday, regardless of the QA timeline.\n\nNext paragraph.\n");
	});

	it("accepting a deletion removes the text", () => {
		const doc = suggest(DOC, FROM - 1, TO, "");
		const out = applyChanges(doc, computeAcceptSuggestion(doc, "s1").unwrap());
		expect(out).toBe("We should regardless of the QA timeline.\n\nNext paragraph.\n");
	});

	it("accepting keeps a multi-line proposal's line breaks", () => {
		const doc = suggest(DOC, FROM, TO, "ship on Thursday.\n\nThen rest");
		expect(doc).toContain("=>: ship on Thursday.\\n\\nThen rest");
		const out = applyChanges(doc, computeAcceptSuggestion(doc, "s1").unwrap());
		expect(out.startsWith("We should ship on Thursday.\n\nThen rest regardless")).toBe(true);
	});

	it("rejecting leaves the text as it was and removes the suggestion", () => {
		const doc = suggest(DOC, FROM, TO, "ship on Thursday", "note");
		const out = applyChanges(doc, computeRejectSuggestion(doc, "s1").unwrap());
		expect(out).toBe(DOC);
	});

	it("a comment nested inside an accepted range survives as an orphan with its thread", () => {
		const withSuggestion = suggest(DOC, FROM, TO, "ship on Thursday");
		const inner = withSuggestion.indexOf("Friday");
		const both = applyChanges(
			withSuggestion,
			computeAddComment(withSuggestion, inner, inner + 6, {
				id: "c1",
				createdAt: "t",
				author: "me",
				text: "keep me",
			}).unwrap(),
		);
		const out = applyChanges(both, computeAcceptSuggestion(both, "s1").unwrap());
		expect(out).toContain("We should ship on Thursday regardless");
		const c1 = parseComments(out).find((c) => c.id === "c1")!;
		expect(c1.thread[0].text).toBe("keep me");
		expect(anchorRange(c1)).toBeNull();
	});

	it("refuses to accept or reject a plain comment, and to accept a malformed or unanchored suggestion", () => {
		const plain = applyChanges(
			DOC,
			computeAddComment(DOC, FROM, TO, { id: "c1", createdAt: "t", author: "me", text: "x" }).unwrap(),
		);
		expect(computeAcceptSuggestion(plain, "c1").isErr()).toBe(true);
		expect(computeRejectSuggestion(plain, "c1").isErr()).toBe(true);
		const orphan = "Prose only.\n<!--co:s9 status:open\n=>: new\n-->";
		expect(computeAcceptSuggestion(orphan, "s9").isErr()).toBe(true);
		expect(computeRejectSuggestion(orphan, "s9").isOk()).toBe(true);
		const malformed = "a <!--c:m1-->b<!--/c:m1--> c\n<!--co:m1 status:open\n=>: x --> y\n-->";
		expect(computeAcceptSuggestion(malformed, "m1").isErr()).toBe(true);
	});

	it("edits the proposal in place and threads replies after it", () => {
		const doc = suggest(DOC, FROM, TO, "ship on Thursday");
		const edited = applyChanges(doc, computeSetProposal(doc, "s1", "ship on Monday").unwrap());
		const replied = applyChanges(
			edited,
			computeAppendReply(edited, "s1", { createdAt: "t", author: "jesse", text: "Monday works" }).unwrap(),
		);
		const reacted = applyChanges(
			replied,
			computeToggleReaction({ doc: replied, id: "s1", entry: 0, emoji: "👍", author: "nick" }).unwrap(),
		);
		const [c] = parseComments(reacted);
		expect(c.proposal).toBe("ship on Monday");
		expect(c.thread).toEqual([{ author: "jesse", timestamp: "t", text: "Monday works" }]);
		expect(c.reactions).toEqual([{ emoji: "👍", authors: ["nick"] }]);
		expect(reacted).toContain("\n+@1 👍 nick\n");
	});

	it("accepts or rejects every suggestion in one change set", () => {
		const one = suggest(DOC, FROM, TO, "ship on Thursday");
		const next = one.indexOf("Next");
		const two = applyChanges(
			one,
			computeAddSuggestion(one, next, next + 4, { ...INPUT, id: "s2", proposal: "Following" }).unwrap(),
		);
		const accepted = applyChanges(two, computeResolveAllSuggestions(two, "accept").unwrap());
		expect(accepted).toBe("We should ship on Thursday regardless of the QA timeline.\n\nFollowing paragraph.\n");
		const rejected = applyChanges(two, computeResolveAllSuggestions(two, "reject").unwrap());
		expect(rejected).toBe(DOC);
		expect(computeResolveAllSuggestions(DOC, "accept").isErr()).toBe(true);
	});
});
