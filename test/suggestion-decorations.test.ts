// Live Preview rendering of suggestions: the anchored text carries the
// `is-suggestion` mark (struck through by the stylesheet) and the proposal is a
// widget placed right after it — or at the insertion point for an insertion.
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { commentField } from "../src/editor/state";
import { commentConfig } from "../src/editor/config";
import { anchorRange, parseComments } from "../src/format/parse";

type Deco = { from: number; to: number; cls?: string; widget: boolean; cid?: string };

const decorations = (doc: string): Deco[] => {
	const state = EditorState.create({
		doc,
		extensions: [
			commentConfig.of({
				author: () => "me",
				colorForAuthor: () => null,
				showComments: () => true,
				showResolved: () => true,
				allowEmptyComments: () => false,
				sidebarOpen: () => false,
			}),
			commentField,
		],
	});
	const out: Deco[] = [];
	const cursor = state.field(commentField).decorations.iter();
	while (cursor.value) {
		const spec = cursor.value.spec as { class?: string; widget?: object; attributes?: Record<string, string> };
		// Hidden markers are replace decorations that also carry a widget; only the
		// proposal is a point widget of the ProposalWidget class.
		const widgetName = spec.widget?.constructor?.name;
		out.push({
			from: cursor.from,
			to: cursor.to,
			cls: spec.class,
			widget: widgetName === "ProposalWidget",
			cid: spec.attributes?.["data-cid"],
		});
		cursor.next();
	}
	return out;
};

describe("suggestion decorations", () => {
	test("a replacement is marked as a suggestion and its proposal widget follows the text", () => {
		const doc = [
			"We should <!--c:s1-->ship on Friday<!--/c:s1--> regardless.",
			'<!--co:s1 by:nick status:open quote:"ship on Friday"',
			"=>: ship on Thursday",
			"-->",
		].join("\n");
		const range = anchorRange(parseComments(doc)[0])!;
		const decos = decorations(doc);
		const mark = decos.find((d) => d.cid === "s1" && d.cls?.includes("doc-comment-span"));
		expect(mark).toMatchObject({ from: range.from, to: range.to });
		expect(mark?.cls).toContain("is-suggestion");
		const widget = decos.find((d) => d.widget && d.from === range.to);
		expect(widget).toBeDefined();
	});

	test("a deletion is struck through with no proposal widget", () => {
		const doc = [
			"Remove <!--c:d1-->this<!--/c:d1--> please.",
			'<!--co:d1 status:open quote:"this"',
			"=>: ",
			"-->",
		].join("\n");
		const decos = decorations(doc);
		expect(decos.find((d) => d.cid === "d1")?.cls).toContain("is-suggestion");
		expect(decos.some((d) => d.widget && !d.cls)).toBe(false);
	});

	test("an insertion places the proposal widget at the empty anchor", () => {
		const doc = [
			"Ship Friday<!--c:i1--><!--/c:i1--> please.",
			"<!--co:i1 status:open",
			"=>: , not Thursday,",
			"-->",
		].join("\n");
		const c = parseComments(doc)[0];
		const point = anchorRange(c)!.from;
		const decos = decorations(doc);
		expect(decos.some((d) => d.widget && d.from === point && d.to === point)).toBe(true);
		// No mark for an empty range.
		expect(decos.some((d) => d.cid === "i1" && d.cls?.includes("doc-comment-span"))).toBe(false);
	});

	test("a plain comment gets neither the class nor a widget", () => {
		const doc = [
			"Ship <!--c:c1-->Friday<!--/c:c1-->.",
			'<!--co:c1 status:open quote:"Friday"',
			"me: ok",
			"-->",
		].join("\n");
		const decos = decorations(doc);
		expect(decos.find((d) => d.cid === "c1")?.cls).not.toContain("is-suggestion");
		expect(decos.some((d) => d.widget && !d.cls)).toBe(false);
	});
});
