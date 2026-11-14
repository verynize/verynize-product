import { sql } from "drizzle-orm";
// D1 schema matching the existing SQL migrations. Auth dates remain ISO text for
// compatibility with the original Better Auth adapter; room dates remain epoch ms.
import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  unique,
  check,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").notNull().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").notNull().primaryKey(),
    expiresAt: text("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("activeOrganizationId"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").notNull().primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: text("accessTokenExpiresAt"),
    refreshTokenExpiresAt: text("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").notNull().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = sqliteTable("organization", {
  id: text("id").notNull().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: text("createdAt").notNull(),
  metadata: text("metadata"),
});

export const member = sqliteTable(
  "member",
  {
    id: text("id").notNull().primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").notNull().primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const room = sqliteTable(
  "room",
  {
    id: text("id").notNull().primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    createdBy: text("createdBy").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [index("room_organizationId_idx").on(table.organizationId)],
);

// Account directory (cloud/profiles.js, migration 0003). Ids are the former AccountDirectory ids.
export const profile = sqliteTable("profile", {
  id: text("id").notNull().primaryKey(),
  email: text("email").notNull().unique(),
  handle: text("handle").notNull().unique(),
  displayName: text("displayName").notNull(),
  avatarUrl: text("avatarUrl"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  userId: text("userId")
    .unique()
    .references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("createdAt").notNull(),
  // Web onboarding: when the AI setup steps were finished or skipped (migration 0008).
  aiSetupAt: integer("aiSetupAt"),
});

export const roomMembership = sqliteTable(
  "room_membership",
  {
    accountId: text("accountId").notNull(),
    roomId: text("roomId").notNull(),
    role: text("role").notNull(),
    title: text("title"),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.roomId] }),
    index("room_membership_roomId_idx").on(table.roomId),
  ],
);

export const publication = sqliteTable(
  "publication",
  {
    kind: text("kind").notNull(),
    ref: text("ref").notNull(),
    accountId: text("accountId").notNull(),
    title: text("title").notNull(),
    path: text("path").notNull(),
    publishedAt: integer("publishedAt").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.ref] }),
    index("publication_accountId_idx").on(table.accountId),
  ],
);

export const app = sqliteTable(
  "app",
  {
    id: text("id").notNull().primaryKey(),
    accountId: text("accountId").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    activeVersion: integer("activeVersion"),
    createdAt: integer("createdAt").notNull(),
  },
  (table) => [unique().on(table.accountId, table.name)],
);

export const migrationState = sqliteTable("migration_state", {
  name: text("name").notNull().primaryKey(),
  state: text("state").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

// Room assets (cloud/assets.js, migration 0004): R2 images referenced by URL from room documents.
export const roomAsset = sqliteTable(
  "room_asset",
  {
    id: text("id").notNull().primaryKey(),
    roomId: text("roomId").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    contentType: text("contentType").notNull(),
    status: text("status").notNull(),
    createdBy: text("createdBy"),
    createdAt: integer("createdAt").notNull(),
    uploadedAt: integer("uploadedAt"),
  },
  (table) => [
    unique().on(table.roomId, table.sha256),
    index("room_asset_roomId_idx").on(table.roomId),
  ],
);

// File covers (migration 0010): one reserved R2 object per room, outside asset quotas.
export const roomThumbnail = sqliteTable(
  "room_thumbnail",
  {
    roomId: text("roomId").notNull().primaryKey(),
    sha256: text("sha256").notNull(),
    contentType: text("contentType").notNull(),
    size: integer("size").notNull(),
    nodeId: text("nodeId"),
    pageId: text("pageId"),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [
    check(
      "room_thumbnail_selection",
      sql`${table.nodeId} IS NOT NULL OR ${table.pageId} IS NOT NULL`,
    ),
  ],
);

// Model API runtime (cloud/ai.js, migration 0005): runs, their events, approvals and the
// recorded results of write tool calls. Times are epoch ms.
export const aiRun = sqliteTable(
  "ai_run",
  {
    id: text("id").notNull().primaryKey(),
    accountId: text("accountId").notNull(),
    roomId: text("roomId").notNull(),
    chatId: text("chatId").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull().default("openrouter"),
    access: text("access").notNull(),
    status: text("status").notNull(),
    code: text("code"),
    idempotencyKey: text("idempotencyKey").notNull(),
    cancelRequested: integer("cancelRequested", { mode: "boolean" }).notNull().default(false),
    leaseUntil: integer("leaseUntil").notNull(),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [
    unique().on(table.accountId, table.idempotencyKey),
    index("ai_run_account_status_idx").on(table.accountId, table.status),
  ],
);

export const aiRunEvent = sqliteTable(
  "ai_run_event",
  {
    runId: text("runId").notNull(),
    seq: integer("seq").notNull(),
    event: text("event").notNull(),
    createdAt: integer("createdAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);

export const aiApproval = sqliteTable(
  "ai_approval",
  {
    runId: text("runId").notNull(),
    requestId: text("requestId").notNull(),
    accountId: text("accountId").notNull().default(""),
    toolCallId: text("toolCallId").notNull(),
    toolName: text("toolName").notNull(),
    argsHash: text("argsHash").notNull(),
    decision: text("decision"),
    reason: text("reason"),
    createdAt: integer("createdAt").notNull(),
    decidedAt: integer("decidedAt"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.requestId] }),
    unique().on(table.runId, table.toolCallId),
  ],
);

export const aiToolResult = sqliteTable(
  "ai_tool_result",
  {
    runId: text("runId").notNull(),
    toolCallId: text("toolCallId").notNull(),
    toolName: text("toolName").notNull(),
    output: text("output").notNull(),
    isError: integer("isError", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("createdAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.toolCallId] })],
);

// Model API credentials (cloud/ai-credentials.js, migration 0007): per-account provider keys,
// encrypted at rest, and pending OpenRouter PKCE sign-ins. Times are epoch ms.
export const aiCredential = sqliteTable(
  "ai_credential",
  {
    accountId: text("accountId").notNull(),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    last4: text("last4").notNull(),
    label: text("label"),
    source: text("source").notNull(),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.provider] })],
);

export const aiOauthState = sqliteTable(
  "ai_oauth_state",
  {
    stateHash: text("stateHash").notNull().primaryKey(),
    accountId: text("accountId").notNull(),
    provider: text("provider").notNull(),
    verifier: text("verifier").notNull(),
    iv: text("iv").notNull(),
    browserHash: text("browserHash").notNull(),
    returnTo: text("returnTo").notNull(),
    expiresAt: integer("expiresAt").notNull(),
    createdAt: integer("createdAt").notNull(),
  },
  (table) => [index("ai_oauth_state_expires_idx").on(table.expiresAt)],
);

// Private cross-device preferences, chats and file organization (migration 0009).
export const accountState = sqliteTable(
  "account_state",
  {
    accountId: text("accountId").notNull(),
    key: text("key").notNull(),
    value: text("value"),
    revision: integer("revision").notNull().default(1),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.key] })],
);
