// @vitest-environment happy-dom
//
// Reading view has no editor offsets, so "Add comment" maps the rendered selection
// back to source by text. The mapping must never land inside an HTML comment (a
// phrase quoted in another comment's thread), and must pick the occurrence the
// user actually selected when a block repeats a phrase.
import { describe, expect, test } from "vitest";
import type { MarkdownPostProcessorContext } from "obsidian";
import { findSectionRange, highlightPostProcessor, mapReadingSelection } from "../src/reading/highlight";

Node.prototype.createSpan ??= function (o?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
	const el = document.createElement("span");
	if (typeof o === "string") {
		el.className = o;
	} else if (o) {
		if (o.cls) el.className = o.cls;
		if (o.text) el.textContent = o.text;
		for (const [key, value] of Object.entries(o.attr ?? {})) el.setAttribute(key, value);
	}
	this.appendChild(el);
	return el;
};

Node.prototype.detach ??= function () {
	this.parentNode?.removeChild(this);
};

const ctxFor = (text: string, lineStart: number, lineEnd: number): MarkdownPostProcessorContext =>
	({
		getSectionInfo: () => ({ text, lineStart, lineEnd }),
		sourcePath: "note.md",
	}) as unknown as MarkdownPostProcessorContext;

const selectIn = (node: Text, phrase: string, occurrence = 0): Selection => {
	let start = -1;
	for (let i = 0; i <= occurrence; i++) start = node.data.indexOf(phrase, start + 1);
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, start + phrase.length);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
};

describe("reading-view selection mapping", () => {
	test("never anchors into a comment body that quotes the same phrase", () => {
		const doc = [
			"<!--c:aa-->First<!--/c:aa-->",
			'<!--co:aa status:open quote:"First"',
			"nick: the deadline slipped",
			"-->",
			"We should discuss whether the deadline slipped.",
		].join("\n");
		const el = document.createElement("div");
		el.textContent = "First We should discuss whether the deadline slipped.";
		document.body.appendChild(el);
		// One section spanning every line, so the body text is a candidate too.
		highlightPostProcessor(el, ctxFor(doc, 0, 4));
		const section = findSectionRange(el)!;
		const textNode = [...el.childNodes].find(
			(n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes("deadline"),
		) as Text;
		const selection = selectIn(textNode, "the deadline slipped");

		const mapped = mapReadingSelection(selection, section, doc)!;
		expect(doc.slice(mapped.from, mapped.to)).toBe("the deadline slipped");
		expect(mapped.from).toBeGreaterThan(doc.indexOf("We should"));
		selection.removeAllRanges();
		el.remove();
	});

	test("picks the occurrence the user selected when a block repeats a phrase", () => {
		const doc = "We ship on Friday, or ship on Friday next week.";
		const el = document.createElement("p");
		el.textContent = doc;
		document.body.appendChild(el);
		highlightPostProcessor(el, ctxFor(doc, 0, 0));
		const section = findSectionRange(el)!;
		const selection = selectIn(el.firstChild as Text, "ship on Friday", 1);

		const mapped = mapReadingSelection(selection, section, doc)!;
		expect(mapped.from).toBe(doc.lastIndexOf("ship on Friday"));
		expect(doc.slice(mapped.from, mapped.to)).toBe("ship on Friday");
		selection.removeAllRanges();
		el.remove();
	});

	test("refuses when the selected text exists only inside a comment", () => {
		const doc = ['<!--co:aa status:open quote:"First"', "nick: only here", "-->", "Visible prose."].join("\n");
		const el = document.createElement("div");
		el.textContent = "only here Visible prose.";
		document.body.appendChild(el);
		highlightPostProcessor(el, ctxFor(doc, 0, 3));
		const section = findSectionRange(el)!;
		const selection = selectIn(el.firstChild as Text, "only here");

		expect(mapReadingSelection(selection, section, doc)).toBeNull();
		selection.removeAllRanges();
		el.remove();
	});
});
