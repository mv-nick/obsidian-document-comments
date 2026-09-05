// @vitest-environment happy-dom
//
// Reading view renders a suggestion as the struck-through anchored text followed
// by the proposal in a `.dc-proposal` span.
import { describe, expect, test } from "vitest";
import type { MarkdownPostProcessorContext } from "obsidian";
import { highlightPostProcessor } from "../src/reading/highlight";

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

describe("reading-view suggestions", () => {
	test("replacement: struck-through text followed by the proposal", () => {
		const doc = [
			"We should <!--c:s1-->ship on Friday<!--/c:s1--> regardless.",
			'<!--co:s1 by:nick status:open quote:"ship on Friday"',
			"=>: ship on Thursday",
			"-->",
		].join("\n");
		const p = document.createElement("p");
		p.textContent = "We should ship on Friday regardless.";
		highlightPostProcessor(p, ctxFor(doc, 0, 0));
		const span = p.querySelector<HTMLElement>(".doc-comment-span[data-cid='s1']")!;
		expect(span.classList.contains("is-suggestion")).toBe(true);
		expect(span.textContent).toBe("ship on Friday");
		const proposal = span.nextElementSibling as HTMLElement;
		expect(proposal.classList.contains("dc-proposal")).toBe(true);
		expect(proposal.textContent).toBe("ship on Thursday");
		expect(proposal.getAttribute("data-cid")).toBe("s1");
		expect(p.textContent).toBe("We should ship on Fridayship on Thursday regardless.");
	});

	test("deletion: struck-through text and nothing after it", () => {
		const doc = [
			"Remove <!--c:d1-->this<!--/c:d1--> please.",
			'<!--co:d1 status:open quote:"this"',
			"=>: ",
			"-->",
		].join("\n");
		const p = document.createElement("p");
		p.textContent = "Remove this please.";
		highlightPostProcessor(p, ctxFor(doc, 0, 0));
		const span = p.querySelector<HTMLElement>(".doc-comment-span[data-cid='d1']")!;
		expect(span.classList.contains("is-suggestion")).toBe(true);
		expect(p.querySelector(".dc-proposal")).toBeNull();
	});

	test("a plain comment is not marked as a suggestion", () => {
		const doc = [
			"Ship <!--c:c1-->Friday<!--/c:c1-->.",
			'<!--co:c1 status:open quote:"Friday"',
			"me: ok",
			"-->",
		].join("\n");
		const p = document.createElement("p");
		p.textContent = "Ship Friday.";
		highlightPostProcessor(p, ctxFor(doc, 0, 0));
		expect(p.querySelector(".doc-comment-span")?.classList.contains("is-suggestion")).toBe(false);
		expect(p.querySelector(".dc-proposal")).toBeNull();
	});
});
