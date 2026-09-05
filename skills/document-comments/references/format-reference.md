# Document Comments — full format reference

The complete on-disk format. Read this for edge cases beyond the common
create/reply/resolve/delete flow in `SKILL.md`.

## Contents

- [The three markers](#the-three-markers)
- [IDs](#ids)
- [Body header keys](#body-header-keys)
- [Thread lines](#thread-lines)
- [Reactions](#reactions)
- [Escaping: `-->`, newlines, quotes](#escaping)
- [Placement](#placement)
- [Comment states](#comment-states)
- [Comments on code blocks](#comments-on-code-blocks)
- [Parser behavior and gotchas](#parser-behavior)

## The three markers

| Piece | Syntax | Where |
|---|---|---|
| Anchor open | `<!--c:ID-->` | Immediately before the commented text. |
| Anchor close | `<!--/c:ID-->` | Immediately after the commented text. |
| Body | `<!--co:ID <header>` `\n` `<thread…>` `\n` `-->` | After the block holding the anchor. |

The highlighted span is the text **between** the open and close markers. The body
is one block per comment, linked to the anchor by a shared ID.

## IDs

- Grammar: `[A-Za-z0-9]+` — ASCII letters and digits only. No `-`, `_`, `.`,
  spaces, or other characters. A character outside this set ends the ID early and
  breaks the marker (see SKILL.md for why this fails so quietly).
- The plugin generates 5 random lowercase base-36 characters (`a–z0–9`). Match
  that: 4–6 lowercase alphanumerics is a good default.
- Must be unique within the file. The parser keeps only the **first** occurrence
  of a given ID's open marker, close marker, and body — a duplicated ID silently
  drops the later ones. Before assigning an ID, scan existing `<!--c:` and
  `<!--co:` markers to avoid collisions (including collisions created by writing
  invalid IDs that truncate to the same prefix).

## Body header keys

The header is the first line of the body block, after `co:ID`. Keys are
`key:value`, space-separated, in any order. The canonical order the plugin writes
is `by at status quote`:

| Key | Meaning | Notes |
|---|---|---|
| `by:` | Author handle | Single token; whitespace becomes `_`. Optional. |
| `at:` | Creation timestamp | ISO-8601, e.g. `2026-01-15T10:00:00.000Z`. Optional. |
| `status:` | `open` or `resolved` | Anything other than `resolved` is treated as `open`. |
| `quote:` | Copy of the anchored text | Double-quoted. The re-anchor fallback. |

`quote:` value handling: internal whitespace is collapsed to single spaces and
`"` becomes `'`, so the stored quote is a normalized single-line copy — it does
not have to be byte-identical to the anchored text, but it should clearly be the
same text.

Unrecognized header keys are ignored, and are dropped if the plugin ever
rewrites the block, so don't rely on custom keys.

## Thread lines

Each line between the header and the closing `-->` is one entry. The first entry
is the original comment; the rest are replies in order.

A body with no thread lines represents an empty comment.

Grammar per line: `author: text` or `author (timestamp): text`.

```
alice: Looks good to me.
bob (2026-01-15T11:00:00.000Z): Merging then.
```

- The author is a **single token**: no spaces, `:`, `(` or `)`. The plugin writes
  authors that way (`Kyle_McDonald`), the same normalization the `by:` header gets.
  The colon after the author (or after the `(timestamp)`) must be followed by a
  space or end the line. So `11:11 Today`, `http://…`, and a sentence that happens
  to contain a colon are **not** entries — they are continuation lines.
- Legacy multi-word authors (`Kyle McDonald: hi`, up to four plain words) are
  still read, but don't write new ones.
- A line that isn't an entry is folded into the previous entry's text (a
  continuation); prefer the explicit escaping below for multi-line text, since a
  continuation line is fragile and looks like prose to other tools.
- A first entry whose author is the reserved token `=>` is a **suggestion's
  proposal**, not a message — see [Suggestions](#suggestions).

## Reactions

Emoji reactions are stored as their own lines in the body, after the thread,
prefixed with `+`:

```
+👍 alice, bob
+🎉 carol
```

Grammar: `+EMOJI author1, author2, …`. Authors are comma-separated. A reaction
with no authors is dropped.

## Escaping

The body is a single HTML comment, so a few sequences need care. <a id="escaping"></a>

- **`-->`** must never appear literally inside the body (header or thread) — it
  ends the comment early. Break it with a zero-width space: write `--​>`
  (a U+200B between the second `-` and the `>`). It renders identically but no
  longer terminates the comment.
- **Newlines inside a single reply.** Entries are one physical line. To keep a
  literal newline inside a reply's text, encode it as a backslash escape:
  `\n` for a newline, `\r` for a carriage return, and `\\` for a literal
  backslash. On read, reverse it. (Single-line replies need none of this.)
- **Commas in a reaction author's name** are escaped as `\,` so they don't split
  the author list.

If you are hand-writing a normal single-line reply with plain text, none of this
applies — just avoid the literal `-->`.

## Placement

The body block goes on the line(s) immediately after the block (paragraph,
heading, or list item) that contains the anchor. This keeps the comment readable
in context in the raw file. The parser actually scans the whole document for
markers, so placement does not affect *whether* a comment is found — it's a
readability convention — but following it keeps files clean and diffs sensible.

Do not place the body **inside** the anchored paragraph or mid-sentence; put it
after the block.

## Comment states

- **Anchored**: both `<!--c:ID-->` and `<!--/c:ID-->` are present and ordered
  (open before close), and a body exists. This is a normal, rendered comment.
- **Highlight**: both anchor markers and a body exist, but the body has no thread
  lines. The plugin highlights the text and shows an editable **Empty** card.
- **Orphan**: a body exists but the anchor markers are missing or out of order —
  usually because the anchored text was edited or deleted. Orphans still hold
  their thread and show up in comment lists, but have nowhere to highlight.
- **Marker-only**: anchor markers with no body block. Rare; usually a
  half-deleted comment. The plugin lists these in its sidebar: replying gives them
  a body, deleting removes the highlight.
- **Malformed**: a body block that is not the shape the plugin writes. The plugin
  flags it on the card and refuses to rewrite or delete it (except
  `terminator-in-header`, which a rewrite repairs), because its reported range
  covers text that isn't the comment's own. `validate_comments.py` reports the
  same four reasons:
  - `unterminated` — no `-->` anywhere after `<!--co:`.
  - `terminator-in-header` — a `-->` on the header line, usually a `quote:` that
    copied another comment's markers verbatim. HTML renderers end the comment
    there and show the thread as visible text; the plugin still reads it whole.
  - `terminator-in-text` — the block ends at a `-->` typed inside an entry (an
    arrow, `A --> B`). Everything after it is visible prose. **Do not resolve or
    delete such a comment**; break the arrow with a zero-width space first.
  - `overrun` — no `-->` of its own; the block runs into the next comment's
    markers, and deleting it would delete the prose in between.

## Suggestions

A suggestion is a comment whose body's **first line** is a proposal by the
reserved author `=>`:

```
<!--co:ID by:nick at:… status:open quote:"ship on Friday"
=>: ship on Thursday
nick (…): QA asked for the extra day.
-->
```

| Case | Anchor | Proposal line |
|---|---|---|
| Replace | the text to change | `=>: new text` |
| Delete | the text to remove | `=>: ` (nothing after the colon; a trailing space is fine either way) |
| Insert | an empty range, `<!--c:ID--><!--/c:ID-->`, at the insertion point | `=>: text to insert` |

- The document body stays pre-suggestion. Every renderer, and the upstream
  plugin, shows the note unchanged; the fork shows the anchored text struck
  through with the proposal beside it, and offers Accept / Reject.
- **Accept** = replace `<!--c:ID-->…<!--/c:ID-->` (markers included) with the
  proposal and delete the body. **Reject** = delete the markers and body.
  Comments anchored inside an accepted range lose their anchors and become
  orphans; their threads remain.
- Only the **first** thread position counts. A later `=>:` line is an ordinary
  reply by an author called `=>`; a prose continuation line that starts with `=>`
  is never a proposal (it fails the single-token grammar).
- Proposals use the same escaping as replies: `\n` for newlines, and never a
  literal `-->`.
- Reaction indices in a suggestion's body are raw line positions, so the first
  discussion entry is `@1`, not `@0`; a reaction with no index (or `@0`) refers to
  the proposal line and is shown on the first entry.
- Two suggestions must not overlap; the plugin refuses to create one whose anchor
  touches another's. Suggestions inside fenced code blocks are not supported.
- `quote:` is omitted for an insertion (nothing to quote) and holds the anchored
  text otherwise, exactly as for a comment.

## Comments on code blocks

Markers cannot live **inside** a fenced code block: they render as literal text
and the parser masks (ignores) anything inside a fence. Two supported cases:

- **Inline code** (`` `like this` ``): put the markers *outside* the backticks,
  wrapping the whole inline-code token.
- **Fenced blocks**: wrap the entire block. Put `<!--c:ID-->` on its own line
  immediately before the opening fence and `<!--/c:ID-->` on its own line
  immediately after the closing fence, and add a `line:` key to the body giving
  the block-relative line range (0-based, inclusive) the comment targets:

  ```markdown
  <!--c:p7k2-->
  ` ``python
  def process(order):
      validate(order)
  ` ``
  <!--/c:p7k2-->
  <!--co:p7k2 by:agent status:open quote:"    validate(order)" line:1
  agent: should this run before logging?
  -->
  ```

  Here `line:1` targets the second content line of the block. The `quote:` holds
  the exact target lines and is the re-anchor key if the code shifts.

If you only need to leave a note about code and precise line-anchoring isn't
essential, commenting on a nearby prose sentence is simpler and more robust.

## Parser behavior

Concrete rules worth knowing when reading or repairing files:

- Markers are matched with these patterns (IDs are `[A-Za-z0-9]+`):
  - open: `<!--c:ID-->`
  - close: `<!--/c:ID-->`
  - body: `<!--co:ID <header>\n<body>-->` — found by plain string scanning: the
    header is the rest of the opener's line, the block runs to the first `-->`
    after that line, and that `-->` must sit on its own line for the block to be
    well formed (see Malformed above).
- Header keys the plugin doesn't know are shown on the card as "Unrecognised
  fields" and dropped when the block is rewritten. Don't use them to carry data,
  and mention any you find rather than acting on them.
- Markers **inside fenced code blocks (``` or ~~~) and inline code spans are
  ignored.** This lets a document show example comment syntax in a code block
  without it being parsed as real.
- For any ID, only the **first** open, first close, and first body are used;
  duplicates are ignored.
- A comment is "anchored" only if open and close are both present and
  `open` ends at or before `close` begins.
- The body's `quote:` is the re-anchor fallback: tools locate the commented text
  by the markers first, and fall back to searching for the quote if the markers
  are gone.

When in doubt, run `scripts/validate_comments.py` on the file — it applies these
same rules and reports the state of every comment.
