# zulip-cli

A small, zero-dependency TypeScript CLI for Zulip, designed to be driven by Claude (or any agent) as a [skill](./SKILL.md). Output is JSON on stdout; errors go to stderr with a non-zero exit. Inspired by the tool surface of [Monadical-SAS/zulip-mcp](https://github.com/Monadical-SAS/zulip-mcp), shaped like a CLI in the style of [HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything).

## Requirements

- Node.js 23.6+ (runs `.ts` files directly via native type stripping). Tested on Node 25.
- A Zulip account with an API key.

No `npm install` is needed — the CLI uses only Node built-ins (`fetch`, `node:util`, `node:fs`, `node:path`, `node:url`).

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

### Quick examples

```bash
zulip channels list --pretty
zulip messages send "general" "deploys" --content "Deploy complete"
zulip messages history "general" "release-notes" --limit 10 --pretty
zulip messages search --sender "alice@example.com" --text "deploy" --limit 20
zulip users get alice@example.com
```

For complete recipes (uploading and embedding files, setting status, DMs, etc.) see [SKILL.md](./SKILL.md#recipes). Run `zulip --help` for the full command reference.

Set `DEBUG=1` in the environment to print stack traces on unexpected errors.

## Files

- `zulip.ts` — single-file CLI, runnable directly with `node`.
- `SKILL.md` — agent-facing skill description (frontmatter + commands + recipes).
- `scripts/sync-secrets.sh` — push `.env` values up to GitHub Actions secrets.
- `.github/workflows/ci.yml` — read-only smoke tests on PRs to `release`.
- `.github/workflows/release.yml` — build a tarball release on push to `release`.
- `.env` — credentials (gitignored).

## CI / release pipeline

The repository uses two workflows and a protected `release` branch.

### Branches

- `main` — active development. CI runs on every push.
- `release` — protected. Direct pushes are blocked; merges happen via pull request and require the read-only CI to pass. Pushing to `release` triggers a packaged release.

Branch protection on `release` enforces: PR required, no force-push, no deletion, and the `read-only-tests` status check must pass.

### `ci.yml` — read-only smoke tests

Runs on:
- `pull_request` targeting `release` (required check),
- `push` to `main`,
- manual `workflow_dispatch`.

The job `read-only-tests` exercises the CLI against the configured Zulip server using repository secrets. It calls only **read-only** endpoints:

- `users list`, `users get <self>`, `users presence <self>`
- `channels list`, `channels resolve <name>`, `channels topics <id>`
- `messages search --sender <self> --limit 1`

**Limitations:**

- **Read-only by design.** No tests cover write operations (`messages send`, `messages dm`, `messages react`, `messages upload`, `channels subscribe`, `users status`). Those endpoints would either post visible messages, modify your status, or change subscription state on the live server, so they are not exercised in CI. Verify them manually before merging changes that touch those code paths.
- The CI uses **real credentials** against a real Zulip server (the one whose secrets are uploaded). It is not hermetic; if the server is unreachable or credentials are revoked, the workflow fails.
- Tests assume the configured user has at least one accessible stream and at least one message they have sent. On a brand-new account these may produce empty results and a couple of assertions may need relaxing.
- Secrets are not exposed to PRs from forks (GitHub default), so external contributors' PRs will fail the read-only checks until the maintainer re-runs the workflow from the base repo.

### `release.yml` — build a packaged release

Runs on push to `release` (i.e., after a merge) and on manual dispatch. Steps:

1. Smoke-test that `node zulip.ts --help` exits cleanly.
2. `npm pack` to produce a tarball of the files listed in `package.json` (`zulip.ts`, `SKILL.md`, `README.md`, `LICENSE`).
3. Create a GitHub Release tagged `v<version>-<UTC-timestamp>-<short-sha>` with the tarball attached.

Releases appear on the repository's Releases page. There is no npm-registry publish step — the artifact is the GitHub Release tarball.

### Uploading credentials to GitHub — `scripts/sync-secrets.sh`

The CI workflow reads `ZULIP_DOMAIN`, `ZULIP_USER_EMAIL`, and `ZULIP_USER_API_KEY` from repository secrets. Use the helper script to push them from your local `.env`:

```bash
scripts/sync-secrets.sh --dry-run     # preview without writing
scripts/sync-secrets.sh               # actually push
scripts/sync-secrets.sh --repo OWNER/NAME --env path/to/.env
```

The script reads `KEY=VALUE` pairs from `.env`, strips matching surrounding quotes, validates the key shape, and pipes the value to `gh secret set <KEY>`. Comments and blank lines are ignored.

Requirements: `gh` CLI authenticated with `repo` scope. After running, verify with `gh secret list`.

**Caveat:** rerun this whenever you rotate your Zulip API key or change the domain. Stale secrets are the most common reason CI breaks.

## Use as a Claude skill

`SKILL.md` is structured for use as an agent skill. Point your agent at this directory (or copy `SKILL.md` into your skills location) and Claude will be able to discover the available commands and call them via shell. The CLI's JSON-by-default output is meant for direct parsing by the agent; `--pretty` is for human display.

## Notes

- The CLI does no client-side caching or fuzzy matching — pass exact stream/topic names. When a name fails, fall back to listing and filtering.
- Message content goes through `--content` as a single argument; quote it. Zulip-flavored Markdown is supported.
- DM recipients are comma-separated emails (or numeric user ids).
- Posting and reacting are user-visible, hard-to-reverse actions — confirm with the user before sending.

## Coverage and known gaps

This CLI exposes a useful but **deliberately small** slice of the Zulip REST API. Many endpoints are not yet wrapped. If you need one that is missing, either call the Zulip API directly with `curl` (using the same `.env` credentials and HTTP Basic auth) or open an issue / PR.

Reference: <https://zulip.com/api/>.

### Not currently supported

**Messages**
- `PATCH /messages/{id}` — edit a message, move topics, mark resolved
- `DELETE /messages/{id}` — delete a message
- `GET /messages/{id}` — fetch a single message
- `GET /messages/{id}/history` — edit history
- `POST /messages/flags` — mark read/unread, star/unstar
- `DELETE /messages/{id}/reactions` — remove a reaction (only adding is supported)
- `POST /messages/render` — render Markdown without sending

**Channels (streams)**
- `GET /streams/{id}` — single stream details
- `POST /streams/{id}` — update name, description, permissions
- `DELETE /streams/{id}` — archive
- `GET /streams/{id}/members` — list subscribers
- `DELETE /users/me/subscriptions` — unsubscribe
- `PATCH /users/me/subscriptions/properties` — mute, pin, change color or notification settings

**Topics**
- `POST /user_topics` (and legacy `/users/me/subscriptions/muted_topics`) — mute, unmute, mark resolved
- `POST /mark_topic_as_read`, `/mark_stream_as_read`, `/mark_all_as_read`
- `DELETE /streams/{id}/delete_topic`

**Users / groups**
- `GET /users/me` — current user
- `GET /user_groups` plus create / update / membership endpoints

**Drafts and scheduled messages**
- `GET/POST/PATCH/DELETE /drafts`
- `GET/POST/PATCH/DELETE /scheduled_messages`

**Realtime / event queue**
- `POST /register` and `GET /events` — long-polling for new messages. Inherently stateful and out of scope for a one-shot CLI.

**Realm metadata**
- `GET /realm/emoji`
- `GET /realm/linkifiers`
- `GET /server_settings`

This list is not exhaustive. See the upstream API reference for the full surface.

## License

MIT — see [LICENSE](./LICENSE).

## No warranty

This software is provided **"as is", without warranty of any kind**, express or implied. The authors and contributors are not liable for any damages, data loss, accidental messages sent, leaked credentials, or other consequences arising from its use. You are solely responsible for:

- protecting your `.env` credentials and any GitHub Actions secrets you upload,
- reviewing what the CLI does before running write operations against a real Zulip server,
- understanding that posting, DMing, reacting, uploading, and changing your status are user-visible actions that may be hard to reverse,
- complying with your organization's policies on automated access to internal communication systems.

Use at your own risk.
