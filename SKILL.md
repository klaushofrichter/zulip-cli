---
name: zulip
description: Interact with a Zulip server (list channels, post messages, send DMs, read history, react, list users). Use when the user asks to read, post, search, or react to Zulip messages, list streams/topics/users, or subscribe to a channel.
---

# Zulip CLI

A small TypeScript CLI for Zulip. Output is JSON on stdout — parse it directly. Errors go to stderr with a non-zero exit code.

## Setup (one-time)

Credentials live in `.env` next to `zulip.ts` (already configured if this skill is installed):

```
ZULIP_DOMAIN=https://chat.example.com
ZULIP_USER_EMAIL=you@example.com
ZULIP_USER_API_KEY=...
```

Run with `node /path/to/zulip-cli/zulip.ts ...`. Below, treat `zulip` as that command.

## Commands

All commands print JSON. Add `--pretty` only when showing output to the user; for parsing, leave it off.

### Channels (streams)

```
zulip channels list [--include-private] [--no-web-public] [--no-subscribed]
zulip channels subscribe <channel-name>
zulip channels topics <channel-id>          # numeric stream id
zulip channels resolve <channel-name>       # name → { stream_id }
```

`channels list` returns `{ streams: [{ stream_id, name, description, ... }, ...] }`. Prefer `channels resolve <name>` over listing all streams when you only need an id.

### Messages

```
zulip messages send <channel> <topic> --content <text>
zulip messages dm --to <email1,email2,...> --content <text>
zulip messages history <channel> <topic> [--limit 20] [--anchor newest]
zulip messages react <message-id> <emoji-name>     # emoji-name without colons, e.g. thumbs_up
zulip messages upload <file>                       # returns { uri, url, filename }
zulip messages search [--channel C] [--topic T] [--sender S]
                      [--text TXT] [--has link|image|attachment|reaction]
                      [--is private|mentioned|starred|unread|resolved]
                      [--limit 20] [--anchor newest] [--num-after 0]
```

- `messages history` is a thin wrapper for stream+topic. Use `messages search` for anything else (sender, full-text, has-link, etc.). At least one filter is required.
- `messages upload` returns a `uri` like `/user_uploads/.../foo.png`. Embed it in a message via Markdown: `[caption](/user_uploads/...)`.
- `--has` and `--is` may be repeated to combine filters.

### Users

```
zulip users list
zulip users get <email|user-id>
zulip users status [--text T] [--emoji NAME] [--away|--present]
zulip users presence [<email|user-id>]      # omitted = whole realm
```

- `users list` returns `{ members: [...] }`. For a single user, prefer `users get`.
- `users status --text ""` clears the text. `users status --emoji ""` clears the emoji. `--away` / `--present` toggle availability.
- `users presence` without an argument returns realm-wide presence.

## Recipes

**Read latest 10 messages from a topic, pretty:**
`zulip messages history "general" "release-notes" --limit 10 --pretty`

**Send a message to a topic:**
`zulip messages send "general" "deploys" --content "Deploy complete ✅"`

**DM two users:**
`zulip messages dm --to "alice@example.com,bob@example.com" --content "Hi!"`

**Find a user's email by name:**
`zulip users list | jq -r '.members[] | select(.full_name=="Alice Example") | .email'`

**Look up a stream id, then list topics:**
```
ID=$(zulip channels resolve "general" | jq -r .stream_id)
zulip channels topics "$ID"
```

**Find recent messages from a sender mentioning a term:**
`zulip messages search --sender "alice@example.com" --text "deploy" --limit 20`

**Upload an image and post it:**
```
URI=$(zulip messages upload ./graph.png | jq -r .uri)
zulip messages send "general" "metrics" --content "Latest: [graph]($URI)"
```

**Set status:**
`zulip users status --text "in a meeting" --emoji calendar`

## Notes for the agent

- Content goes through `--content` (a single argument). Quote it; newlines in content are fine.
- Recipients for DMs are comma-separated emails or numeric user ids.
- Markdown is supported in message content (Zulip-flavored).
- Before posting publicly visible messages, confirm with the user — these actions are user-visible and not easily reversible.
- `messages history` does not include `--anchor` validation; pass either `newest`, `oldest`, `first_unread`, or a message id.
- The CLI does no client-side stream/user lookup — pass exact names. If a name fails, fall back to listing and matching.
