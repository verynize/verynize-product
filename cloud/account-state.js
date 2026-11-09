// Private, revision-checked account data shared by desktop and web. Design documents themselves
// remain in rooms; these records hold preferences, individual chats and library organization.
//
// Internal rows share the table under keys outside the public allowlist (`@…`): `@chunk:<id>:<n>`
// holds parts of a large value, `@summary:chat:<id>` a chat's title and size (written with the chat,
// at the chat's revision) so lists never read transcripts. `updatedAt` of a public row only grows
// within an account (each write takes max(now, latest + 1) in the same statement), so it is the
// change feed's cursor: a reader that saw cursor C sees every later write as `updatedAt > C`.
import { fail } from "./http.js";

export const ACCOUNT_VALUE_BYTES = 20 * 1024 * 1024;
// The API wraps a JSON string in JSON: quotes and backslashes can double its encoded size.
export const ACCOUNT_REQUEST_BYTES = 2 * ACCOUNT_VALUE_BYTES + 1024;
const CHUNK_CHARS = 128 * 1024;
const SUMMARY = "@summary:";
const SUMMARY_CHARS = 4096;
const marker = /^@chunk:([0-9a-f-]{36}):(\d+)$/;
const KEY = /^(preference|agent-default|chat|draft|folder|file):.{1,240}$/;
const isChat = (key) => key.startsWith("chat:");
const NEXT_UPDATED_AT =
  "MAX(?, COALESCE((SELECT MAX(updatedAt) FROM account_state WHERE accountId = ?), 0) + 1)";

export const validKey = (key) => KEY.test(key);

/** The list entry of a stored chat (`{project, chat}`): every field but the messages, plus their count. */
export function chatSummary(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const chat = data?.chat;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) return JSON.stringify({});
  const { messages, ...rest } = chat;
  const count = Array.isArray(messages) ? messages.length : 0;
  let summary = JSON.stringify({ project: data.project, chat: { ...rest, count } });
  if (summary.length > SUMMARY_CHARS)
    summary = JSON.stringify({
      project: typeof data.project === "string" ? data.project.slice(0, 1024) : data.project,
      chat: {
        id: rest.id,
        title: typeof rest.title === "string" ? rest.title.slice(0, 200) : rest.title,
        created: rest.created,
        count,
      },
    });
  return summary;
}

/** Joins a head row's chunks from `rows` (a map by key); a head whose chunks are missing fails. */
function joined(item, rows) {
  const match = typeof item.value === "string" && item.value.match(marker);
  if (!match) return item.value;
  const parts = [];
  for (let index = 0; index < Number(match[2]); index++) {
    const part = rows.get(`@chunk:${match[1]}:${index}`);
    if (!part || typeof part.value !== "string") fail(500, "Account record is incomplete");
    parts.push(part.value);
  }
  return parts.join("");
}

/**
 * Every public record with its value (the original API, still used by older clients), or with
 * `chats: "summary"` chat records as `{key, revision, summary}` without their transcript, and with
 * `since` only records written after that cursor. Always returns the cursor of what was read.
 */
export async function readAccountState(env, accountId, { chats = "full", since = -1 } = {}) {
  if (chats !== "summary") {
    // One statement provides a consistent snapshot of heads and chunks during concurrent writes.
    const { results } = await env.DB.prepare(
      "SELECT key, value, revision, updatedAt FROM account_state WHERE accountId = ?",
    )
      .bind(accountId)
      .all();
    const rows = new Map(results.map((row) => [row.key, row]));
    let cursor = Math.max(since, 0);
    const items = [];
    for (const row of results) {
      if (row.key.startsWith("@") || row.updatedAt <= since) continue;
      cursor = Math.max(cursor, row.updatedAt);
      items.push({ key: row.key, value: joined(row, rows), revision: row.revision });
    }
    return { items, cursor };
  }
  // Chat values never leave the database here: only chunks of other changed records are read.
  const { results } = await env.DB.prepare(
    `SELECT key, CASE WHEN key LIKE 'chat:%' THEN NULL ELSE value END AS value,
      CASE WHEN account_state.value IS NULL THEN 1 ELSE 0 END AS deleted, revision, updatedAt
    FROM account_state WHERE accountId = ?1 AND (
      (key NOT LIKE '@%' AND updatedAt > ?2)
      OR (key LIKE '@summary:%' AND substr(key, 10) IN (
        SELECT key FROM account_state WHERE accountId = ?1 AND key LIKE 'chat:%' AND updatedAt > ?2))
      OR (key LIKE '@chunk:%' AND substr(key, 8, 36) IN (
        SELECT substr(value, 8, 36) FROM account_state WHERE accountId = ?1 AND key NOT LIKE '@%'
          AND key NOT LIKE 'chat:%' AND updatedAt > ?2 AND value LIKE '@chunk:%')))`,
  )
    .bind(accountId, since)
    .all();
  const rows = new Map(results.map((row) => [row.key, row]));
  let cursor = Math.max(since, 0);
  const items = [];
  const missing = [];
  for (const row of results) {
    if (row.key.startsWith("@")) continue;
    cursor = Math.max(cursor, row.updatedAt);
    if (!isChat(row.key)) {
      items.push({ key: row.key, value: joined(row, rows), revision: row.revision });
      continue;
    }
    if (row.deleted) {
      items.push({ key: row.key, value: null, revision: row.revision });
      continue;
    }
    const summary = rows.get(SUMMARY + row.key);
    if (summary && summary.revision === row.revision)
      items.push({ key: row.key, revision: row.revision, summary: summary.value });
    else missing.push(row.key);
  }
  // Chats written before summaries existed: summarised once from their value, then stored.
  for (const key of missing) {
    const item = await readAccountItem(env, accountId, key);
    if (!item) continue;
    if (item.value === null) {
      items.push(item);
      continue;
    }
    const summary = chatSummary(item.value) ?? JSON.stringify({});
    await storeSummary(env.DB, accountId, key, summary, item.revision).catch(() => {});
    items.push({ key, revision: item.revision, summary });
  }
  return { items, cursor };
}

/** One record with its full value, or null when it was never written. */
export async function readAccountItem(env, accountId, key) {
  if (!validKey(key)) fail(400, "Invalid account state key");
  const { results } = await env.DB.prepare(
    `SELECT key, value, revision FROM account_state WHERE accountId = ?1 AND (key = ?2
      OR (key LIKE '@chunk:%' AND substr(key, 8, 36) = (
        SELECT substr(value, 8, 36) FROM account_state
        WHERE accountId = ?1 AND key = ?2 AND value LIKE '@chunk:%')))`,
  )
    .bind(accountId, key)
    .all();
  const rows = new Map(results.map((row) => [row.key, row]));
  const head = rows.get(key);
  if (!head) return null;
  return { key, value: joined(head, rows), revision: head.revision };
}

const summaryStatement = (db, accountId, key, summary, revision, condition, conditionArgs) =>
  db
    .prepare(`INSERT INTO account_state (accountId, key, value, revision, updatedAt)
      SELECT ?, ?, ?, ?, ? WHERE ${condition}
      ON CONFLICT (accountId, key) DO UPDATE SET value = excluded.value,
        revision = excluded.revision, updatedAt = excluded.updatedAt`)
    .bind(accountId, SUMMARY + key, summary, revision, Date.now(), ...conditionArgs);

function storeSummary(db, accountId, key, summary, revision) {
  return summaryStatement(
    db,
    accountId,
    key,
    summary,
    revision,
    "EXISTS (SELECT 1 FROM account_state WHERE accountId = ? AND key = ? AND revision = ?)",
    [accountId, key, revision],
  ).run();
}

export async function writeAccountState(env, accountId, key, data) {
  if (!validKey(key)) fail(400, "Invalid account state key");
  if (!Number.isSafeInteger(data.revision) || data.revision < 0)
    fail(400, "A nonnegative revision is required");
  if (data.value !== null && typeof data.value !== "string")
    fail(400, "value must be a JSON string or null");
  if (data.value !== null) {
    if (new TextEncoder().encode(data.value).byteLength > ACCOUNT_VALUE_BYTES)
      fail(413, "Account record exceeds 20 MB");
    try {
      JSON.parse(data.value);
    } catch {
      fail(400, "value must contain valid JSON");
    }
  }
  const db = env.DB;
  const previous = await db
    .prepare("SELECT value FROM account_state WHERE accountId = ? AND key = ?")
    .bind(accountId, key)
    .first();
  const parts = [];
  if (data.value?.length > CHUNK_CHARS) {
    for (let start = 0; start < data.value.length;) {
      let end = Math.min(start + CHUNK_CHARS, data.value.length);
      // Never send a half surrogate pair through SQLite's UTF-8 encoding.
      const last = data.value.charCodeAt(end - 1);
      if (end < data.value.length && last >= 0xd800 && last <= 0xdbff) end--;
      parts.push(data.value.slice(start, end));
      start = end;
    }
  }
  const id = crypto.randomUUID();
  // This cannot collide with user values: those must contain valid JSON. Internal keys are
  // outside the public key allowlist. No schema migration or client protocol change is needed.
  const value = parts.length ? `@chunk:${id}:${parts.length}` : data.value;
  const now = Date.now();
  const write =
    data.revision === 0
      ? db
          .prepare(`INSERT INTO account_state (accountId, key, value, revision, updatedAt)
        VALUES (?, ?, ?, 1, ${NEXT_UPDATED_AT}) ON CONFLICT (accountId, key) DO NOTHING
        RETURNING key, revision`)
          .bind(accountId, key, value, now, accountId)
      : db
          .prepare(`UPDATE account_state SET value = ?, revision = revision + 1,
          updatedAt = ${NEXT_UPDATED_AT}
        WHERE accountId = ? AND key = ? AND revision = ?
        RETURNING key, revision`)
          .bind(value, now, accountId, accountId, key, data.revision);
  const statements = [write];
  // Every statement after the write applies only when that write won its revision check.
  const won =
    "EXISTS (SELECT 1 FROM account_state WHERE accountId = ? AND key = ? AND value IS ? AND revision = ?)";
  const wonArgs = [accountId, key, value, data.revision + 1];
  for (const [index, part] of parts.entries()) {
    statements.push(
      db
        .prepare(`INSERT INTO account_state (accountId, key, value, revision, updatedAt)
      SELECT ?, ?, ?, 1, ? WHERE ${won}`)
        .bind(accountId, `@chunk:${id}:${index}`, part, now, ...wonArgs),
    );
  }
  const old = previous?.value?.match(marker);
  if (old) {
    statements.push(
      db
        .prepare(`DELETE FROM account_state WHERE accountId = ? AND key LIKE ? AND ${won}`)
        .bind(accountId, `@chunk:${old[1]}:%`, ...wonArgs),
    );
  }
  if (isChat(key))
    statements.push(
      data.value === null
        ? db
            .prepare(`DELETE FROM account_state WHERE accountId = ? AND key = ? AND ${won}`)
            .bind(accountId, SUMMARY + key, ...wonArgs)
        : summaryStatement(
            db,
            accountId,
            key,
            chatSummary(data.value) ?? JSON.stringify({}),
            data.revision + 1,
            won,
            wonArgs,
          ),
    );
  // D1 batch is a transaction: failed writes never publish a partial transcript. A stale
  // compare-and-swap cannot insert chunks or remove the current record's chunks.
  const [result] = await db.batch(statements);
  const item = result.results[0];
  if (!item) fail(409, "This item changed on another device. Refresh before saving.");
  return { item: { ...item, value: data.value } };
}
