import { setIcon } from "obsidian";
import type { Result } from "better-result";
import {
	draftPlaceholder,
	DraftSubmitHandler,
	EmptySubmitAction,
	emptySubmitLabel,
	submitDraft,
} from "./draft-behavior";

export type SuggestionSubmitHandler = (
	proposal: string,
	note: string,
) => Result<void, string> | Promise<Result<void, string>>;

export type DraftComposerHandlers = {
	/** Called with the trimmed text on Enter or the confirm button. */
	onSubmit: DraftSubmitHandler;
	onCancel: () => void;
	/** What an empty confirmation does. The caller applies the action. */
	emptyAction?: EmptySubmitAction;
	/** `suggest` shows a replacement field (prefilled with the selected text) plus an
	 *  optional note, and submits through `onSubmitSuggestion`. */
	mode?: "comment" | "suggest";
	initialProposal?: string;
	/** True when the draft is an insertion point rather than a selection. */
	insertion?: boolean;
	onSubmitSuggestion?: SuggestionSubmitHandler;
};

/**
 * The inline "new comment" composer card (textarea + cancel/confirm), shared by
 * the editor and reading-view margins. Enter submits, Shift+Enter inserts a
 * newline, Escape cancels. The caller owns what submit/cancel actually do.
 */
export const buildDraftComposer = (
	handlers: DraftComposerHandlers,
): { el: HTMLElement; textarea: HTMLTextAreaElement; setEmptyAction: (action: EmptySubmitAction) => void } => {
	if (handlers.mode === "suggest") return buildSuggestionComposer(handlers);
	const el = createDiv("doc-comment-card is-draft");
	const box = el.createDiv("dc-field dc-field--composer");
	const initialEmptyAction = handlers.emptyAction ?? "none";
	let emptyLabel = emptySubmitLabel(initialEmptyAction);
	let saving = false;
	const textarea = box.createEl("textarea", {
		cls: "dc-field__input",
		attr: { placeholder: draftPlaceholder(initialEmptyAction), rows: "2" },
	});
	const actions = box.createDiv("dc-field__actions");
	const setSaving = (value: boolean): void => {
		saving = value;
		textarea.disabled = value;
		actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => (button.disabled = value));
	};
	const submit = async (): Promise<void> => {
		if (saving) return;
		setSaving(true);
		const result = await submitDraft(textarea.value, handlers.onSubmit);
		if (result.isErr()) {
			setSaving(false);
			textarea.focus({ preventScroll: true });
		}
	};

	const cancelBtn = actions.createEl("button", {
		cls: "dc-round dc-round--cancel",
		attr: { "aria-label": "Cancel" },
	});
	setIcon(cancelBtn, "x");
	cancelBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		handlers.onCancel();
	});

	const confirmBtn = actions.createEl("button", {
		cls: "dc-round dc-round--confirm",
		attr: { "aria-label": emptyLabel },
	});
	setIcon(confirmBtn, "check");
	confirmBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		void submit();
	});
	textarea.addEventListener("input", () => {
		confirmBtn.setAttribute("aria-label", textarea.value.trim() ? "Comment" : emptyLabel);
	});

	textarea.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			handlers.onCancel();
		} else if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	});
	const setEmptyAction = (action: EmptySubmitAction): void => {
		emptyLabel = emptySubmitLabel(action);
		textarea.setAttribute("placeholder", draftPlaceholder(action));
		confirmBtn.setAttribute("aria-label", textarea.value.trim() ? "Comment" : emptyLabel);
	};
	return { el, textarea, setEmptyAction };
};

/** The "suggest an edit" composer: the selected text, editable, becomes the
 *  proposal; an optional note explains it. Leaving the replacement empty proposes
 *  deleting the selection. The `data-dc-initial` attribute lets the caller tell an
 *  untouched draft from an edited one (for click-away dismissal). */
const buildSuggestionComposer = (
	handlers: DraftComposerHandlers,
): { el: HTMLElement; textarea: HTMLTextAreaElement; setEmptyAction: (action: EmptySubmitAction) => void } => {
	const el = createDiv("doc-comment-card is-draft is-draft-suggest");
	const box = el.createDiv("dc-field dc-field--composer");
	const initial = handlers.initialProposal ?? "";
	let saving = false;

	box.createDiv({ cls: "dc-field__label", text: handlers.insertion ? "Insert" : "Replace with" });
	const proposal = box.createEl("textarea", {
		cls: "dc-field__input dc-field__proposal",
		attr: {
			placeholder: handlers.insertion ? "Text to insert…" : "Leave empty to suggest deleting this text",
			rows: "2",
			"data-dc-initial": initial,
		},
	});
	proposal.value = initial;
	box.createDiv({ cls: "dc-field__label", text: "Note (optional)" });
	const note = box.createEl("textarea", {
		cls: "dc-field__input dc-field__note",
		attr: { placeholder: "Why?", rows: "1" },
	});

	const actions = box.createDiv("dc-field__actions");
	const setSaving = (value: boolean): void => {
		saving = value;
		proposal.disabled = value;
		note.disabled = value;
		actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => (button.disabled = value));
	};
	const submit = async (): Promise<void> => {
		if (saving || !handlers.onSubmitSuggestion) return;
		setSaving(true);
		const result = await handlers.onSubmitSuggestion(proposal.value, note.value.trim());
		if (result.isErr()) {
			setSaving(false);
			proposal.focus({ preventScroll: true });
		}
	};

	const cancelBtn = actions.createEl("button", {
		cls: "dc-round dc-round--cancel",
		attr: { "aria-label": "Cancel" },
	});
	setIcon(cancelBtn, "x");
	cancelBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		handlers.onCancel();
	});
	const confirmBtn = actions.createEl("button", {
		cls: "dc-round dc-round--confirm",
		attr: { "aria-label": "Suggest" },
	});
	setIcon(confirmBtn, "check");
	confirmBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		void submit();
	});

	for (const field of [proposal, note]) {
		field.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				handlers.onCancel();
			} else if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void submit();
			}
		});
	}
	return { el, textarea: proposal, setEmptyAction: () => {} };
};
