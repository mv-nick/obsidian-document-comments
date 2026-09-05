import { App, Modal, Setting } from "obsidian";
import {
	draftPlaceholder,
	DraftSubmitHandler,
	EmptySubmitAction,
	emptySubmitLabel,
	submitDraft,
} from "./draft-behavior";
import type { SuggestionSubmitHandler } from "./draft-composer";

export type CommentModalOptions = {
	/** `suggest` collects a replacement (prefilled with the selection) and a note. */
	mode?: "comment" | "suggest";
	insertion?: boolean;
	onSubmitSuggestion?: SuggestionSubmitHandler;
};

/**
 * A plain text-entry dialog for composing a new comment. Used where the inline
 * margin composer isn't available — i.e. on mobile, which has no floating column.
 * The caller supplies the quoted text (shown for context) and receives the entered
 * comment via `onSubmit`; the modal handles its own open/close.
 */
export class CommentModal extends Modal {
	private value = "";
	private proposal = "";
	private saving = false;

	constructor(
		app: App,
		private quote: string,
		private onSubmit: DraftSubmitHandler,
		private emptyAction: EmptySubmitAction = "none",
		private options: CommentModalOptions = {},
	) {
		super(app);
		this.proposal = quote;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		const suggest = this.options.mode === "suggest";
		titleEl.setText(suggest ? "Suggest an edit" : "Add comment");

		const quote = this.quote.trim();
		if (quote) contentEl.createDiv({ cls: "dc-modal-quote", text: quote });

		let proposalInput: HTMLTextAreaElement | null = null;
		if (suggest) {
			contentEl.createDiv({ cls: "dc-field__label", text: this.options.insertion ? "Insert" : "Replace with" });
			proposalInput = contentEl.createEl("textarea", {
				cls: "dc-modal-input",
				attr: {
					rows: "3",
					placeholder: this.options.insertion
						? "Text to insert…"
						: "Leave empty to suggest deleting this text",
				},
			});
			proposalInput.value = this.quote;
			proposalInput.addEventListener("input", () => {
				this.proposal = proposalInput?.value ?? "";
			});
			contentEl.createDiv({ cls: "dc-field__label", text: "Note (optional)" });
		}

		const input = contentEl.createEl("textarea", {
			cls: "dc-modal-input",
			attr: {
				rows: suggest ? "2" : "4",
				placeholder: suggest ? "Why?" : draftPlaceholder(this.emptyAction),
			},
		});
		input.addEventListener("input", () => {
			this.value = input.value;
		});
		// Cmd/Ctrl+Enter submits; plain Enter inserts a newline (room to type freely
		// on a small keyboard).
		for (const field of [proposalInput, input]) {
			field?.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					void this.submit();
				}
			});
		}
		window.setTimeout(() => (proposalInput ?? input).focus(), 0);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				const updateLabel = () => {
					if (suggest) {
						b.setButtonText("Suggest");
						return;
					}
					const emptyLabel = emptySubmitLabel(this.emptyAction);
					b.setButtonText(!this.value.trim() && this.emptyAction !== "none" ? emptyLabel : "Comment");
				};
				input.addEventListener("input", updateLabel);
				updateLabel();
				b.setCta().onClick(() => void this.submit());
			});
	}

	private async submit(): Promise<void> {
		if (this.saving) return;
		const text = this.value.trim();
		this.saving = true;
		this.contentEl
			.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>("textarea, button")
			.forEach((control) => (control.disabled = true));
		const result =
			this.options.mode === "suggest" && this.options.onSubmitSuggestion
				? await this.options.onSubmitSuggestion(this.proposal, text)
				: await submitDraft(text, this.onSubmit);
		if (result.isOk()) {
			this.close();
			return;
		}
		this.saving = false;
		this.contentEl
			.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>("textarea, button")
			.forEach((control) => (control.disabled = false));
		this.contentEl.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
	}

	onClose(): void {
		this.saving = false;
		this.contentEl.empty();
	}
}
