export type CommentStatus = "open" | "resolved";

export type ThreadEntry = {
	author: string;
	/** ISO-8601 timestamp, optional (the first entry usually carries it via the header). */
	timestamp?: string;
	text: string;
};

export type ReactionTarget = {
	id: string;
	entry: number;
	emoji: string;
};

export type Reaction = {
	emoji: string;
	authors: string[];
	/** Zero-based thread entry. Missing targets the first entry for legacy comments. */
	entry?: number;
};

/** The content of a comment, independent of where it sits in the document. */
export type CommentData = {
	author?: string;
	createdAt?: string;
	status: CommentStatus;
	/** Redundant copy of the anchored text — the re-anchor fallback. */
	quote?: string;
	/** Present only for a comment anchored to lines inside a fenced code block.
	 *  The markers wrap the whole block; these are the block-relative line indices
	 *  (0-based, inclusive) the comment actually targets. `quote` is the re-anchor
	 *  key; these lines are the fast path and the disambiguator. */
	codeLines?: TextRange;
	/** Present when this comment is a **suggestion**: the text proposed to replace
	 *  the anchored range. `""` proposes deleting it; an empty anchor with a
	 *  non-empty proposal proposes an insertion. Stored as the first body line,
	 *  `=>: text`, which older readers show as a reply by an author called `=>`
	 *  and preserve on rewrite. */
	proposal?: string;
	thread: ThreadEntry[];
	reactions: Reaction[];
};

/** What accepting a suggestion would do, derived from its anchor and proposal. */
export type SuggestionKind = "replace" | "insert" | "delete";

export type TextRange = {
	from: number;
	to: number;
};

/** Why a body block is not the well-formed shape the serializer writes.
 *  - `unterminated`: `<!--co:` with no `-->` anywhere after it. Every HTML renderer
 *    swallows the rest of the file; the plugin records the header and hides nothing.
 *  - `terminator-in-header`: a `-->` on the header line (typically a `quote:` that
 *    copied another comment's markers verbatim). HTML renderers end the comment
 *    there and show the thread as prose; the plugin still reads the block whole,
 *    and any rewrite repairs it because the serializer breaks `-->` in quotes.
 *  - `terminator-in-text`: the block ends at a `-->` typed inside an entry, so the
 *    rest of the thread is visible prose. Rewriting or deleting would strand it.
 *  - `overrun`: the block has no terminator of its own and runs into another
 *    comment's markers. Deleting it would delete the prose in between. */
export type MalformedReason = "unterminated" | "terminator-in-header" | "terminator-in-text" | "overrun";

/** A comment as found in a document, with resolved offsets for each piece. */
export type ParsedComment = {
	id: string;
	/** `<!--c:ID-->` marker range, or null if missing. */
	open: TextRange | null;
	/** `<!--/c:ID-->` marker range, or null if missing. */
	close: TextRange | null;
	/** `<!--co:ID ...-->` body block range, or null if missing. */
	body: TextRange | null;
	/** Set when the body block is not well formed. Edits refuse to rewrite or delete
	 *  such a comment (except `terminator-in-header`, which a rewrite repairs). */
	malformed?: MalformedReason;
	/** Header keys the plugin does not understand. Shown on the card so nothing an
	 *  agent can read is invisible to the person; dropped on rewrite. */
	unknownKeys?: string[];
} & CommentData;
