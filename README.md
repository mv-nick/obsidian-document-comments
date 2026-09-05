# Document Comments MV

> **This is a fork** of [Kyle McDonald's Document Comments](https://github.com/kylemcd/obsidian-document-comments) (MIT), maintained by Nick at Macroscopic for our own vaults. It keeps the same on-disk comment format and is where **suggestions** (proposed edits you accept or reject in the margin) are being added. The plugin id is `document-comments-mv` so Obsidian's community updater never overwrites it with the upstream release; do not run both plugins on the same vault at once. It is not in the community directory: install with BRAT or manually (below). Contributing back upstream is not a goal of this fork.

Document Comments adds inline comments to Obsidian notes. It shows each comment as a card beside the text on desktop.

The plugin stores each comment inside its Markdown file as an HTML comment. Other editors, version control tools, and agents can read the comment.

![Document Comments with threaded comment cards beside an Obsidian note](screenshot.png)

## Features

### Comments and storage

- Store comments inside Markdown files without a separate database.
- Add comments to prose, inline code, tables, and selected lines in fenced code blocks.
- Save an empty comment and highlight its selected text.
- Reply, resolve, reopen, edit, delete, or react to a comment.
- Write Markdown in comments, including links, lists, bold text, and code spans.
- Use the same notes on desktop and mobile.

### Views and controls

- Show comment cards in Live Preview, Source view, and Reading view.
- Open long comments in the sidebar.
- Filter the sidebar by open, resolved, or all comments.
- Hide all comments or hide resolved comments.

## Comment format

The plugin uses an anchor pair and a comment block:

```markdown
We should <!--c:k3f9-->ship on Friday<!--/c:k3f9--> regardless of the QA timeline.
<!--co:k3f9 by:kyle at:2026-06-17T10:00:00.000Z status:open quote:"ship on Friday"
kyle (2026-06-17T10:00:00.000Z): I thought we agreed Thursday?
sam (2026-06-17T10:05:00.000Z): Thursday is better for QA.
-->
```

The `<!--c:ID-->` and `<!--/c:ID-->` markers identify the selected text. The matching `<!--co:ID ...-->` block stores the comment thread.

Reactions to the first comment use a line such as `+👍 kyle`. Reactions to replies include the reply's zero-based thread index, such as `+@1 👀 sam` for the first reply.

Markdown renderers hide these HTML comments. Tools that read the source file can find each comment and its selected text.

Comments on fenced code blocks use the same format. The comment block also stores the selected line range and exact code text.

An empty comment uses the same markers. Its comment block has no thread lines:

```markdown
We should <!--c:h7k2-->ship on Friday<!--/c:h7k2--> regardless of the QA timeline.
<!--co:h7k2 by:kyle at:2026-06-17T10:00:00.000Z status:open quote:"ship on Friday"
-->
```

## Install

Document Comments MV requires Obsidian 1.7.2 or newer. It supports desktop and mobile. It is not listed in the community plugin directory.

If you have the upstream **Document Comments** plugin enabled, disable it first: both plugins render the same markers and would double up.

### BRAT

1. Install and enable **BRAT** from Community plugins.
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter `mv-nick/obsidian-document-comments`.
4. Enable **Document Comments MV** in Community plugins.

BRAT installs the latest GitHub release of this fork and checks for updates.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mv-nick/obsidian-document-comments/releases).
2. Copy the files to `<your-vault>/.obsidian/plugins/document-comments-mv/`.
3. To keep your settings from the upstream plugin, copy its `data.json` into the same folder.
4. Restart or reload Obsidian, then enable **Document Comments MV** in Community plugins.

### Build from source

```bash
git clone https://github.com/mv-nick/obsidian-document-comments
cd obsidian-document-comments
npm ci --ignore-scripts
npm run build
```

Copy or link `main.js`, `manifest.json`, and `styles.css` to `<your-vault>/.obsidian/plugins/document-comments-mv/`, then enable **Document Comments MV** in Community plugins.

## Use the plugin

### Add a comment in an editing view

1. Select text or one or more lines in a fenced code block.
2. Run **Add comment** from the command palette or your configured editor menu.
3. Write the comment in the margin composer.
4. Press Enter to save the comment.

Press Shift+Enter to add a line break. On mobile, use the dialog to save the comment.

### Add an empty comment

Document Comments disables empty comments by default.

1. Open **Settings → Document Comments**.
2. Enable **Allow empty comments**.
3. Select text and run **Add comment**.
4. Leave the comment field empty.
5. Press Enter on desktop, or select **Empty comment** on mobile.

The plugin highlights the selected text and shows a comment card. The card shows **Empty** until you add text.

Select **Empty** to add the first comment text. Use the card menu to delete the empty comment.

You can also select all the highlighted text and run **Add comment** again. Write text to add the first comment. Submit the empty field to delete it.

When **Allow empty comments** is off, an empty field closes without a change.
Existing empty comments remain available. You can add text or delete them.

### Add the command to the right-click menu

The optional [Commander plugin](https://community.obsidian.md/plugins/cmdr) can add commands to the editor menu.

#### Install Commander

1. Install **Commander**.
2. Enable **Commander**.

#### Configure the editor menu

1. Open **Settings → Commander**.
2. Select **Editor Menu**.
3. Select **Add command**.
4. Search for `Document Comments: Add comment`.
5. Select the command.
6. Choose an icon.

The command now appears at the bottom of the editor right-click menu. Select text before you use it.

### Add a comment in Reading view

1. Select text in the active note.
2. Run **Add comment in reading view**.
3. Write the comment.
4. Save the comment.

The Reading view command cannot add comments to embedded content.

### Manage a comment

Select a card to open its reply field. Hover over an entry to show its reaction, resolve, edit, and delete controls.

Use the **Open comments sidebar** command or ribbon icon to show all comments in the active note.

Use **Toggle comments** to show or hide all cards and highlights. Use **Toggle resolved comments** to show or hide resolved comments.

### Set the author

Open **Settings → Document Comments**. Set **Author** to the name that the plugin adds to new comments.

The plugin uses `me` when the Author setting is empty.

### Set highlight colors

Enable **Use author colors** in **Settings → Document Comments** to reveal the **Highlight colors** section and see every person whose name appears in a comment thread. The setting is off by default, and the color section stays hidden while it is off. Use Obsidian's color picker to choose a custom color. The same color identifies each person in document highlights and beside their comments and replies. Turn the setting off to restore the original yellow document highlights and render names with the normal theme color without deleting any saved assignments.

Document Comments does not scan the vault for authors while **Use author colors** is off. Enabling it starts a local scan and assigns colors to existing comment authors; saved mappings apply immediately, and newly discovered authors appear as the scan completes. It uses a 12-color Radix palette without repeating a color until every palette color is in use. Generated and custom assignments are stored locally in the plugin's `data.json`; they do not change the Markdown comment format and do not need to be shared with collaborators.

Document Comments locally scans Markdown files for its comment markers to build the author-color list. Note contents never leave the device, and only author names and color assignments are stored in plugin data.

Resolved highlights keep the creator's color as a dashed underline. Creators whose highlights are no longer present remain listed under **Not currently found**, so their color returns if their comments reappear.

Use the trash-can button beside a person to remove their assignment. Deleted mappings are not automatically recreated; those people use the normal theme color and appear under **Uncolored**, where **Assign color** creates a new automatically generated color.

## Desktop and mobile behavior

Desktop views show cards in a margin beside the note. The cards align with their selected text and avoid overlaps.

Mobile views show the highlights without a margin. Use the sidebar to read and manage comments.

Mobile uses a dialog for new comments. The stored comment format stays the same on all devices.

## Agent support

This repository includes an agent skill for the Document Comments format:

```text
skills/document-comments/
```

The skill explains how to read and edit comments without damaging their markers. It also includes a validation script:

```bash
python3 skills/document-comments/scripts/validate_comments.py path/to/file.md
```

## Privacy

The plugin does not use the network, telemetry, or accounts. It stores all comment data in the note.

## Roadmap

Upstream's roadmap is the [Document Comments project](https://github.com/users/kylemcd/projects/1). This fork's plan is tracked separately by its maintainer; the headline item is suggestions.

## Known limitations

- Reading view comments work best with plain text inside one paragraph.
- Reading view cannot add a comment to text inside an embed.
- Avoid overlapping comment anchors because comments on the same words can be difficult to manage.
- The sidebar shows an orphaned comment when no matching selected text remains.
- Live Preview table highlights require browser support for CSS Custom Highlight.

## Development

```bash
npm install
npm run dev
npm run build
npm run check
npm test
```

- `npm run dev` watches the source files and rebuilds `main.js`.
- `npm run build` checks types and creates a production bundle.
- `npm run check` checks formatting, lint rules, types, and tests.
- `npm test` runs the test suite.

### Release

Update `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md` before a release.

Push a tag that exactly matches the version in `manifest.json`:

```bash
git tag 0.1.11
git push origin 0.1.11
```

The [release workflow](.github/workflows/release.yml) builds the plugin and publishes the GitHub release. It also creates attestations for the release files.

Verify a downloaded file with this command:

```bash
gh attestation verify main.js --repo mv-nick/obsidian-document-comments
```

## License

Document Comments uses the MIT License. See [LICENSE](LICENSE).
