#!/usr/bin/env -S node --no-warnings
import { parseArgs } from "node:util";
import { openAsBlob } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Json = unknown;

function loadDotenv(): void {
  const path = join(dirname(fileURLToPath(import.meta.url)), ".env");
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env present is fine — credentials may come from the real environment.
  }
}

function checkNodeVersion(): void {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 23 || (maj === 23 && min < 6)) {
    die(`Node ${process.versions.node} too old; this CLI runs .ts directly and needs Node >=23.6`);
  }
}

const isNumericId = (s: string): boolean => /^\d+$/.test(s);

function userPath(who: string, suffix = ""): string {
  return `/users/${isNumericId(who) ? who : encodeURIComponent(who)}${suffix}`;
}

function intArg(raw: string, label: string, min = 0): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) die(`${label} must be an integer >= ${min}`);
  return n;
}

interface Config {
  domain: string;
  email: string;
  apiKey: string;
}

function getConfig(): Config {
  const domain = (process.env.ZULIP_DOMAIN || "").replace(/\/$/, "");
  const email = process.env.ZULIP_USER_EMAIL || "";
  const apiKey = process.env.ZULIP_USER_API_KEY || "";
  if (!domain || !email || !apiKey) {
    die("Missing ZULIP_DOMAIN, ZULIP_USER_EMAIL, or ZULIP_USER_API_KEY (set in .env or environment)");
  }
  return { domain, email, apiKey };
}

function authHeader(c: Config): string {
  return "Basic " + Buffer.from(`${c.email}:${c.apiKey}`).toString("base64");
}

async function api(
  method: "GET" | "POST" | "DELETE" | "PATCH",
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<Json> {
  const c = getConfig();
  const url = new URL(c.domain + "/api/v1" + path);
  const headers: Record<string, string> = { Authorization: authHeader(c) };
  let body: string | undefined;

  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    cleaned[k] = String(v);
  }

  if (method === "GET" || method === "DELETE") {
    for (const [k, v] of Object.entries(cleaned)) url.searchParams.set(k, v);
  } else {
    body = new URLSearchParams(cleaned).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const res = await fetch(url, { method, headers, body });
  return await parseResponse(res);
}

async function apiUpload(path: string, filePath: string): Promise<Json> {
  let blob: Blob;
  try {
    blob = await openAsBlob(filePath);
  } catch (e) {
    die(`cannot read ${filePath}: ${(e as Error).message}`);
  }
  const c = getConfig();
  const url = new URL(c.domain + "/api/v1" + path);
  const fd = new FormData();
  fd.set("file", blob, basename(filePath) || "upload");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(c) },
    body: fd,
  });
  return await parseResponse(res);
}

async function parseResponse(res: Response): Promise<Json> {
  const text = await res.text();
  let data: Json;
  try {
    data = JSON.parse(text);
  } catch {
    die(`Non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok || (data as { result?: string }).result === "error") {
    die(`Zulip API error (${res.status}): ${text}`);
  }
  return data;
}

function out(data: Json, pretty: boolean): void {
  process.stdout.write(JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const HELP = `zulip — Zulip CLI for Claude

Usage: zulip <group> <command> [options]

channels
  list                              List channels (a.k.a. streams)
    --include-private               Include private channels
    --no-web-public                 Exclude web-public channels
    --no-subscribed                 Exclude subscribed channels
  subscribe <channel-name>          Subscribe to a channel
  topics <channel-id>               List topics in a channel
  resolve <channel-name>            Resolve a channel name to its id

messages
  send <channel> <topic> --content <text>          Post to a channel/topic
  dm --to <email,email,...> --content <text>       Send a direct message
  history <channel> <topic> [--limit N] [--anchor X]   Recent messages
  react <message-id> <emoji-name>                  Add an emoji reaction
  upload <file>                                    Upload a file; returns {uri, url, filename}
  search [--channel C] [--topic T] [--sender S]
         [--text TXT] [--has link|image|attachment|reaction]
         [--is private|mentioned|starred|unread|resolved]
         [--limit N] [--anchor X] [--num-after N]   Generic message search

users
  list                              List users in the organization
  get <email|user-id>               Look up a single user
  status [--text T] [--emoji NAME] [--away|--present]   Set your status
  presence [<email|user-id>]        Get presence (single user, or whole realm if omitted)

Global:
  --pretty                          Pretty-print JSON output
  -h, --help                        Show this help

Output is JSON on stdout. Errors go to stderr with non-zero exit.
Reads ZULIP_DOMAIN, ZULIP_USER_EMAIL, ZULIP_USER_API_KEY from .env (next to this script) or environment.
`;

async function main(): Promise<void> {
  checkNodeVersion();
  loadDotenv();
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const group = argv[0];
  const cmd = argv[1];
  const rest = argv.slice(2);

  const prettyIdx = rest.indexOf("--pretty");
  const pretty = prettyIdx !== -1;
  if (pretty) rest.splice(prettyIdx, 1);

  if (group === "channels" && cmd === "list") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "include-private": { type: "boolean", default: false },
        "no-web-public": { type: "boolean", default: false },
        "no-subscribed": { type: "boolean", default: false },
      },
      strict: true,
    });
    const data = await api("GET", "/streams", {
      include_public: true,
      include_subscribed: !values["no-subscribed"],
      include_web_public: !values["no-web-public"],
      ...(values["include-private"] ? { include_all_active: true } : {}),
    });
    out(data, pretty);
    return;
  }

  if (group === "channels" && cmd === "subscribe") {
    const name = rest[0];
    if (!name) die("channels subscribe: missing <channel-name>");
    const data = await api("POST", "/users/me/subscriptions", {
      subscriptions: JSON.stringify([{ name }]),
    });
    out(data, pretty);
    return;
  }

  if (group === "channels" && cmd === "topics") {
    const id = rest[0];
    if (!id) die("channels topics: missing <channel-id>");
    if (!isNumericId(id)) die("channels topics: <channel-id> must be numeric");
    const data = await api("GET", `/users/me/${id}/topics`);
    out(data, pretty);
    return;
  }

  if (group === "channels" && cmd === "resolve") {
    const name = rest[0];
    if (!name) die("channels resolve: missing <channel-name>");
    const data = await api("GET", "/get_stream_id", { stream: name });
    out(data, pretty);
    return;
  }

  if (group === "messages" && cmd === "send") {
    const [channel, topic] = rest;
    if (!channel || !topic) die("messages send: missing <channel> <topic>");
    const { values } = parseArgs({
      args: rest.slice(2),
      options: { content: { type: "string" } },
      strict: true,
    });
    if (!values.content) die("messages send: --content required");
    const data = await api("POST", "/messages", {
      type: "stream",
      to: channel,
      topic,
      content: values.content,
    });
    out(data, pretty);
    return;
  }

  if (group === "messages" && cmd === "dm") {
    const { values } = parseArgs({
      args: rest,
      options: {
        to: { type: "string" },
        content: { type: "string" },
      },
      strict: true,
    });
    if (!values.to || !values.content) die("messages dm: --to and --content required");
    const recipients = values.to.split(",").map((s) => s.trim()).filter(Boolean);
    const data = await api("POST", "/messages", {
      type: "direct",
      to: JSON.stringify(recipients),
      content: values.content,
    });
    out(data, pretty);
    return;
  }

  if (group === "messages" && cmd === "history") {
    const [channel, topic] = rest;
    if (!channel || !topic) die("messages history: missing <channel> <topic>");
    const { values } = parseArgs({
      args: rest.slice(2),
      options: {
        limit: { type: "string", default: "20" },
        anchor: { type: "string", default: "newest" },
      },
      strict: true,
    });
    const limit = intArg(values.limit!, "messages history: --limit", 1);
    const narrow = JSON.stringify([
      { operator: "stream", operand: channel },
      { operator: "topic", operand: topic },
    ]);
    const data = await api("GET", "/messages", {
      narrow,
      anchor: values.anchor,
      num_before: limit,
      num_after: 0,
      apply_markdown: false,
    });
    out(data, pretty);
    return;
  }

  if (group === "messages" && cmd === "react") {
    const [id, emoji] = rest;
    if (!id || !emoji) die("messages react: missing <message-id> <emoji-name>");
    if (!isNumericId(id)) die("messages react: <message-id> must be numeric");
    const data = await api("POST", `/messages/${id}/reactions`, { emoji_name: emoji });
    out(data, pretty);
    return;
  }

  if (group === "messages" && cmd === "upload") {
    const file = rest[0];
    if (!file) die("messages upload: missing <file>");
    const data = await apiUpload("/user_uploads", file);
    out(data, pretty);
    return;
  }

  if (group === "messages" && cmd === "search") {
    const { values } = parseArgs({
      args: rest,
      options: {
        channel: { type: "string" },
        topic: { type: "string" },
        sender: { type: "string" },
        text: { type: "string" },
        has: { type: "string", multiple: true },
        is: { type: "string", multiple: true },
        limit: { type: "string", default: "20" },
        anchor: { type: "string", default: "newest" },
        "num-after": { type: "string", default: "0" },
      },
      strict: true,
    });
    const narrow: Array<{ operator: string; operand: string }> = [];
    if (values.channel) narrow.push({ operator: "stream", operand: values.channel });
    if (values.topic) narrow.push({ operator: "topic", operand: values.topic });
    if (values.sender) narrow.push({ operator: "sender", operand: values.sender });
    if (values.text) narrow.push({ operator: "search", operand: values.text });
    for (const h of (values.has as string[] | undefined) ?? []) narrow.push({ operator: "has", operand: h });
    for (const i of (values.is as string[] | undefined) ?? []) narrow.push({ operator: "is", operand: i });
    if (narrow.length === 0) die("messages search: provide at least one of --channel/--topic/--sender/--text/--has/--is");
    const limit = intArg(values.limit!, "messages search: --limit");
    const numAfter = intArg(values["num-after"]!, "messages search: --num-after");
    const data = await api("GET", "/messages", {
      narrow: JSON.stringify(narrow),
      anchor: values.anchor,
      num_before: limit,
      num_after: numAfter,
      apply_markdown: false,
    });
    out(data, pretty);
    return;
  }

  if (group === "users" && cmd === "list") {
    const data = await api("GET", "/users");
    out(data, pretty);
    return;
  }

  if (group === "users" && cmd === "get") {
    const who = rest[0];
    if (!who) die("users get: missing <email|user-id>");
    const data = await api("GET", userPath(who));
    out(data, pretty);
    return;
  }

  if (group === "users" && cmd === "status") {
    const { values } = parseArgs({
      args: rest,
      options: {
        text: { type: "string" },
        emoji: { type: "string" },
        away: { type: "boolean", default: false },
        present: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (values.away && values.present) die("users status: --away and --present are mutually exclusive");
    if (
      values.text === undefined &&
      values.emoji === undefined &&
      !values.away &&
      !values.present
    ) {
      die("users status: provide at least one of --text, --emoji, --away, --present");
    }
    const params: Record<string, string | undefined> = {};
    if (values.text !== undefined) params.status_text = values.text;
    if (values.emoji !== undefined) {
      params.emoji_name = values.emoji;
      params.reaction_type = "unicode_emoji";
    }
    if (values.away) params.away = "true";
    if (values.present) params.away = "false";
    const data = await api("POST", "/users/me/status", params);
    out(data, pretty);
    return;
  }

  if (group === "users" && cmd === "presence") {
    const who = rest[0];
    const data = await api("GET", who ? userPath(who, "/presence") : "/realm/presence");
    out(data, pretty);
    return;
  }

  die(`unknown command: ${[group, cmd].filter(Boolean).join(" ")}\n\n${HELP}`);
}

main().catch((e) => {
  if (process.env.DEBUG) console.error(e);
  die(e instanceof Error ? e.message : String(e));
});
