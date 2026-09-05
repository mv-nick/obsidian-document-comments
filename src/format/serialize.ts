import { CommentData, ThreadEntry } from "./types";
import { encodeCodeQuote, escapeReactionAuthor, escapeText } from "./escape";
import { canonicalAuthorKey } from "../author-colors";

export const openMarker = (id: string): string => {
	return `<!--c:${id}-->`;
};

export const closeMarker = (id: string): string => {
	return `<!--/c:${id}-->`;
};

/** Serialize a comment body block: `<!--co:ID header\n thread\n-->`. */
export const serializeBody = (id: string, data: CommentData): string => {
	const head: string[] = [`co:${id}`];
	if (data.author) head.push(`by:${canonicalAuthorKey(data.author)}`);
	if (data.createdAt) head.push(`at:${sanitizeToken(data.createdAt)}`);
	head.push(`status:${data.status}`);
	// A code quote must round-trip exactly (it re-anchors to the code); a prose
	// quote is collapsed for readability.
	if (data.quote) {
		const quote = data.codeLines ? encodeCodeQuote(data.quote) : sanitizeQuote(data.quote);
		head.push(`quote:"${quote}"`);
	}
	if (data.codeLines) {
		const { from, to } = data.codeLines;
		head.push(`line:${from === to ? from : `${from}-${to}`}`);
	}

	const lines = data.thread.map(serializeEntry);
	const reactionLines = (data.reactions ?? [])
		.filter((r) => r.authors.length > 0)
		.map((r) => {
			const target = r.entry !== undefined && r.entry > 0 ? `@${r.entry} ` : "";
			// Reaction lines sit inside the block too: an author or emoji carrying a
			// newline would forge an entry, and `-->` would end the block. Spelling is
			// otherwise kept as-is (commas are escaped) so existing reactions round-trip.
			const emoji = breakTerminator(r.emoji.replace(/\s+/g, ""));
			const authors = r.authors.map((author) =>
				escapeReactionAuthor(breakTerminator(author).replace(/[\r\n]+/g, " ")),
			);
			return `+${target}${emoji} ${authors.join(", ")}`;
		});
	const body = [...lines, ...reactionLines];
	const block = body.length ? body.join("\n") + "\n" : "";
	return `<!--${head.join(" ")}\n${block}-->`;
};

const serializeEntry = (e: ThreadEntry): string => {
	// Authors are written as single tokens (whitespace → `_`, `-->` broken), the
	// same normalization the `by:` header gets, so every entry round-trips through
	// the strict thread-line grammar in parse.ts.
	const author = canonicalAuthorKey(e.author);
	const who = e.timestamp ? `${author} (${sanitizeToken(e.timestamp).replace(/[()]/g, "_")})` : author;
	return `${who}: ${escapeText(sanitizeBodyText(e.text))}`;
};

/** Body text must never contain the comment terminator `-->`. Break it with a
 *  zero-width space so the block stays well-formed and the text reads the same. */
export const sanitizeBodyText = (s: string): string => {
	return breakTerminator(s);
};

/** Header values sit on the block's first line, which the terminator can't cross.
 *  Break any `-->` (whitespace/quote normalization alone left the header able to
 *  end the HTML comment early, leaking the thread into every non-plugin renderer). */
const sanitizeToken = (s: string): string => {
	return breakTerminator(s).replace(/\s+/g, "_");
};

const sanitizeQuote = (s: string): string => {
	return breakTerminator(s.replace(/\s+/g, " ").replace(/"/g, "'")).trim();
};

export const breakTerminator = (s: string): string => {
	return s.replace(/-->/g, "--​>");
};
