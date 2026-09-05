import { CommentData, CommentStatus, MalformedReason, ParsedComment, Reaction, TextRange, ThreadEntry } from "./types";
import { decodeCodeQuote, splitReactionAuthors, unescapeText } from "./escape";

// Anchor markers. Both are HTML comments so they're invisible everywhere. The id
// grammar ([A-Za-z0-9]+) is load-bearing beyond parsing: edits.ts interpolates ids
// into RegExps, which is only safe because an id can never hold a metacharacter.
const OPEN_RE = /<!--c:([A-Za-z0-9]+)-->/g;
const CLOSE_RE = /<!--\/c:([A-Za-z0-9]+)-->/g;
const BODY_OPEN = "<!--co:";
const TERMINATOR = "-->";
const ID_CHAR = /[A-Za-z0-9]/;

/** Header keys the plugin reads. Anything else is kept for display only. */
const KNOWN_HEADER_KEYS = new Set(["by", "at", "status", "quote", "line"]);

/** `author: text` / `author (timestamp): text` with a single-token author. The colon
 *  must be followed by a space or end the line, so `11:11 Today` and `http://…` never
 *  read as authors. No two adjacent quantifiers share a character class, so matching
 *  is linear in the line length — this runs on every keystroke. */
const STRICT_ENTRY_RE = /^([^\s:()]+)(?: \(([^()\r\n]*)\))?:(?: (.*))?$/;
/** Legacy multi-word authors ("Kyle McDonald"): up to four plain words, no punctuation. */
const LEGACY_AUTHOR_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*(?: [\p{L}\p{N}_][\p{L}\p{N}_-]*){0,3}$/u;
const LEGACY_AUTHOR_MAX = 32;
const REACTION_LINE_RE = /^\+\s*(?:@(\d+)\s+)?(\S+)\s+(.+)$/;
/** An intact marker inside a body block means the block ran past its own end. */
const MARKER_IN_BLOCK_RE = /<!--(?:\/?c:[A-Za-z0-9]+-->|co:[A-Za-z0-9]+(?:[ \t\r\n]|$))/;

type BodyMatch = {
	id: string;
	/** Null for an unterminated block: nothing is hidden, nothing can be rewritten. */
	range: TextRange | null;
	data: CommentData;
	malformed?: MalformedReason;
	unknownKeys: string[];
};

/** Parse every comment in a document, in order of first appearance. */
export const parseComments = (doc: string): ParsedComment[] => {
	const masks = maskedRanges(doc);
	const masked = (index: number) => isInside(masks, index);

	const opens = new Map<string, TextRange>();
	const closes = new Map<string, TextRange>();
	const bodies = new Map<string, BodyMatch>();
	const order: string[] = [];
	const seen = new Set<string>();
	const track = (id: string) => {
		if (!seen.has(id)) {
			seen.add(id);
			order.push(id);
		}
	};

	// Two global-regex scans plus a linear body scan, each first-wins into a map while
	// recording first-seen order.
	let m: RegExpExecArray | null;

	OPEN_RE.lastIndex = 0;
	while ((m = OPEN_RE.exec(doc))) {
		const [full, id] = m;
		if (id === undefined || full === undefined || masked(m.index)) continue;
		if (!opens.has(id)) opens.set(id, { from: m.index, to: m.index + full.length });
		track(id);
	}

	CLOSE_RE.lastIndex = 0;
	while ((m = CLOSE_RE.exec(doc))) {
		const [full, id] = m;
		if (id === undefined || full === undefined || masked(m.index)) continue;
		if (!closes.has(id)) closes.set(id, { from: m.index, to: m.index + full.length });
		track(id);
	}

	for (const body of scanBodies(doc, masked)) {
		if (!bodies.has(body.id)) bodies.set(body.id, body);
		track(body.id);
	}

	return order.map((id) => {
		const body = bodies.get(id);
		const data: CommentData = body ? body.data : { status: "open", thread: [], reactions: [] };
		const comment: ParsedComment = {
			id,
			author: data.author,
			createdAt: data.createdAt,
			status: data.status,
			quote: data.quote,
			codeLines: data.codeLines,
			thread: data.thread,
			reactions: data.reactions,
			open: opens.get(id) ?? null,
			close: closes.get(id) ?? null,
			body: body?.range ?? null,
		};
		if (body?.malformed) comment.malformed = body.malformed;
		if (body && body.unknownKeys.length > 0) comment.unknownKeys = body.unknownKeys;
		return comment;
	});
};

/**
 * Find every `<!--co:ID …-->` block with plain string scanning — no regex tail that
 * can backtrack across the document. Each block is classified as well formed or as
 * one of the MalformedReason shapes; see types.ts for what each means and why the
 * edit paths care.
 */
const scanBodies = (doc: string, masked: (index: number) => boolean): BodyMatch[] => {
	const out: BodyMatch[] = [];
	let cursor = 0;
	// Openers are visited in order, so a terminator found for one opener is reusable
	// by the next until it is passed, and once none is found none will be. Without
	// this, thousands of unterminated openers would each rescan to the end of file.
	let nextTerminator = -2;
	const terminatorAfter = (from: number): number => {
		if (nextTerminator === -1) return -1;
		if (nextTerminator < from) nextTerminator = doc.indexOf(TERMINATOR, from);
		return nextTerminator;
	};
	for (;;) {
		const start = doc.indexOf(BODY_OPEN, cursor);
		if (start < 0) break;
		let idEnd = start + BODY_OPEN.length;
		while (idEnd < doc.length && ID_CHAR.test(doc.charAt(idEnd))) idEnd++;
		const id = doc.slice(start + BODY_OPEN.length, idEnd);
		cursor = idEnd;
		if (!id || masked(start)) continue;

		const firstTerminator = terminatorAfter(idEnd);
		const newline = doc.indexOf("\n", idEnd);
		if (firstTerminator < 0) {
			const headerEnd = newline < 0 ? doc.length : newline;
			out.push(bodyMatch(id, null, doc.slice(idEnd, headerEnd), "", "unterminated"));
			cursor = headerEnd;
			continue;
		}

		if (newline < 0 || firstTerminator < newline) {
			// The terminator sits on the header line.
			const lineEnd = newline < 0 ? doc.length : newline;
			if (doc.slice(firstTerminator + TERMINATOR.length, lineEnd).trim() === "") {
				// `<!--co:ID header-->` on one line: a legitimate empty body.
				const to = firstTerminator + TERMINATOR.length;
				out.push(bodyMatch(id, { from: start, to }, doc.slice(idEnd, firstTerminator), ""));
				cursor = to;
				continue;
			}
			// A `-->` inside the header text — a quote that copied another comment's
			// markers. Read the block the tolerant way the plugin always has (whole header
			// line, thread until the next terminator after it) and flag it.
			const end = doc.indexOf(TERMINATOR, lineEnd + 1);
			if (end < 0) {
				const to = firstTerminator + TERMINATOR.length;
				out.push(bodyMatch(id, { from: start, to }, doc.slice(idEnd, lineEnd), "", "terminator-in-header"));
				cursor = to;
				continue;
			}
			const to = end + TERMINATOR.length;
			out.push(
				bodyMatch(
					id,
					{ from: start, to },
					doc.slice(idEnd, lineEnd),
					doc.slice(lineEnd + 1, end),
					"terminator-in-header",
				),
			);
			cursor = to;
			continue;
		}

		const header = doc.slice(idEnd, newline);
		const end = firstTerminator;
		const block = doc.slice(newline + 1, end);
		const to = end + TERMINATOR.length;
		let malformed: MalformedReason | undefined;
		const terminatorLineStart = doc.lastIndexOf("\n", end - 1) + 1;
		if (doc.slice(terminatorLineStart, end).trim() !== "") malformed = "terminator-in-text";
		else if (MARKER_IN_BLOCK_RE.test(block)) malformed = "overrun";
		out.push(bodyMatch(id, { from: start, to }, header, block, malformed));
		// An overrun block swallowed at least one later comment's opener. Resume the
		// scan inside it so that comment is still parsed (and stays editable).
		cursor = malformed === "overrun" ? newline + 1 : to;
	}
	return out;
};

const bodyMatch = (
	id: string,
	range: TextRange | null,
	header: string,
	block: string,
	malformed?: MalformedReason,
): BodyMatch => {
	const { data, unknownKeys } = parseHeader(header);
	const { thread, reactions } = parseBody(block);
	const match: BodyMatch = { id, range, data: { ...data, thread, reactions }, unknownKeys };
	if (malformed) match.malformed = malformed;
	return match;
};

/** Every body range carrying `id`, including duplicate copies the first-wins parse
 *  ignores — so a delete can remove all of them. Masked (code) regions are skipped. */
export const allBodyRanges = (doc: string, id: string): TextRange[] => {
	const masks = maskedRanges(doc);
	return scanBodies(doc, (index) => isInside(masks, index))
		.filter((body) => body.id === id && body.range !== null)
		.map((body) => body.range as TextRange);
};

/** The set of ids already present in a document, for id generation. Unlike
 *  parseComments this does NOT mask code: an id used only inside a fenced example
 *  must still never be handed out, or deleting the live comment would rewrite the
 *  example (and vice versa). */
export const existingIds = (doc: string): Set<string> => {
	const ids = new Set<string>();
	for (const re of [OPEN_RE, CLOSE_RE, /<!--co:([A-Za-z0-9]+)/g]) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(doc))) if (m[1]) ids.add(m[1]);
	}
	return ids;
};

/** A comment is anchored when both markers are present and ordered. */
export const isAnchored = (c: ParsedComment): boolean => {
	return !!c.open && !!c.close && c.open.to <= c.close.from;
};

/** A comment-free highlight has a body block but no thread entries. */
export const isHighlight = (c: ParsedComment): boolean => {
	return !!c.body && c.thread.length === 0;
};

/** Anchor markers with no body block — usually a half-deleted comment. It still
 *  highlights, so it needs to be reachable from the sidebar to be removed. */
export const isMarkerOnly = (c: ParsedComment): boolean => {
	return !c.body && isAnchored(c);
};

/** A comment card requires a body. Its thread can be empty. */
export const hasCommentCard = (c: ParsedComment): boolean => {
	return !!c.body;
};

/** A floating margin card needs a body plus a valid text anchor.
 * Orphaned threads remain available in the sidebar, where no anchor is needed. */
export const hasMarginAnchor = (c: ParsedComment): boolean => {
	return hasCommentCard(c) && isAnchored(c);
};

/** The highlighted text range (between the markers), or null if not anchored. */
export const anchorRange = (c: ParsedComment): TextRange | null => {
	if (!c.open || !c.close || c.open.to > c.close.from) return null;
	return { from: c.open.to, to: c.close.from };
};

/** Has content (a body) but is not properly anchored — show in the unanchored list. */
export const isOrphan = (c: ParsedComment): boolean => {
	return !!c.body && !isAnchored(c);
};

/** True when a rewrite or delete of this comment would touch text that is not its
 *  own. `terminator-in-header` is excluded: rewriting it is how it gets repaired. */
export const isUneditable = (c: ParsedComment): boolean => {
	return c.malformed !== undefined && c.malformed !== "terminator-in-header";
};

/** Human-readable explanation of a malformed block, shown on the card and in the
 *  Notice when an edit is refused. */
export const malformedMessage = (reason: MalformedReason): string => {
	switch (reason) {
		case "unterminated":
			return "This comment block has no closing --> anywhere after it. Add one on its own line in the note's source; the plugin won't edit it until then.";
		case "terminator-in-header":
			return "This comment's header contains -->, so other apps show its thread as visible text. Saving any change (a reply, resolve, reaction) repairs it.";
		case "terminator-in-text":
			return "This comment block ends early at a --> typed inside it, so the rest of its thread is showing as note text. Break that arrow in the source (the plugin writes --​> with a zero-width space); edits are disabled until then.";
		case "overrun":
			return "This comment block has no closing --> of its own and runs into the next comment. Add --> on its own line where it should end; edits are disabled until then.";
	}
};

type HeaderParse = { data: Omit<CommentData, "thread" | "reactions">; unknownKeys: string[] };

/** Tokenize `key:value key:"quoted value"` pairs with a single left-to-right pass.
 *  Later duplicates win, matching the regex this replaces. */
const parseHeader = (header: string): HeaderParse => {
	const attrs = new Map<string, string>();
	const unknownKeys: string[] = [];
	const n = header.length;
	let i = 0;
	const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\r";
	while (i < n) {
		while (i < n && isSpace(header.charAt(i))) i++;
		if (i >= n) break;
		let k = i;
		while (k < n && /[A-Za-z0-9_-]/.test(header.charAt(k))) k++;
		if (k === i || header.charAt(k) !== ":") {
			// Not a key:value token — skip the word.
			while (i < n && !isSpace(header.charAt(i))) i++;
			continue;
		}
		const key = header.slice(i, k);
		const v = k + 1;
		let value: string;
		if (header.charAt(v) === '"') {
			const close = header.indexOf('"', v + 1);
			if (close < 0) {
				value = header.slice(v + 1);
				i = n;
			} else {
				value = header.slice(v + 1, close);
				i = close + 1;
			}
		} else {
			let e = v;
			while (e < n && !isSpace(header.charAt(e))) e++;
			value = header.slice(v, e);
			i = e;
		}
		attrs.set(key, value);
		if (!KNOWN_HEADER_KEYS.has(key) && !unknownKeys.includes(key)) unknownKeys.push(key);
	}
	const status: CommentStatus = attrs.get("status") === "resolved" ? "resolved" : "open";
	const codeLines = parseLineRange(attrs.get("line"));
	// A code comment's quote is stored encoded (exact); a prose quote is stored
	// already-collapsed, so it's used verbatim.
	const rawQuote = attrs.get("quote");
	const quote = rawQuote === undefined ? undefined : codeLines ? decodeCodeQuote(rawQuote) : rawQuote;
	return {
		data: {
			author: attrs.get("by"),
			createdAt: attrs.get("at"),
			status,
			quote,
			codeLines,
		},
		unknownKeys,
	};
};

/** Parse a `line:F-T` (or `line:F`) header value into an inclusive line range. */
const parseLineRange = (value: string | undefined): TextRange | undefined => {
	if (!value) return undefined;
	const match = /^(\d+)(?:-(\d+))?$/.exec(value);
	if (!match || match[1] === undefined) return undefined;
	const from = Number(match[1]);
	const to = match[2] !== undefined ? Number(match[2]) : from;
	return to >= from ? { from, to } : undefined;
};

/** Fenced code-block ranges (``` or ~~~), from the opening fence to the closing
 *  fence line. Per CommonMark the closing fence must use the same character, be at
 *  least as long as the opener, and carry no info string; an unclosed fence runs to
 *  the end of the document. Indentation is deliberately NOT capped at three spaces:
 *  the plugin doesn't track list nesting, and a fence inside a list item is indented
 *  further than that — masking too much hides a comment, masking too little parses
 *  markers inside code. */
export const fencedRanges = (doc: string): Array<[number, number]> => {
	const ranges: Array<[number, number]> = [];
	let offset = 0;
	let fenceStart = -1;
	let fenceChar = "";
	let fenceLength = 0;
	for (const line of doc.split("\n")) {
		const lineEnd = offset + line.length;
		const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
		if (fenceStart < 0 && marker) {
			fenceStart = offset;
			fenceChar = marker[1]?.charAt(0) ?? "";
			fenceLength = marker[1]?.length ?? 0;
		} else if (
			fenceStart >= 0 &&
			marker &&
			marker[1]?.charAt(0) === fenceChar &&
			(marker[1]?.length ?? 0) >= fenceLength &&
			(marker[2] ?? "").trim() === ""
		) {
			ranges.push([fenceStart, lineEnd]);
			fenceStart = -1;
		}
		offset = lineEnd + 1;
	}
	if (fenceStart >= 0) ranges.push([fenceStart, doc.length]);
	return ranges;
};

/** True when `pos` sits inside a fenced code block — anchoring a comment there
 *  would write literal marker text into the code, so creation refuses it. */
export const isInFencedCode = (doc: string, pos: number): boolean => {
	return isInside(fencedRanges(doc), pos);
};

/** The leading YAML frontmatter block (`---` … `---`), or null. Anchoring a comment
 *  inside it would rewrite frontmatter values with marker text. */
export const frontmatterRange = (doc: string): TextRange | null => {
	if (!doc.startsWith("---\n") && !doc.startsWith("---\r\n")) return null;
	let offset = doc.indexOf("\n") + 1;
	while (offset < doc.length) {
		let lineEnd = doc.indexOf("\n", offset);
		if (lineEnd < 0) lineEnd = doc.length;
		const line = doc.slice(offset, lineEnd).replace(/\r$/, "");
		if (line === "---" || line === "...") return { from: 0, to: lineEnd };
		offset = lineEnd + 1;
	}
	return null;
};

/** Ranges that should be ignored when scanning for markers: fenced and inline code. */
export const maskedRanges = (doc: string): Array<[number, number]> => {
	const ranges = fencedRanges(doc);

	// Inline code spans. Safe: the two classes (` and [^`\n]) are disjoint, so the
	// adjacent quantifiers never compete for the same character.
	const inline = /`+[^`\n]*`+/g;
	let m: RegExpExecArray | null;
	while ((m = inline.exec(doc))) ranges.push([m.index, m.index + m[0].length]);

	return ranges;
};

export const isInside = (ranges: Array<[number, number]>, index: number): boolean => {
	return ranges.some(([from, to]) => index >= from && index < to);
};

/** One thread line → entry, or null when the line is a continuation of the
 *  previous entry. Strict single-token grammar first; then the legacy multi-word
 *  author shape, tightly bounded so prose with a colon in it never wins. */
export const parseThreadLine = (line: string): ThreadEntry | null => {
	const strict = STRICT_ENTRY_RE.exec(line);
	if (strict && strict[1] !== undefined) {
		return { author: strict[1], timestamp: strict[2] || undefined, text: unescapeText(strict[3] ?? "") };
	}
	const separator = line.indexOf(": ");
	const head = separator > 0 ? line.slice(0, separator) : line.endsWith(":") ? line.slice(0, -1) : null;
	if (head === null || head.length === 0) return null;
	const text = separator > 0 ? line.slice(separator + 2) : "";
	const stamped = /^(.*) \(([^()]*)\)$/.exec(head);
	const author = stamped?.[1] ?? head;
	const timestamp = stamped?.[2];
	if (author.length > LEGACY_AUTHOR_MAX || !LEGACY_AUTHOR_RE.test(author)) return null;
	return { author, timestamp: timestamp || undefined, text: unescapeText(text) };
};

const parseBody = (block: string): { thread: ThreadEntry[]; reactions: Reaction[] } => {
	const thread: ThreadEntry[] = [];
	const reactions: Reaction[] = [];
	for (const raw of block.split("\n")) {
		// Strip only a trailing CR (CRLF files) — trailing spaces inside an entry
		// are meaningful and survive because newlines are escaped, not folded.
		const line = raw.replace(/\r$/, "");
		if (line.trim() === "") continue;

		if (line.startsWith("+")) {
			const rx = REACTION_LINE_RE.exec(line);
			if (rx && rx[2] !== undefined && rx[3] !== undefined) {
				const entry = rx[1] === undefined ? undefined : Number(rx[1]);
				const reaction = { emoji: rx[2], authors: splitReactionAuthors(rx[3]) };
				reactions.push(entry === undefined ? reaction : { ...reaction, entry });
				continue;
			}
		}

		const entry = parseThreadLine(line);
		const last = thread[thread.length - 1];
		if (entry) {
			thread.push(entry);
		} else if (last) {
			// Continuation line — fold into the previous entry.
			last.text += "\n" + unescapeText(line);
		} else {
			thread.push({ author: "", text: unescapeText(line) });
		}
	}
	return { thread, reactions };
};
