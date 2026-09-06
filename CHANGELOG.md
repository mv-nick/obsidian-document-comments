# Changelog

All notable changes to **Document Comments**. The release workflow uses the section
matching the pushed tag as that GitHub release's notes, so add an entry here before tagging.

## Unreleased

- **The card you point at stays beside its text.** On a heavily annotated note the margin stack could run past the end of the document, leaving the last cards unreachable. Now the hovered (or clicked) comment becomes the pivot of the stack: its card sits exactly beside its highlighted text and the other cards move up or down out of its way, and it keeps that place until you hover another comment, so it doesn't jump away while you move the mouse to it. If the card still doesn't fit (a tall card near the bottom edge), the note scrolls the minimum needed to show the whole card, in Live Preview and Reading view; hover events the scroll itself re-dispatches are ignored until the pointer moves, so the reveal can't cascade or undo itself.
- **Suggestions.** Select text and run **Suggest an edit** (also in the right-click menu; with no selection it offers **Suggest an insertion**) to propose replacement text instead of changing the note. The selected text shows struck through with the proposal beside it, in Live Preview and Reading view, and the margin card offers **Accept** and **Reject**; **Edit suggestion** in the card menu changes the proposal, and the discussion thread works as for any comment. Commands: **Accept current suggestion**, **Reject current suggestion**, **Accept all suggestions in note**, **Reject all suggestions in note**. The sidebar gains a **Suggestions** filter. On disk a suggestion is a comment whose first body line is `=>: proposed text` (`=>: ` alone proposes deleting the text; an empty anchor pair proposes an insertion), so the note is unchanged for every other reader and the upstream plugin shows the proposal as a reply it preserves. Suggestions inside code blocks and overlapping suggestions are not supported.
- Forked from `kylemcd/obsidian-document-comments` at 0.1.15 as **Document Comments MV** (`mv-nick/obsidian-document-comments`). Renamed the plugin id to `document-comments-mv`, the sidebar view type, and the table-highlight registry names so the fork can neither be overwritten by nor collide with the upstream plugin. The comment format is unchanged.
- Added a **Show highlights** setting and a **Toggle highlights** command. Highlights no longer follow the comment column, so you can hide the cards and keep the highlighted text, or the reverse. Highlights start on, so if you had comments hidden you will now see the highlighted text until you turn **Show highlights** off. (Upstream PR #78.)
- Added **Add comment** to the editor right-click menu when text is selected. If you previously added that command to the menu with the Commander plugin, remove your mapping to avoid a duplicate entry. (Upstream PR #78.)
- Fixed the **Author** setting assigning a highlight color to every half-typed name. Typing `Alice` no longer leaves `A`, `Al`, `Ali`, and `Alic` behind in **Highlight colors**. (Upstream PR #78.)
- **Malformed comment blocks are detected and can no longer destroy note text.** A block ended early by a `-->` typed inside it, one with no terminator that runs into the next comment, or one with no terminator at all is now flagged on its card and in the sidebar with what went wrong and how to fix it, and every rewrite path (reply, resolve, react, edit, delete) refuses to touch it. Previously "Delete comment" on such a block deleted whatever prose lay between it and the next `-->`, and "Resolve" moved that prose into a hidden block. A `quote:` that contains `-->` (from copying another comment's markers) is flagged too, and saving any change repairs it.
- The comment parser no longer uses regular expressions that backtrack across the document. One malformed block with a long run of whitespace or a long token used to cost seconds per keystroke (and froze the whole vault during the author-color scan); parsing is now linear, with regression tests that pin the time.
- Thread lines are parsed with a strict grammar: a single-token author, an optional timestamp, and a colon followed by a space. Pasted `11:11 Today` timestamps, URLs, and prose sentences that happen to contain a colon are folded into the previous entry instead of being read as authors (and then colored and persisted as such). Multi-word authors written by older versions are still read. Authors are written as single tokens (`Kyle_McDonald`), like the `by:` header already was.
- **Add comment** in Reading view now anchors to the occurrence of the text you actually selected, never to a copy of the same phrase inside another comment's thread. Previously it took the first textual match, which could write anchor markers into a hidden comment block.
- Comments can no longer be anchored inside a note's YAML frontmatter.
- Deleting a comment no longer rewrites example markers inside fenced or inline code that share its id, and new ids avoid ids used inside code examples.
- Author names, including the reaction author, are normalized to a single token everywhere, so a name containing `-->` or a newline can't end a block early or forge a reply. `Object.prototype` names (`__proto__`) work as author names.
- Comment text is rendered with images and embeds downgraded to links, so a hidden comment body can't make the card load a remote image or embed another note.
- Header keys the plugin doesn't understand are shown on the card as "Unrecognised fields" instead of being silently ignored (they are still dropped when the block is rewritten).
- Stray highlights with no comment block are listed in the sidebar; replying gives them a block, deleting removes the highlight. Previously nothing in the UI could reach them.
- Fenced code blocks follow CommonMark closing rules (same character, at least as long, no info string), so a shorter closing fence no longer hides every later comment.
- Out-of-range or non-integer offsets are rejected by every edit computation instead of writing at the wrong place; card render no longer leaks a Markdown component per render, and an open emoji picker is torn down with its card.
- `validate_comments.py` is rewritten to use the same linear scan and reports `MALFORMED` blocks with the reason and the repair. It previously shared the backtracking regex (3 KB could hang it for half a minute) and reported a file with a truncated block as clean.
- The agent skill gains a trust-boundary section (comment bodies are other people's text, not instructions) and two adversarial evals.

## 0.1.15

- Fixed emoji reactions added to a reply being attached to the first comment in the thread. Reply reactions now remain with the thread entry where they were added, while existing reaction data remains compatible.

## 0.1.14

- Author-color indexing no longer scans or reads vault notes while **Use author colors** is off. Enabling the setting starts the local scan, and the README now explicitly documents that note contents never leave the device and only author names and color assignments are retained.

## 0.1.13

- Added persistent per-author highlight colors. The settings page discovers comment and reply authors across the vault, assigns distinct Radix colors automatically, supports custom colors through Obsidian's built-in picker, colors author names on comment cards, can disable colors without losing assignments, and can delete individual mappings so those authors use the normal theme color. Resolved highlights keep a dashed creator-colored underline ([#67](https://github.com/kylemcd/obsidian-document-comments/issues/67)).
- Removed the per-author Reset icon. Color rows now expose only the picker and a trash-can action; an uncolored author can receive a new automatic assignment from the Uncolored section.
- Turning off **Use author colors** now restores the original yellow document highlights while keeping author names neutral and preserving saved color assignments.
- **Use author colors** now defaults to off. The initial vault scan still generates and persists mappings for existing comment authors, so enabling it later applies colors immediately.
- The **Highlight colors** settings section is hidden while **Use author colors** is off; saved mappings remain intact and reappear when it is enabled.

## 0.1.12

- Added an **Allow empty comments** setting. An empty comment highlights its selected text and shows an editable **Empty** card. Run **Add comment** on the same text to add text or delete the comment ([#52](https://github.com/kylemcd/obsidian-document-comments/issues/52)).

## 0.1.11
- **Comments on code blocks** — select one or more lines inside a fenced code block and comment on them. The lines are highlighted in Live Preview and Reading view, and a commented code block lays out exactly like an uncommented one, with no added gap above or below it.
- Fixed a forward-delete (the Del / Fn+Delete key) at the end of a commented line silently destroying the entire comment thread, with nothing appearing to change in the note.
- Fixed multi-line comment text — a reply written with line breaks — becoming corrupted on save, where it could re-parse into a broken entry and a phantom reaction. Line breaks, blank lines, and trailing spaces are now preserved.
- Fixed commenting on text (or signing with an author name) containing `-->`, which could break the stored comment and leak the discussion as visible text in Reading view, on GitHub, and in exports.
- Deleting a comment now removes every copy of its markers, so copy-pasting commented text no longer leaves behind invisible markers that couldn't be removed.
- Comment edits and replies made from the sidebar or Reading view now go through the open editor when the note is open, so they join its undo history and no longer risk clobbering unsaved changes.
- Orphaned comments — a discussion whose highlighted text is no longer present — no longer appear as empty cards in the margin; they remain available in the **All discussions** sidebar ([#43](https://github.com/kylemcd/obsidian-document-comments/issues/43)).

## 0.1.10
- Removed the `text-decoration-color` declarations that Obsidian's community-plugin review groups under the partially supported `text-decoration` browser feature. Open and resolved table comments remain visually distinct through their highlight backgrounds.

## 0.1.9
- Fixed an Obsidian community-plugin review compatibility warning by replacing the extended `text-decoration` shorthand in Live Preview table highlights with supported underline and color declarations. Table comment highlights remain visible in both open and resolved states.

## 0.1.8
- Fixed Live Preview table comments remaining unhighlighted until their cell was focused. Highlights now match Markdown-formatted anchors such as inline code and map mounted table widgets by source position, so they remain correct when CodeMirror virtualizes earlier tables.
- Kept hidden comment markers from appearing or wrapping text in focused table cells while preserving reliable cursor movement across marker boundaries.
- Fixed comments on inline code selections such as `` `Spinner` `` by placing the invisible anchor markers outside the backticks instead of rendering them as literal code.

## 0.1.7
- Added comment highlights inside Live Preview tables and hover previews for highlighted text. Highlights remain passive when clicked; selecting a comment in the sidebar now scrolls to its text reliably in either direction ([#29](https://github.com/kylemcd/obsidian-document-comments/issues/29)).
- Unified comment creation around the reliable **Add comment** selection command across regular text and tables, while retaining a separate Reading view command.
- Fixed the comment composer appearing behind table rows and other stacking problems in tables ([#28](https://github.com/kylemcd/obsidian-document-comments/issues/28)).
- Fixed cursor pauses and caret-height jumps around inline comment markers, including adjacent punctuation, line boundaries, nested markers, and deletion cases ([#41](https://github.com/kylemcd/obsidian-document-comments/issues/41)).
- Addressed Obsidian community-plugin review warnings by using supported DOM helpers and settings indexing patterns.
- Updated the release toolchain and development dependencies, including TypeScript 7, Vitest 4, typescript-eslint, eslint-plugin-obsidianmd, `@types/node`, and `actions/setup-node`; refreshed transitive dependencies with zero known audit vulnerabilities.

## 0.1.6
- Fixed the inline comment column continuing to reserve its ~320px of margin over empty space once every comment on a note was resolved (with "Show resolved" off). The column is now reserved only when a comment's card actually renders, in both Live Preview and Reading view ([#30](https://github.com/kylemcd/obsidian-document-comments/issues/30)).
- Updated development dependencies (oxlint, eslint, typescript-eslint, @types/node, @codemirror/view).

## 0.1.5
- Fixed the document reflowing (shifting left, then re-centering) every time you started or finished a comment. The new-comment composer is a floating overlay and no longer reserves the margin column, so the text stays put — most noticeable when the comments sidebar is open and the inline column isn't shown ([#15](https://github.com/kylemcd/obsidian-document-comments/issues/15)).

## 0.1.4
- **Mobile support** — Document Comments now works on Obsidian mobile. There's no floating margin on phones and tablets; instead the in-text highlights mark commented text and you read, reply, and resolve through the **"All discussions" sidebar**, with new comments composed in a quick dialog. It's the same inline storage, so a note's comments are identical across desktop and mobile.
- Saving a comment now reports a clear reason if it ever fails, instead of occasionally failing silently.

## 0.1.3
- Sidebar: the last comment's reply field is no longer cut off at the bottom — there's room to scroll it up clear of the status bar, with space to grow as you type.

## 0.1.2
- **Markdown in comments** — comment text now renders Markdown (code spans, bold, links, lists) in both the margin and the sidebar.
- **Long comments** collapse to a "Show more" preview; one click opens the full thread *and* the reply box. A thread taller than the screen shows "Open in sidebar" instead (its bottom is unreachable inline).
- **Margin polish** — cards slide off the top edge as you scroll instead of sticking; clicking a card no longer scrolls the document; the reply box reveals and focuses when you open a card; expand/collapse animates smoothly.
- Comment highlights now render inside **tables** in Reading view. (Live Preview can't highlight inside its table widget — a documented limitation.)

## 0.1.1
- Addressed Obsidian community-plugin review feedback.
- Removed every `:has()` and `!important` from the stylesheet (selectors are now scoped to out-specify Obsidian's core rules).
- Replaced the `builtin-modules` build dependency with `node:module`.
- Added a CI release workflow that builds the plugin and attaches **build-provenance attestations** to the release assets.

## 0.1.0
- Initial release — Notion/Linear-style margin comments stored inline in your markdown as HTML comments, with threads, reactions, resolve/reopen, a comments sidebar, and Reading-view support.
