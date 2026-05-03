# zulip-cli

A small, zero-dependency TypeScript CLI for Zulip, designed to be driven by Claude (or any agent) as a [skill](./SKILL.md). Output is JSON on stdout; errors go to stderr with a non-zero exit. Inspired by the tool surface of [Monadical-SAS/zulip-mcp](https://github.com/Monadical-SAS/zulip-mcp), shaped like a CLI in the style of [HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything).

## Requirements

- Node.js 23.6+ (runs `.ts` files directly via native type stripping). Tested on Node 25.
- A Zulip account with an API key.

No `npm install` is needed — the CLI uses only Node built-ins (`fetch`, `node:util`, `node:fs`).

## Setup

1. Clone or copy this directory.
2. Create a `.env` next to `zulip.ts`:

   ```
   ZULIP_DOMAIN=https://chat.example.com
   ZULIP_USER_EMAIL=you@example.com
   ZULIP_USER_API_KEY=your-api-key
   ```

   Get an API key from `https://<your-zulip>/#settings/account-and-privacy` → "Show/change your API key".

3. (Optional) put it on `PATH`:

   ```
   chmod +x zulip.ts
   ln -s "$PWD/zulip.ts" ~/bin/zulip
   ```

   Then `zulip ...` works from anywhere. Otherwise invoke as `node /path/to/zulip.ts ...`.

## Usage

```
zulip --help
```

Top-level command groups:

| Group     | Commands                                                              |
|-----------|-----------------------------------------------------------------------|
| channels  | `list`, `subscribe`, `topics`, `resolve`                              |
| messages  | `send`, `dm`, `history`, `react`, `upload`, `search`                  |
| users     | `list`, `get`, `status`, `presence`                                   |

All output is JSON. Add `--pretty` for indented output when reading by eye.

### Examples

List streams:

```bash
zulip channels list --pretty
```

Send a message to a stream/topic:

```bash
zulip messages send "general" "deploys" --content "Deploy complete"
```

Send a direct message:

```bash
zulip messages dm --to "alice@example.com,bob@example.com" --content "Hi!"
```

Read the last 10 messages from a topic:

```bash
zulip messages history "general" "release-notes" --limit 10 --pretty
```

React to a message:

```bash
zulip messages react 123456789 thumbs_up
```

List users:

```bash
zulip users list
```

Look up a single user, or get the stream id for a name:

```bash
zulip users get alice@example.com
zulip channels resolve "general"
```

Search messages by sender + text:

```bash
zulip messages search --sender "alice@example.com" --text "deploy" --limit 20
```

Upload a file and post it:

```bash
URI=$(zulip messages upload ./graph.png | jq -r .uri)
zulip messages send "general" "metrics" --content "Latest: [graph]($URI)"
```

Set or clear your status:

```bash
zulip users status --text "in a meeting" --emoji calendar
zulip users status --text "" --emoji "" --present
```

Get presence for one user (or the whole realm if omitted):

```bash
zulip users presence alice@example.com
zulip users presence
```

## Files

- `zulip.ts` — single-file CLI, runnable directly with `node`.
- `SKILL.md` — agent-facing skill description (frontmatter + commands + recipes).
- `.env` — credentials (gitignored).

## Use as a Claude skill

`SKILL.md` is structured for use as an agent skill. Point your agent at this directory (or copy `SKILL.md` into your skills location) and Claude will be able to discover the available commands and call them via shell. The CLI's JSON-by-default output is meant for direct parsing by the agent; `--pretty` is for human display.

## Notes

- The CLI does no client-side caching or fuzzy matching — pass exact stream/topic names. When a name fails, fall back to listing and filtering.
- Message content goes through `--content` as a single argument; quote it. Zulip-flavored Markdown is supported.
- DM recipients are comma-separated emails (or numeric user ids).
- Posting and reacting are user-visible, hard-to-reverse actions — confirm with the user before sending.

## License

No license declared. Add one before publishing.
