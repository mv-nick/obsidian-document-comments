#!/usr/bin/env python3
"""Validate Document Comments markers in a Markdown file.

Applies the same rules the plugin's parser uses, and flags the ways comments
silently break:

  INVALID ID     an id with a character outside [A-Za-z0-9] — the parser
                 discards the marker and the comment never renders
  MARKERS-ONLY   anchor markers with no body block (a half-deleted comment)
  SUGGESTION/…   an anchored comment whose first body line is `=>: proposal`
                 (replace, delete or insert); informational, not a problem
  MALFORMED      a body block that is not the shape the plugin writes:
                   unterminated          no --> anywhere after <!--co:
                   terminator-in-header  a --> on the header line (usually a
                                         quote that copied another comment's
                                         markers); HTML renderers show the
                                         thread as visible text
                   terminator-in-text    the block ends at a --> typed inside
                                         an entry; the rest of the thread is
                                         visible prose, and resolving or
                                         deleting the comment would strand it
                   overrun               no --> of its own; the block runs into
                                         the next comment's markers

Usage:
    python3 validate_comments.py FILE.md [FILE.md ...]

Exit status is non-zero if any definite problem is found, so it can gate an
agent's work. Scanning is plain string search — no regular expression runs over
the whole document — so a hostile or corrupt file cannot make it hang.
No third-party dependencies — Python 3 standard library only.
"""

import re
import sys

VALID_ID = re.compile(r"^[A-Za-z0-9]+$")
# Loose scans for the anchor markers: capture whatever the author actually wrote
# as the id token, so a malformed marker the strict parser would ignore is reported.
OPEN_LOOSE = re.compile(r"<!--c:([^\s>]*)-->")
CLOSE_LOOSE = re.compile(r"<!--/c:([^\s>]*)-->")
KNOWN_HEADER_KEYS = {"by", "at", "status", "quote", "line"}
# `author: text` / `author (timestamp): text`, single-token author, colon followed by
# a space or end of line. Same grammar as the plugin's parse.ts.
STRICT_ENTRY = re.compile(r"^([^\s:()]+)(?: \(([^()\r\n]*)\))?:(?: (.*))?$")
LEGACY_AUTHOR = re.compile(r"^[^\W_][\w-]*(?: [^\W_][\w-]*){0,3}$")
MARKER_IN_BLOCK = re.compile(r"<!--(?:/?c:[A-Za-z0-9]+-->|co:[A-Za-z0-9]+(?:[ \t\r\n]|$))")


def masked_spans(doc):
    """Character ranges to ignore: fenced code blocks and inline code spans.

    Closing fences follow CommonMark: same character, at least as long as the
    opener, no info string. An unclosed fence runs to the end of the document."""
    spans = []
    offset = 0
    fence_start = -1
    fence_char = ""
    fence_len = 0
    for line in doc.split("\n"):
        line_end = offset + len(line)
        m = re.match(r"[ \t]*(`{3,}|~{3,})(.*)$", line)
        if fence_start < 0 and m:
            fence_start, fence_char, fence_len = offset, m.group(1)[0], len(m.group(1))
        elif (
            fence_start >= 0
            and m
            and m.group(1)[0] == fence_char
            and len(m.group(1)) >= fence_len
            and not m.group(2).strip()
        ):
            spans.append((fence_start, line_end))
            fence_start = -1
        offset = line_end + 1
    if fence_start >= 0:
        spans.append((fence_start, len(doc)))
    cursor = 0
    while True:
        start = doc.find("`", cursor)
        if start < 0:
            break
        run = start
        while run < len(doc) and doc[run] == "`":
            run += 1
        ticks = run - start
        line_end = doc.find("\n", run)
        if line_end < 0:
            line_end = len(doc)
        close = doc.find("`" * ticks, run, line_end)
        if close < 0:
            cursor = run
            continue
        end = close + ticks
        spans.append((start, end))
        cursor = end
    return spans


def is_masked(spans, index):
    return any(a <= index < b for a, b in spans)


def parse_header(header):
    """key:value / key:"quoted value" pairs, one left-to-right pass."""
    attrs, unknown = {}, []
    i, n = 0, len(header)
    while i < n:
        while i < n and header[i] in " \t\r":
            i += 1
        if i >= n:
            break
        k = i
        while k < n and (header[k].isalnum() or header[k] in "_-"):
            k += 1
        if k == i or k >= n or header[k] != ":":
            while i < n and header[i] not in " \t":
                i += 1
            continue
        key = header[i:k]
        v = k + 1
        if v < n and header[v] == '"':
            close = header.find('"', v + 1)
            if close < 0:
                value, i = header[v + 1 :], n
            else:
                value, i = header[v + 1 : close], close + 1
        else:
            e = v
            while e < n and header[e] not in " \t":
                e += 1
            value, i = header[v:e], e
        attrs[key] = value
        if key not in KNOWN_HEADER_KEYS and key not in unknown:
            unknown.append(key)
    return attrs, unknown


def parse_entry(line):
    """A thread entry (author, timestamp, text) or None for a continuation line."""
    m = STRICT_ENTRY.match(line)
    if m:
        return m.group(1), m.group(2), m.group(3) or ""
    sep = line.find(": ")
    head = line[:sep] if sep > 0 else (line[:-1] if line.endswith(":") else None)
    if not head:
        return None
    text = line[sep + 2 :] if sep > 0 else ""
    stamped = re.match(r"^(.*) \(([^()]*)\)$", head)
    author = stamped.group(1) if stamped else head
    if len(author) > 32 or not LEGACY_AUTHOR.match(author):
        return None
    return author, (stamped.group(2) if stamped else None), text


def scan_bodies(doc, spans, problems):
    """Every <!--co:ID …--> block, classified like the plugin's scanBodies."""
    bodies = []
    cursor = 0
    next_term = -2
    while True:
        start = doc.find("<!--co:", cursor)
        if start < 0:
            break
        id_start = start + len("<!--co:")
        id_end = id_start
        while id_end < len(doc) and doc[id_end] not in " \t\r\n>-":
            id_end += 1
        raw = doc[id_start:id_end]
        cursor = id_end
        if is_masked(spans, start):
            continue
        if not VALID_ID.match(raw):
            problems.append(("body", raw, doc[start : start + 40]))
            continue
        if next_term != -1 and next_term < id_end:
            next_term = doc.find("-->", id_end)
        first_term = next_term
        newline = doc.find("\n", id_end)
        header_end = newline if newline >= 0 else len(doc)

        if first_term < 0:
            bodies.append((raw, doc[id_start - 0 : id_start], doc[id_end:header_end], "", "unterminated", start))
            cursor = header_end
            continue

        if newline < 0 or first_term < newline:
            line_end = header_end
            if not doc[first_term + 3 : line_end].strip():
                bodies.append((raw, None, doc[id_end:first_term], "", None, start))
                cursor = first_term + 3
                continue
            end = doc.find("-->", line_end + 1)
            block = doc[line_end + 1 : end] if end >= 0 else ""
            bodies.append((raw, None, doc[id_end:line_end], block, "terminator-in-header", start))
            cursor = (end + 3) if end >= 0 else (first_term + 3)
            continue

        header = doc[id_end:newline]
        block = doc[newline + 1 : first_term]
        term_line_start = doc.rfind("\n", 0, first_term) + 1
        reason = None
        if doc[term_line_start:first_term].strip():
            reason = "terminator-in-text"
        elif MARKER_IN_BLOCK.search(block):
            reason = "overrun"
        bodies.append((raw, None, header, block, reason, start))
        cursor = first_term + 3
    return bodies


def analyze(doc):
    spans = masked_spans(doc)
    opens, closes, bodies, problems = {}, {}, {}, []

    def scan(rx, kind):
        for m in rx.finditer(doc):
            if is_masked(spans, m.start()):
                continue
            raw = m.group(1)
            if not VALID_ID.match(raw):
                problems.append((kind, raw, m.group(0)[:40]))
                continue
            yield raw, m

    for rid, m in scan(OPEN_LOOSE, "open"):
        opens.setdefault(rid, m.start())
    for rid, m in scan(CLOSE_LOOSE, "close"):
        closes.setdefault(rid, m.start())
    for rid, _, header, block, reason, start in scan_bodies(doc, spans, problems):
        bodies.setdefault(rid, (header, block, reason, start))

    ids = []
    for i in list(opens) + list(closes) + list(bodies):
        if i not in ids:
            ids.append(i)

    comments = []
    for cid in ids:
        has_open, has_close = cid in opens, cid in closes
        has_body = cid in bodies
        anchored = has_open and has_close and opens[cid] <= closes[cid]
        header, block, reason = (bodies[cid][0], bodies[cid][1], bodies[cid][2]) if has_body else ("", "", None)
        attrs, unknown = parse_header(header)
        lines = [ln.rstrip("\r") for ln in block.split("\n") if ln.strip() and not ln.startswith("+")]
        parsed = [parse_entry(ln) for ln in lines]
        entries = [e for e in parsed if e]
        # A first entry by the reserved author `=>` is a suggestion's proposal.
        suggestion = bool(parsed) and parsed[0] is not None and parsed[0][0] == "=>"
        if reason:
            state = "MALFORMED"
        elif suggestion and anchored:
            proposal = parsed[0][2]
            kind = "insert" if opens[cid] + len(f"<!--c:{cid}-->") == closes[cid] else ("delete" if proposal == "" else "replace")
            state = f"SUGGESTION/{kind}"
        elif suggestion:
            state = "ORPHAN"
        elif anchored and has_body:
            state = "HIGHLIGHT" if not block.strip() else "ANCHORED"
        elif has_body:
            state = "ORPHAN"
        else:
            state = "MARKERS-ONLY"
        comments.append(
            {
                "id": cid,
                "state": state,
                "reason": reason,
                "status": ("resolved" if attrs.get("status") == "resolved" else "open") if has_body else "-",
                "quote": attrs.get("quote", ""),
                "unknown": unknown,
                "entries": len(entries),
            }
        )
    return comments, problems


REASON_HINT = {
    "unterminated": "no closing --> after this block; add one on its own line where the thread ends",
    "terminator-in-header": "a --> on the header line (a quote holding another comment's markers?); other renderers show the thread as text — break it as --​> (zero-width space) or let the plugin re-save the comment",
    "terminator-in-text": "the block ends at a --> typed inside an entry; the rest of the thread is visible prose — break that arrow as --​> (zero-width space). Do NOT resolve or delete the comment until then",
    "overrun": "no --> of its own; the block runs into the next comment — add --> on its own line where the thread ends. Do NOT delete the comment until then",
}


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    any_problem = False
    for path in argv[1:]:
        try:
            with open(path, encoding="utf-8") as fh:
                doc = fh.read()
        except OSError as err:
            print(f"{path}: cannot read ({err})")
            any_problem = True
            continue

        comments, problems = analyze(doc)
        print(f"\n{path} — {len(comments)} comment(s)")
        for c in comments:
            note = ""
            if c["state"] == "ORPHAN":
                note = "  (body has no valid anchor — the commented text was likely edited away)"
            elif c["state"] == "MARKERS-ONLY":
                note = "  (anchor markers but no body block)"
            elif c["state"] == "MALFORMED":
                note = f"  ({c['reason']}: {REASON_HINT[c['reason']]})"
            if c["unknown"]:
                note += f"  unrecognised header field(s): {', '.join(c['unknown'])}"
            quote = f'  "{c["quote"][:60]}"' if c["quote"] else ""
            print(f"  {c['state']:<13} {c['id']:<10} status:{c['status']:<9}{quote}{note}")

        for kind, raw, snippet in problems:
            any_problem = True
            print(
                f"  INVALID ID   in {kind} marker: {snippet!r} — "
                f'id "{raw}" has characters outside [A-Za-z0-9]; the parser ignores this marker'
            )

        marker_only = [c for c in comments if c["state"] == "MARKERS-ONLY"]
        malformed = [c for c in comments if c["state"] == "MALFORMED"]
        orphans = [c for c in comments if c["state"] == "ORPHAN"]
        if marker_only or malformed:
            any_problem = True
        if orphans:
            print(f"  note: {len(orphans)} orphan(s) — fine if the text was intentionally removed, else a broken comment")

    print()
    if any_problem:
        print("PROBLEMS FOUND — fix the flagged markers above.")
        return 1
    print("OK — all comments are well-formed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
