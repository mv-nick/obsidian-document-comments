import { App, Component, MarkdownRenderer, Menu, setIcon } from "obsidian";
import type { Result } from "better-result";
import type { AuthorColorResolver } from "../author-colors";
import { ParsedComment, ReactionTarget } from "../format/types";
import { isSuggestion, malformedMessage, suggestionKind } from "../format/parse";
import { CardEntry, cardEntries, cardSignature, formatRelativeTime } from "./card-format";

const QUICK_EMOJI = ["👍", "❤️", "😄", "🎉", "😮", "👀", "🙏"];

// A margin card whose thread is taller than this collapses to a "Show more" preview
// (Notion-style), so a long comment never dominates the column or runs off the
// bottom edge. Keep in sync with the .dc-card-clip max-height in styles.css.
const CLAMP_HEIGHT = 220;

export type CardCallbacks = {
	getAuthor: () => string;
	onHover: (id: string, active: boolean) => void;
	onClickAnchor: (id: string) => void;
	/** The card changed height (open/close, edit, react, expand) — re-run stacking. */
	onResize: () => void;
	/** Like onResize, but for an animated height change: track the grow/shrink for a
	 *  few frames so neighbors follow it smoothly. Falls back to onResize when absent. */
	animateLayout?: () => void;
	reply: (id: string, text: string) => Result<void, string> | Promise<Result<void, string>>;
	setResolved: (id: string, resolved: boolean) => void;
	remove: (id: string) => void;
	editEntry: (id: string, index: number, text: string) => void;
	deleteEntry: (id: string, index: number) => void;
	toggleReaction: (target: ReactionTarget) => void;
	/** Bring a just-opened reply composer fully into view (the margin scrolls the
	 *  editor minimally; the sidebar scrolls its own list). */
	revealComposer?: (id: string) => void;
	/** Reveal this thread in the comments sidebar — the escape for a card too tall to
	 *  fit the margin even when expanded. Absent for cards already in the sidebar. */
	openInSidebar?: (id: string) => void;
	/** Suggestion actions. Accept writes the proposal into the note; reject drops
	 *  the suggestion; setProposal changes what it proposes. */
	acceptSuggestion?: (id: string) => void;
	rejectSuggestion?: (id: string) => void;
	setProposal?: (id: string, proposal: string) => void;
};

/** Per-view context a card needs to render comment text as Markdown. */
export type CardView = {
	/** App handle for MarkdownRenderer; absent in unit tests → plain-text fallback. */
	app?: App;
	/** Source note path, for resolving links/embeds in rendered comment text. */
	sourcePath: () => string;
	/** Collapse a tall card to a "Show more" preview. Margin only — the sidebar
	 *  scrolls its list, so sidebar cards stay full height. */
	collapsible?: boolean;
	colorForAuthor?: AuthorColorResolver;
};

/** A single margin comment card with the full Notion-style interaction set. */
export class Card {
	readonly el: HTMLElement;
	private comment: ParsedComment;
	private open = false;
	private editingIndex = -1;
	private addingFirstEntry = false;
	/** In-progress text of the entry editor, so an external update mid-edit
	 *  (a synced reply, a reaction toggled elsewhere) doesn't discard it. */
	private editDraft = "";
	/** Inline editor for a suggestion's proposal. */
	private editingProposal = false;
	private proposalDraft = "";
	private draft = "";
	private savingFirstEntry = false;
	private savingReply = false;
	/** Measured: the thread exceeds the clamp height / the whole column. */
	private overflows = false;
	private tooTall = false;
	private clipEl: HTMLElement | null = null;
	private threadEl: HTMLElement | null = null;
	private footEl: HTMLElement | null = null;
	/** Owns the child components MarkdownRenderer attaches (link/embed handlers). */
	private md = new Component();
	/** Re-measures overflow when the (async-rendered) content settles or changes. */
	private ro = new ResizeObserver(() => this.measure());
	/** Tears down an open emoji popover and its document listener. */
	private closePopover: (() => void) | null = null;

	constructor(
		comment: ParsedComment,
		private cb: CardCallbacks,
		private view: CardView,
	) {
		this.comment = comment;
		this.md.load();
		this.el = createDiv("doc-comment-card");
		this.el.addEventListener("mouseenter", () => this.cb.onHover(this.id, true));
		this.el.addEventListener("mouseleave", () => this.cb.onHover(this.id, false));
		this.el.addEventListener("mousedown", (e) => {
			const target = e.target as HTMLElement;
			if (target.closest("button, textarea, a, .dc-foot-btn, .dc-reaction, .dc-pop")) return;
			this.cb.onClickAnchor(this.id);
			// An empty plain comment opens straight into its text editor; an empty
			// suggestion has its proposal as content, so it opens like any thread.
			if (this.comment.thread.length === 0 && !isSuggestion(this.comment)) {
				this.startEdit(0);
				return;
			}
			// A thread too tall for the margin opens in the sidebar instead of expanding
			// into a full-height card whose bottom you can't scroll to.
			if (this.tooTall && this.cb.openInSidebar) this.cb.openInSidebar(this.id);
			else this.setOpen(true);
		});
		this.render();
	}

	get id(): string {
		return this.comment.id;
	}

	get signature(): string {
		return cardSignature(this.comment);
	}

	update(comment: ParsedComment): void {
		this.comment = comment;
		// Keep an open entry editor across external updates; commit/cancel clear
		// editingIndex first, so a landed edit still collapses the editor. Only drop
		// it if the edited entry no longer exists (e.g. deleted elsewhere).
		const editingEmpty = this.editingIndex === 0 && comment.thread.length === 0;
		if (!editingEmpty && this.editingIndex >= comment.thread.length) {
			this.editingIndex = -1;
			this.addingFirstEntry = false;
			this.editDraft = "";
		}
		this.render();
	}

	/** Release the markdown-render component (its link/embed child handlers) and any
	 *  document-level listener when the card is dropped from the margin or sidebar. */
	destroy(): void {
		this.ro.disconnect();
		this.md.unload();
		this.closePopover?.();
		this.el.ownerDocument.removeEventListener("mousedown", this.onDocMouseDown, true);
	}

	setActive(active: boolean): void {
		this.el.toggleClass("is-active", active);
	}

	refreshAuthorColors(): void {
		const colorForAuthor = this.view.colorForAuthor;
		if (!colorForAuthor) return;
		this.el.querySelectorAll<HTMLElement>(".dc-entry__author[data-dc-author]").forEach((authorEl) => {
			const author = authorEl.dataset.dcAuthor;
			if (!author) return;
			const color = colorForAuthor(author);
			if (color) authorEl.style.setProperty("--dc-author-color", color);
			else authorEl.style.removeProperty("--dc-author-color");
		});
	}

	private setOpen(open: boolean): void {
		if (this.open === open) return;
		const fromHeight = this.clipEl?.offsetHeight ?? 0;
		this.open = open;
		this.render();
		this.animateClip(fromHeight);
		(this.cb.animateLayout ?? this.cb.onResize)();
		if (open) {
			this.el.ownerDocument.addEventListener("mousedown", this.onDocMouseDown, true);
			this.cb.revealComposer?.(this.id);
			this.focusComposer();
		} else {
			this.el.ownerDocument.removeEventListener("mousedown", this.onDocMouseDown, true);
		}
	}

	private onDocMouseDown = (e: MouseEvent): void => {
		if (!this.el.contains(e.target as Node)) this.setOpen(false);
	};

	/** Quick, smooth grow/shrink of the body on open/close: animate the clip from its
	 *  previous height to the new target, then drop the inline overrides so it's free
	 *  to resize naturally again. */
	private animateClip(fromHeight: number): void {
		const clip = this.clipEl;
		if (!clip || !this.view.collapsible) return;
		const toHeight = this.open ? clip.scrollHeight : CLAMP_HEIGHT;
		if (Math.abs(fromHeight - toHeight) < 2) return;
		clip.setCssStyles({ overflow: "hidden", transition: "none", maxHeight: `${fromHeight}px` });
		void clip.offsetHeight; // reflow so the start height is committed before transitioning
		clip.setCssStyles({ transition: "max-height 150ms ease", maxHeight: `${toHeight}px` });
		const cleanup = (): void => {
			clip.setCssStyles({ maxHeight: "", overflow: "", transition: "" });
			clip.removeEventListener("transitionend", cleanup);
			window.clearTimeout(timer);
		};
		const timer = window.setTimeout(cleanup, 260); // fallback if transitionend never fires
		clip.addEventListener("transitionend", cleanup);
	}

	private render(): void {
		const c = this.comment;
		this.el.empty();
		// MarkdownRenderer attaches a child component per link/embed to `md`; a fresh
		// component per render keeps them from accumulating for the card's lifetime.
		this.md.unload();
		this.md = new Component();
		this.md.load();
		this.el.toggleClass("is-resolved", c.status === "resolved");
		this.el.toggleClass("is-open", this.open);
		this.el.toggleClass("is-malformed", c.malformed !== undefined);
		if (c.malformed) this.el.createDiv({ cls: "dc-card-warning", text: malformedMessage(c.malformed) });
		// Header keys the plugin doesn't understand are readable by any tool that
		// parses the file, so show them rather than leave a channel only agents see.
		if (c.unknownKeys?.length) {
			this.el.createDiv({ cls: "dc-card-meta", text: `Unrecognised fields: ${c.unknownKeys.join(", ")}` });
		}

		// The thread lives in a clip wrapper that gets a max-height when a tall card is
		// collapsed; the footer (Show more / Open in sidebar) sits outside the clip.
		const clip = this.el.createDiv("dc-card-clip");
		this.clipEl = clip;
		if (isSuggestion(c)) this.renderSuggestion(clip);
		const thread = clip.createDiv("dc-thread");
		this.threadEl = thread;
		cardEntries(c).forEach((entry, i) => this.renderEntry(thread, entry, i));
		this.refreshAuthorColors();
		if (this.open && this.editingIndex < 0) this.renderComposer(clip);

		this.footEl = this.el.createDiv("dc-card-foot");
		this.applyClampState();

		// Re-measure once the (async Markdown) content settles, and on later changes.
		// The card may not be in the DOM yet during construction; the observer fires
		// when it attaches and is sized.
		if (this.view.collapsible) {
			this.ro.disconnect();
			this.ro.observe(thread);
		}
	}

	/** Recompute whether the thread overflows the clamp / the whole column, and
	 *  reflect it. Cheap; driven by the ResizeObserver as content settles or changes. */
	private measure(): void {
		if (!this.threadEl || !this.view.collapsible) return;
		const content = this.threadEl.offsetHeight;
		const overflows = content > CLAMP_HEIGHT;
		const viewport = this.el.parentElement?.clientHeight ?? 0;
		const tooTall = viewport > 0 && content > viewport - 24;
		if (overflows === this.overflows && tooTall === this.tooTall) return;
		this.overflows = overflows;
		this.tooTall = tooTall;
		this.applyClampState();
		this.cb.onResize(); // clamping changes the card height → restack
	}

	/** Apply the collapse state to the DOM: clamp the body when a tall card is at
	 *  rest, and render the Show more / Show less / Open-in-sidebar footer. */
	private applyClampState(): void {
		this.clipEl?.toggleClass("dc-clamped", !!this.view.collapsible && !this.open && this.overflows);
		const foot = this.footEl;
		if (!foot) return;
		foot.empty();
		if (this.view.collapsible) {
			if (this.tooTall && this.cb.openInSidebar) {
				// Too tall to read in the margin at all (expanding gives an unreachable
				// full-height card), so the affordance is "open in sidebar" directly — on
				// the always-reachable collapsed card.
				this.footButton(foot, "Open in sidebar →", "", () => this.cb.openInSidebar?.(this.id));
			} else if (!this.open && this.overflows) {
				// "Show more" opens the card — full thread + reply field in one click, so
				// there's no second click to reveal the composer. Collapse by clicking away.
				this.footButton(foot, "Show more", "", () => this.setOpen(true));
			}
		}
		// Collapsed "Show more" is a centered overlay at the card's bottom (over the
		// faded text); "Open in sidebar" (when open) is a normal centered footer.
		foot.toggleClass("dc-foot-overlay", !!this.view.collapsible && !this.open && this.overflows);
		foot.toggleClass("is-empty", foot.childElementCount === 0);
	}

	/** A subtle, Notion-style text affordance. A <span> (not an Obsidian <button>) so
	 *  no theme can give it chip chrome; role+tabindex keep it keyboard-accessible. */
	private footButton(parent: HTMLElement, text: string, extraClass: string, onClick: () => void): void {
		const btn = parent.createSpan({
			cls: extraClass ? `dc-foot-btn ${extraClass}` : "dc-foot-btn",
			text,
			attr: { role: "button", tabindex: "0" },
		});
		const fire = (e: Event) => {
			e.stopPropagation();
			onClick();
		};
		btn.addEventListener("click", fire);
		btn.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				fire(e);
			}
		});
	}

	private renderEntry(parent: HTMLElement, entry: CardEntry, i: number): void {
		const row = parent.createDiv("dc-entry");

		const bar = row.createDiv("dc-entry__bar");
		this.iconButton(bar, "smile-plus", "React", (e) => this.openReactionPicker(e.currentTarget as HTMLElement, i));
		// A suggestion is accepted or rejected rather than resolved.
		if (i === 0 && !isSuggestion(this.comment)) {
			const resolved = this.comment.status === "resolved";
			this.iconButton(bar, resolved ? "rotate-ccw" : "check", resolved ? "Reopen" : "Resolve", () =>
				this.cb.setResolved(this.id, !resolved),
			);
		}
		this.iconButton(bar, "more-horizontal", "More", (e) => this.openMoreMenu(e, i));

		const head = row.createDiv("dc-entry__head");
		head.createSpan({
			cls: "dc-entry__author",
			text: entry.author || "—",
			attr: entry.author ? { "data-dc-author": entry.author } : undefined,
		});
		const time = formatRelativeTime(entry.timestamp ?? (i === 0 ? this.comment.createdAt : undefined));
		if (time) head.createSpan({ cls: "dc-entry__time", text: time });

		if (this.editingIndex === i) {
			this.renderEditor(row, i);
		} else if (entry.empty) {
			const placeholder = row.createSpan({
				cls: "dc-entry__text dc-entry__text--empty",
				text: entry.text,
				attr: { "aria-label": "Edit empty comment", role: "button", tabindex: "0" },
			});
			const edit = (event: Event) => {
				event.stopPropagation();
				this.startEdit(i);
			};
			placeholder.addEventListener("click", edit);
			placeholder.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					edit(event);
				}
			});
		} else {
			this.renderText(row.createDiv("dc-entry__text"), entry.text);
		}

		const reactions = this.comment.reactions.filter((reaction) => (reaction.entry ?? 0) === i);
		if (reactions.length > 0) this.renderReactions(row, i, reactions);
	}

	/** Render comment text as Markdown (code spans, links, lists, …). Falls back to
	 *  plain text when no App is available (unit tests). */
	private renderText(el: HTMLElement, text: string): void {
		if (this.view.app) {
			void MarkdownRenderer.render(this.view.app, neutralizeEmbeds(text), el, this.view.sourcePath(), this.md);
		} else {
			el.setText(text);
		}
	}

	private renderReactions(parent: HTMLElement, entry: number, reactions: ParsedComment["reactions"]): void {
		const me = this.cb.getAuthor();
		const wrap = parent.createDiv("dc-entry__reactions");
		reactions.forEach((r) => {
			const chip = wrap.createEl("button", { cls: "dc-reaction" });
			chip.toggleClass("is-mine", r.authors.includes(me));
			chip.createSpan({ cls: "dc-reaction__emoji", text: r.emoji });
			chip.createSpan({ cls: "dc-reaction__count", text: String(r.authors.length) });
			chip.setAttribute("aria-label", r.authors.join(", "));
			chip.addEventListener("click", (e) => {
				e.stopPropagation();
				this.cb.toggleReaction({ id: this.id, entry, emoji: r.emoji });
			});
		});
	}

	private renderEditor(row: HTMLElement, index: number): void {
		const box = row.createDiv("dc-field dc-field--edit");
		const ta = box.createEl("textarea", { cls: "dc-field__input" });
		ta.value = this.editDraft;
		autogrow(ta);
		ta.addEventListener("input", () => {
			this.editDraft = ta.value;
			autogrow(ta);
		});
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.cancelEdit();
			else if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void this.commitEdit(index, ta.value);
			}
		});
		const actions = box.createDiv("dc-field__actions");
		this.roundButton(actions, "x", "Cancel", "dc-round--cancel", () => this.cancelEdit());
		this.roundButton(actions, "check", "Save", "dc-round--confirm", () => void this.commitEdit(index, ta.value));
		this.setFieldSaving(box, this.savingFirstEntry);
		if (!this.savingFirstEntry) {
			window.setTimeout(() => {
				ta.focus();
				ta.setSelectionRange(ta.value.length, ta.value.length);
			}, 0);
		}
	}

	private roundButton(parent: HTMLElement, icon: string, label: string, variant: string, onClick: () => void): void {
		const btn = parent.createEl("button", { cls: `dc-round ${variant}`, attr: { "aria-label": label } });
		setIcon(btn, icon);
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			onClick();
		});
	}

	private renderComposer(parent: HTMLElement): void {
		const box = parent.createDiv("dc-field dc-field--composer");
		const ta = box.createEl("textarea", {
			cls: "dc-field__input",
			attr: { placeholder: this.comment.thread.length === 0 ? "Comment…" : "Reply…", rows: "1" },
		});
		ta.value = this.draft;
		autogrow(ta);
		ta.addEventListener("input", () => {
			this.draft = ta.value;
			autogrow(ta);
		});
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void this.submitReply();
			}
		});
		const actions = box.createDiv("dc-field__actions");
		this.roundButton(actions, "arrow-up", "Send", "dc-round--confirm", () => void this.submitReply());
		this.setFieldSaving(box, this.savingReply);
	}

	private async submitReply(): Promise<void> {
		if (this.savingReply) return;
		const ta = this.el.querySelector(".dc-field--composer .dc-field__input");
		if (!(ta instanceof HTMLTextAreaElement)) return;
		const text = ta.value.trim();
		if (!text) return;
		this.draft = ta.value;
		this.savingReply = true;
		this.setFieldSaving(ta.closest(".dc-field"), true);
		const result = await this.cb.reply(this.id, text);
		this.savingReply = false;
		if (result.isErr()) {
			this.setFieldSaving(this.el.querySelector(".dc-field--composer"), false);
			this.focusComposer();
			return;
		}
		this.draft = "";
		this.render();
		this.cb.onResize();
	}

	private async commitEdit(index: number, value: string): Promise<void> {
		const text = value.trim();
		if (!text) {
			this.cancelEdit();
			return;
		}
		const addsFirstEntry = this.addingFirstEntry;
		if (addsFirstEntry) {
			if (this.savingFirstEntry) return;
			this.editDraft = value;
			this.savingFirstEntry = true;
			this.setFieldSaving(this.el.querySelector(".dc-field--edit"), true);
			const result = await this.cb.reply(this.id, text);
			this.savingFirstEntry = false;
			if (result.isErr()) {
				this.setFieldSaving(this.el.querySelector(".dc-field--edit"), false);
				this.focusEditor();
				return;
			}
			this.finishEdit();
			return;
		}
		// Collapse the editor before the write lands so the incoming external
		// update() doesn't reopen it (and doesn't clobber a concurrent edit elsewhere).
		this.finishEdit();
		this.cb.editEntry(this.id, index, text);
	}

	private finishEdit(): void {
		this.editingIndex = -1;
		this.addingFirstEntry = false;
		this.editDraft = "";
		this.render();
		this.cb.onResize();
	}

	private cancelEdit(): void {
		this.editingIndex = -1;
		this.addingFirstEntry = false;
		this.editDraft = "";
		this.render();
		this.cb.onResize();
	}

	private startEdit(index: number): void {
		this.editingIndex = index;
		this.addingFirstEntry = index === 0 && this.comment.thread.length === 0;
		this.editDraft = this.comment.thread[index]?.text ?? "";
		this.render();
		this.cb.onResize();
	}

	private openMoreMenu(e: MouseEvent, index: number): void {
		const menu = new Menu();
		const suggestion = isSuggestion(this.comment);
		menu.addItem((item) =>
			item
				.setTitle("Edit")
				.setIcon("pencil")
				.onClick(() => this.startEdit(index)),
		);
		if (index === 0 && suggestion && this.cb.setProposal) {
			menu.addItem((item) =>
				item
					.setTitle("Edit suggestion")
					.setIcon("pencil-line")
					.onClick(() => this.startProposalEdit()),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(index === 0 ? (suggestion ? "Delete suggestion" : "Delete comment") : "Delete reply")
				.setIcon("trash")
				.onClick(() => (index === 0 ? this.cb.remove(this.id) : this.cb.deleteEntry(this.id, index))),
		);
		menu.showAtMouseEvent(e);
	}

	/** The suggestion block at the top of the card: who proposes what, the proposal
	 *  itself (editable), and Accept / Reject. */
	private renderSuggestion(parent: HTMLElement): void {
		const c = this.comment;
		const kind = suggestionKind(c);
		const box = parent.createDiv("dc-suggest");
		const who = c.author || "";
		const verb =
			kind === "insert"
				? "suggests inserting"
				: kind === "delete"
					? "suggests deleting"
					: kind === "replace"
						? "suggests replacing with"
						: "suggested a change, but the text is gone";
		box.createDiv({ cls: "dc-suggest__label", text: who ? `${who} ${verb}` : verb });
		if (this.editingProposal) {
			this.renderProposalEditor(box);
		} else {
			const shown = kind === "delete" ? (c.quote ?? "") : (c.proposal ?? "");
			const proposal = box.createDiv({
				cls: kind === "delete" ? "dc-suggest__proposal is-delete" : "dc-suggest__proposal",
				text: shown || "(nothing)",
			});
			if (this.cb.setProposal) {
				proposal.setAttribute("title", "Double-click to edit the suggestion");
				proposal.addEventListener("dblclick", (event) => {
					event.stopPropagation();
					this.startProposalEdit();
				});
			}
		}
		const actions = box.createDiv("dc-suggest__actions");
		if (kind && this.cb.acceptSuggestion) {
			const accept = actions.createEl("button", { cls: "dc-suggest__btn is-accept", text: "Accept" });
			accept.addEventListener("click", (event) => {
				event.stopPropagation();
				this.cb.acceptSuggestion?.(this.id);
			});
		}
		if (this.cb.rejectSuggestion) {
			const reject = actions.createEl("button", {
				cls: "dc-suggest__btn is-reject",
				text: kind ? "Reject" : "Remove",
			});
			reject.addEventListener("click", (event) => {
				event.stopPropagation();
				this.cb.rejectSuggestion?.(this.id);
			});
		}
		if (actions.childElementCount === 0) actions.remove();
	}

	private renderProposalEditor(parent: HTMLElement): void {
		const box = parent.createDiv("dc-field dc-field--edit dc-field--proposal");
		const ta = box.createEl("textarea", { cls: "dc-field__input" });
		ta.value = this.proposalDraft;
		autogrow(ta);
		ta.addEventListener("input", () => {
			this.proposalDraft = ta.value;
			autogrow(ta);
		});
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.cancelProposalEdit();
			else if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.commitProposalEdit(ta.value);
			}
		});
		const actions = box.createDiv("dc-field__actions");
		this.roundButton(actions, "x", "Cancel", "dc-round--cancel", () => this.cancelProposalEdit());
		this.roundButton(actions, "check", "Save", "dc-round--confirm", () => this.commitProposalEdit(ta.value));
		window.setTimeout(() => {
			ta.focus();
			ta.setSelectionRange(ta.value.length, ta.value.length);
		}, 0);
	}

	private startProposalEdit(): void {
		this.editingProposal = true;
		this.proposalDraft = this.comment.proposal ?? "";
		this.render();
		this.cb.onResize();
	}

	private commitProposalEdit(value: string): void {
		this.editingProposal = false;
		this.proposalDraft = "";
		this.render();
		this.cb.onResize();
		if (value !== this.comment.proposal) this.cb.setProposal?.(this.id, value);
	}

	private cancelProposalEdit(): void {
		this.editingProposal = false;
		this.proposalDraft = "";
		this.render();
		this.cb.onResize();
	}

	private openReactionPicker(anchor: HTMLElement, entry: number): void {
		const doc = this.el.ownerDocument;
		doc.querySelectorAll(".dc-pop").forEach((p) => p.remove());
		const pop = doc.body.createDiv("dc-pop");
		// Self-removing outside-click handler. Picking an emoji tears it down too, and
		// destroy() calls the same teardown, so the document listener never outlives
		// the popover or the card.
		const teardown = () => {
			pop.remove();
			doc.removeEventListener("mousedown", close, true);
			this.closePopover = null;
		};
		const close = (ev: MouseEvent) => {
			if (!pop.contains(ev.target as Node)) teardown();
		};
		const pick = (emoji: string) => {
			teardown();
			this.cb.toggleReaction({ id: this.id, entry, emoji });
		};
		this.closePopover = teardown;
		for (const emoji of QUICK_EMOJI) {
			const btn = pop.createEl("button", { cls: "dc-pop__emoji", text: emoji });
			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				pick(emoji);
			});
		}
		// Right-align the popover with the button so it grows left, not off-page.
		const rect = anchor.getBoundingClientRect();
		const left = Math.max(8, rect.right - pop.offsetWidth);
		pop.setCssStyles({ top: `${rect.bottom + 4}px`, left: `${left}px` });
		window.setTimeout(() => doc.addEventListener("mousedown", close, true), 0);
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void): void {
		const btn = parent.createEl("button", { cls: "dc-act", attr: { "aria-label": label } });
		setIcon(btn, icon);
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			onClick(e);
		});
	}

	private focusComposer(): void {
		window.setTimeout(() => {
			const ta = this.el.querySelector(".dc-field--composer .dc-field__input");
			if (ta instanceof HTMLTextAreaElement) ta.focus({ preventScroll: true });
		}, 0);
	}

	private focusEditor(): void {
		window.setTimeout(() => {
			const ta = this.el.querySelector(".dc-field--edit .dc-field__input");
			if (ta instanceof HTMLTextAreaElement) ta.focus({ preventScroll: true });
		}, 0);
	}

	private setFieldSaving(field: Element | null, saving: boolean): void {
		field
			?.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>("textarea, button")
			.forEach((control) => (control.disabled = saving));
	}
}

/** Comment bodies are invisible in the note yet rendered through the full Markdown
 *  pipeline, so an image or embed in one would load on card render without anyone
 *  having seen it in the text. Downgrade `![…]` / `![[…]]` to plain links, which
 *  render as links and fetch nothing until clicked. */
export const neutralizeEmbeds = (text: string): string => {
	return text.replace(/!\[\[/g, "[[").replace(/!\[/g, "[");
};

const autogrow = (ta: HTMLTextAreaElement): void => {
	ta.setCssStyles({ height: "auto" });
	ta.setCssStyles({ height: `${ta.scrollHeight}px` });
};
