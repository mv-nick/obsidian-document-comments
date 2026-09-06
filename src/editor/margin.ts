import { Notice, editorInfoField } from "obsidian";
import { Result } from "better-result";
import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";
import { ParsedComment } from "../format/types";
import { anchorRange, hasMarginAnchor } from "../format/parse";
import { isCodeComment, resolveCodeAnchor } from "../format/code-anchor";
import { commentField } from "./state";
import { commentConfig } from "./config";
import { Draft, clearDraft, draftField } from "./draft";
import { Card, CardCallbacks, CardView } from "../ui/card";
import { cardSignature } from "../ui/card-format";
import {
	acceptSuggestion,
	addComment,
	addSuggestion,
	appendReply,
	deleteComment,
	deleteEntry,
	editEntry,
	rejectSuggestion,
	setProposal,
	setResolved,
	toggleReaction,
} from "./commands";
import { closestSpanId, spanSelector } from "../util/css";
import { stackTops } from "../ui/stack";
import { revealDelta } from "../ui/scroll";
import { CARD_GAP, FLASH_MS } from "../ui/constants";
import { buildDraftComposer } from "../ui/draft-composer";
import { EmptySubmitAction } from "../ui/draft-behavior";

/** Editor-margin writes go through a live CodeMirror view (no I/O), so the only
 *  failure is a compute error — surface it as a notice rather than swallowing it. */
const notifyErr = <T>(result: Result<T, string>): Result<T, string> => {
	if (result.isErr()) new Notice(`Couldn't save the comment: ${result.error}`);
	return result;
};
/**
 * Renders the floating right-margin column: one card per comment, vertically
 * aligned to its anchor line, with a stacking pass so cards never overlap.
 */
class MarginView implements PluginValue {
	private container: HTMLElement;
	private cards = new Map<string, Card>();
	private activeId: string | null = null;
	private draftEl: HTMLElement | null = null;
	private setDraftEmptyAction: ((action: EmptySubmitAction) => void) | null = null;
	private draftFocused = false;
	private draftOutside: ((e: MouseEvent) => void) | null = null;
	private cb: CardCallbacks;
	private scrollHandler = () => this.requestReposition();
	private resizeObserver: ResizeObserver;
	private animFrames = 0;
	private animatingLoop = false;
	private destroyed = false;
	/** Last pointer position seen over the content, and the position at which we
	 *  last scrolled the editor to reveal a card (see pointerStale). */
	private pointer: { x: number; y: number } | null = null;
	private scrolledFor: { x: number; y: number } | null = null;
	/** The card the stack pivots around: the last one hovered or clicked. It stays
	 *  beside its text with the others pushed out of the way, and keeps that place
	 *  after the pointer leaves the text so it can be reached without it jumping. */
	private pivotId: string | null = null;

	constructor(private view: EditorView) {
		this.container = view.dom.createDiv("doc-comment-margin");
		// The container lives inside .cm-editor, so CodeMirror would otherwise
		// intercept clicks/keystrokes meant for our textareas and buttons. Stop
		// those events at the container so our inputs behave like normal inputs.
		const stop = (e: Event) => e.stopPropagation();
		for (const type of [
			"mousedown",
			"mouseup",
			"click",
			"dblclick",
			"keydown",
			"keyup",
			"input",
			"beforeinput",
			"paste",
			"cut",
			"contextmenu",
		]) {
			this.container.addEventListener(type, stop);
		}
		this.cb = {
			getAuthor: () => view.state.facet(commentConfig).author(),
			onHover: (id, active) => this.setActive(active ? id : null),
			onClickAnchor: (id) => this.flashAnchor(id),
			onResize: () => this.reposition(),
			animateLayout: () => this.animateLayout(),
			revealComposer: (id) => this.revealComposer(id),
			reply: (id, text) => notifyErr(appendReply(view, id, text, this.cb.getAuthor())),
			setResolved: (id, resolved) => notifyErr(setResolved(view, id, resolved)),
			remove: (id) => notifyErr(deleteComment(view, id)),
			editEntry: (id, index, text) => notifyErr(editEntry(view, id, index, text)),
			deleteEntry: (id, index) => notifyErr(deleteEntry(view, id, index)),
			toggleReaction: ({ id, entry, emoji }) =>
				notifyErr(toggleReaction({ view, id, entry, emoji, author: this.cb.getAuthor() })),
			openInSidebar: (id) => view.state.facet(commentConfig).openInSidebar?.(id),
			acceptSuggestion: (id) => notifyErr(acceptSuggestion(view, id)),
			rejectSuggestion: (id) => notifyErr(rejectSuggestion(view, id)),
			setProposal: (id, proposal) => notifyErr(setProposal(view, id, proposal)),
		};

		view.scrollDOM.addEventListener("scroll", this.scrollHandler, { passive: true });
		this.resizeObserver = new ResizeObserver(() => this.requestReposition());
		this.resizeObserver.observe(view.scrollDOM);
		view.contentDOM.addEventListener("mousedown", this.onContentMouseDown);
		view.contentDOM.addEventListener("mouseover", this.onContentMouseOver);
		view.contentDOM.addEventListener("mouseout", this.onContentMouseOut);

		this.reconcile();
		this.requestReposition();
	}

	update(): void {
		// Reconcile (pure DOM — safe during the update cycle), then schedule the
		// geometry-dependent reposition for the measure phase. coordsAtPos throws if
		// called during an update/construction, so positioning MUST go through
		// requestMeasure. The key also coalesces bursts into one measure per frame.
		this.syncDraftEl(this.view.state.field(draftField, false) ?? null);
		this.reconcile();
		this.requestReposition();
	}

	private requestReposition(): void {
		this.view.requestMeasure({ key: this, read: () => this.reposition() });
	}

	/** Drive the stacking for a few frames so neighbors follow a card's open/close
	 *  height animation smoothly (vs. snapping to the final layout). */
	private animateLayout(): void {
		this.animFrames = 14;
		this.reposition();
		if (this.animatingLoop) return;
		this.animatingLoop = true;
		const tick = (): void => {
			this.reposition();
			if (this.animFrames-- > 0) {
				window.requestAnimationFrame(tick);
			} else {
				this.animatingLoop = false;
			}
		};
		window.requestAnimationFrame(tick);
	}

	destroy(): void {
		this.destroyed = true;
		this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
		this.resizeObserver.disconnect();
		this.view.contentDOM.removeEventListener("mousedown", this.onContentMouseDown);
		this.view.contentDOM.removeEventListener("mouseover", this.onContentMouseOver);
		this.view.contentDOM.removeEventListener("mouseout", this.onContentMouseOut);
		this.removeDraftOutside();
		for (const card of this.cards.values()) card.destroy();
		this.cards.clear();
		this.container.remove();
	}

	private comments(): ParsedComment[] {
		const cfg = this.view.state.facet(commentConfig);
		// When the sidebar panel is open the comments live there, so the inline
		// column steps aside (no cards, no reserved width). Highlights persist —
		// they're keyed on `dc-highlights`, which follows Show highlights.
		if (!cfg.showComments() || cfg.sidebarOpen()) return [];
		const fv = this.view.state.field(commentField, false);
		if (!fv) return [];
		// Resolved cards stay in the DOM and are hidden via a container class, so
		// toggling visibility never requires rebuilding the editor.
		return fv.comments.filter(hasMarginAnchor);
	}

	private reconcile(): void {
		const comments = this.comments();
		const present = new Set(comments.map((c) => c.id));

		for (const [id, card] of this.cards) {
			if (!present.has(id)) {
				card.destroy();
				card.el.remove();
				this.cards.delete(id);
				if (this.activeId === id) this.activeId = null;
			}
		}

		const cardView = this.cardView();
		for (const c of comments) {
			const existing = this.cards.get(c.id);
			if (!existing) {
				const card = new Card(c, this.cb, cardView);
				this.cards.set(c.id, card);
				this.container.appendChild(card.el);
			} else {
				if (existing.signature !== cardSignature(c)) existing.update(c);
				existing.refreshAuthorColors();
			}
		}
	}

	private cardView(): CardView {
		const cfg = this.view.state.facet(commentConfig);
		// Resolve links/embeds in comment text against THIS editor's file, not the
		// workspace-active one (wrong in a background split pane).
		return {
			app: cfg.app,
			sourcePath: () => this.view.state.field(editorInfoField, false)?.file?.path ?? "",
			collapsible: true,
			colorForAuthor: cfg.colorForAuthor,
		};
	}

	private reposition(): void {
		if (this.destroyed) return;
		// dc-has / dc-highlights / dc-hide-resolved now live on the .cm-editor element
		// (editorLayoutField → editorAttributes), so the stylesheet caps the text
		// column with plain descendant selectors — no :has(), nothing to toggle on our
		// own container here.
		const draft = this.view.state.field(draftField, false) ?? null;
		this.syncDraftEl(draft);

		const editorTop = this.view.dom.getBoundingClientRect().top;
		// Gather geometry (reads) first, then write every top in one pass — cards are
		// absolutely positioned, so a top write can't change any height.
		const placements: Array<{ el: HTMLElement; top: number; height: number }> = [];

		const place = (el: HTMLElement, pos: number) => {
			const coords = this.view.coordsAtPos(pos);
			if (!coords) {
				el.addClass("dc-offscreen");
				return;
			}
			el.removeClass("dc-offscreen");
			if (el.offsetHeight === 0) return; // hidden (e.g. resolved)
			placements.push({ el, top: coords.top - editorTop, height: el.offsetHeight });
		};

		const doc = this.view.state.doc.toString();
		for (const c of this.comments()) {
			const card = this.cards.get(c.id);
			if (!card) continue;
			// A code comment's card aligns to its target line, not the block top.
			const range = isCodeComment(c) ? resolveCodeAnchor(doc, c) : anchorRange(c);
			if (range) place(card.el, range.from);
			else card.el.addClass("dc-offscreen"); // orphaned (e.g. the commented code changed)
		}

		if (draft && this.draftEl) place(this.draftEl, draft.from);

		const pivotEl = this.pivotId ? this.cards.get(this.pivotId)?.el : undefined;
		const pivot = pivotEl ? placements.findIndex((p) => p.el === pivotEl) : -1;
		const tops = stackTops(placements, CARD_GAP, pivot >= 0 ? pivot : undefined);
		placements.forEach((p, i) => p.el.setCssStyles({ top: `${tops[i]}px` }));
	}

	/** Create/remove the transient "new comment" composer card. */
	private syncDraftEl(draft: Draft | null): void {
		if (draft && !this.draftEl) {
			this.draftEl = this.buildDraftEl();
			this.container.appendChild(this.draftEl);
			this.draftFocused = false;
			// Click away from an empty draft dismisses it (Notion behavior).
			this.draftOutside = (e: MouseEvent) => {
				if (!this.draftEl || this.draftEl.contains(e.target as Node)) return;
				const fields = [...this.draftEl.querySelectorAll<HTMLTextAreaElement>("textarea")];
				if (fields.some((ta) => ta.disabled)) return;
				// Untouched: an empty comment, or a suggestion whose replacement still
				// equals the selected text and has no note.
				const untouched = fields.every((ta) =>
					ta.classList.contains("dc-field__proposal")
						? ta.value === (ta.getAttribute("data-dc-initial") ?? "")
						: ta.value.trim() === "",
				);
				if (fields.length > 0 && untouched) this.view.dispatch({ effects: clearDraft.of(null) });
			};
			this.view.dom.ownerDocument.addEventListener("mousedown", this.draftOutside, true);
		} else if (!draft && this.draftEl) {
			this.draftEl.remove();
			this.draftEl = null;
			this.setDraftEmptyAction = null;
			this.removeDraftOutside();
		}
		if (draft && this.draftEl) this.setDraftEmptyAction?.(this.emptyAction(draft));
		if (draft && this.draftEl && !this.draftFocused) {
			this.draftFocused = true;
			window.setTimeout(() => this.draftEl?.querySelector("textarea")?.focus(), 0);
		}
	}

	private removeDraftOutside(): void {
		if (this.draftOutside) {
			this.view.dom.ownerDocument.removeEventListener("mousedown", this.draftOutside, true);
			this.draftOutside = null;
		}
	}

	private buildDraftEl(): HTMLElement {
		const cfg = this.view.state.facet(commentConfig);
		const initialDraft = this.view.state.field(draftField, false);
		// Editor path: offsets come live from draftField (mapped through every edit),
		// so no stale-offset verification is needed here.
		const suggest = initialDraft?.mode === "suggest";
		const { el, setEmptyAction } = buildDraftComposer({
			mode: suggest ? "suggest" : "comment",
			insertion: suggest && initialDraft.from === initialDraft.to,
			initialProposal: suggest ? this.view.state.doc.sliceString(initialDraft.from, initialDraft.to) : undefined,
			onSubmitSuggestion: (proposal, note) => {
				const draft = this.view.state.field(draftField, false);
				if (!draft) return Result.err("The suggestion draft no longer exists.");
				const result = notifyErr(
					addSuggestion(this.view, draft.from, draft.to, proposal, note, this.cb.getAuthor()),
				);
				if (result.isOk()) this.view.dispatch({ effects: clearDraft.of(null) });
				return result.map(() => undefined);
			},
			emptyAction: initialDraft ? this.emptyAction(initialDraft) : "none",
			onCancel: () => this.view.dispatch({ effects: clearDraft.of(null) }),
			onSubmit: (text) => {
				const draft = this.view.state.field(draftField, false);
				if (!draft) return Result.err("The comment draft no longer exists.");
				const result = notifyErr(
					addComment(
						this.view,
						draft.from,
						draft.to,
						text,
						this.cb.getAuthor(),
						undefined,
						cfg.allowEmptyComments(),
						draft.targetHighlightId,
					),
				);
				if (result.isOk()) this.view.dispatch({ effects: clearDraft.of(null) });
				return result.map(() => undefined);
			},
		});
		this.setDraftEmptyAction = setEmptyAction;
		return el;
	}

	private emptyAction(draft: Draft): EmptySubmitAction {
		if (draft.targetHighlightId) return "remove";
		return this.view.state.facet(commentConfig).allowEmptyComments() ? "highlight" : "none";
	}

	private setActive(id: string | null): void {
		if (id && id !== this.pivotId) {
			this.pivotId = id;
			// Re-stack around the new pivot now (not in the next measure) so a reveal
			// that follows measures the card where it will actually be.
			this.reposition();
		}
		if (this.activeId === id) return;
		if (this.activeId) {
			this.cards.get(this.activeId)?.setActive(false);
			this.markHighlight(this.activeId, false);
		}
		this.activeId = id;
		if (id) {
			this.cards.get(id)?.setActive(true);
			this.markHighlight(id, true);
		}
	}

	private markHighlight(id: string, active: boolean): void {
		const spans = this.view.contentDOM.querySelectorAll(spanSelector(id));
		spans.forEach((s) => s.classList.toggle("is-active", active));
	}

	/** Clicking a margin card flashes its highlighted text. No document scroll: the
	 *  card is already aligned to its text, so scrolling the doc was pure disruption. */
	private flashAnchor(id: string): void {
		this.setActive(id);
		const span = this.view.contentDOM.querySelector(spanSelector(id));
		if (!span) return;
		span.classList.add("dc-flash");
		window.setTimeout(() => span.classList.remove("dc-flash"), FLASH_MS);
	}

	/** Scroll the editor the minimum needed to bring a just-opened reply composer
	 *  fully into view — without the jump-to-anchor that felt jarring. */
	private revealComposer(id: string): void {
		const card = this.cards.get(id);
		if (!card) return;
		this.view.requestMeasure({
			read: () => {
				const box = card.el.querySelector(".dc-field--composer");
				if (!(box instanceof HTMLElement)) return 0;
				const c = box.getBoundingClientRect();
				const s = this.view.scrollDOM.getBoundingClientRect();
				if (c.bottom > s.bottom) return c.bottom - s.bottom + 12;
				if (c.top < s.top) return c.top - s.top - 12;
				return 0;
			},
			write: (delta) => {
				if (delta) this.view.scrollDOM.scrollTop += delta;
			},
		});
	}

	/** Hovering highlighted text whose card is clipped by the column or pushed off
	 *  the visible area scrolls the editor the minimum needed to show the whole
	 *  card — keeping the hovered text on screen when both fit. */
	private revealCard(id: string): void {
		const card = this.cards.get(id);
		if (!card || card.el.offsetHeight === 0) return;
		this.view.requestMeasure({
			read: () => {
				const comment = this.comments().find((c) => c.id === id);
				const range = comment
					? isCodeComment(comment)
						? resolveCodeAnchor(this.view.state.doc.toString(), comment)
						: anchorRange(comment)
					: null;
				const anchor = range ? this.view.coordsAtPos(range.from) : null;
				return revealDelta(
					card.el.getBoundingClientRect(),
					this.view.scrollDOM.getBoundingClientRect(),
					anchor,
				);
			},
			write: (delta) => {
				if (!delta) return;
				this.scrolledFor = this.pointer;
				this.view.scrollDOM.scrollBy({ top: delta, behavior: "smooth" });
			},
		});
	}

	/** After we scroll to reveal a card, the browser re-dispatches hover events for
	 *  whatever content now sits under the unmoved pointer. Treat those as stale until
	 *  the pointer actually moves, so a reveal can neither undo itself nor cascade
	 *  into revealing the next comment. */
	private pointerStale(e: MouseEvent): boolean {
		if (this.scrolledFor && e.clientX === this.scrolledFor.x && e.clientY === this.scrolledFor.y) return true;
		this.scrolledFor = null;
		this.pointer = { x: e.clientX, y: e.clientY };
		return false;
	}

	private onContentMouseDown = (e: MouseEvent): void => {
		const id = closestSpanId(e.target);
		if (id) this.setActive(id);
	};

	private onContentMouseOver = (e: MouseEvent): void => {
		if (this.pointerStale(e)) return;
		const id = closestSpanId(e.target);
		if (!id) return;
		this.setActive(id);
		this.revealCard(id);
	};

	private onContentMouseOut = (e: MouseEvent): void => {
		if (this.pointerStale(e)) return;
		const span = e.target instanceof Element ? e.target.closest(".doc-comment-span") : null;
		if (!span) return;
		// Ignore moves that stay within the same highlight element (avoids flicker).
		const to = e.relatedTarget;
		if (to instanceof Node && span.contains(to)) return;
		this.setActive(null);
	};
}

export const marginPlugin = ViewPlugin.fromClass(MarginView);
