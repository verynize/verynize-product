// Better Auth identity layer: email + password accounts and organizations, stored in D1 (env.DB).
//
// The instance is created per request because Worker bindings only exist inside fetch. The
// options are split out so scripts/auth-schema.mjs can generate cloud/migrations from the same
// configuration against node:sqlite. Sessions travel only as `Authorization: Bearer` tokens
// (bearer plugin): the Worker drops request cookies and response Set-Cookie headers, so there
// are no ambient credentials and Better Auth's cookie CSRF check is disabled. It would otherwise
// refuse the desktop renderer, whose app://verynize page sends `Origin: app://verynize` (older
// file:// builds sent `Origin: null`). Redirect and callback
// URLs are still checked against trusted origins. Rate limiting is done by the Worker with
// the AUTH_LIMIT binding: Better Auth's built-in limiter keeps state in isolate memory, which is
// not shared between Workers isolates.
import { and, count, eq, gt } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { database } from "./db.js";
import * as schema from "./schema.js";
import { betterAuth } from "better-auth";
import { bearer, organization } from "better-auth/plugins";
import { adminAc, defaultAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { sendMail } from "./mail.js";
import { organizationHooks } from "./orgs.js";

export const AUTH_BASE_PATH = "/api/auth";

const directory = (env) => env.ACCOUNTS.getByName("directory");

/** Options shared by the Worker and the schema generator. `env` may be partial in scripts. */
export function authOptions(env = {}, { baseURL, database } = {}) {
  const mail = (message) => sendMail(env, directory(env), message);
  return {
    appName: "Verynize",
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mail({
          to: user.email,
          subject: "Reset your Verynize password",
          text: `Reset your password: ${url}\n\nThe link expires in one hour. If you did not ask for this, ignore this email.`,
          link: url,
        });
      },
    },
    // Emailed links land on server pages (cloud/account-pages.js): clients pass
    // callbackURL "/account/verified" and redirectTo "/account/reset-password".
    emailVerification: {
      sendOnSignUp: true,
      // An unverified sign-in attempt (403 EMAIL_NOT_VERIFIED) emails a fresh link.
      sendOnSignIn: true,
      // The link opens in a browser, and cookies are not used, so a session there would be lost.
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await mail({
          to: user.email,
          subject: "Verify your Verynize email",
          text: `Confirm your email address: ${url}`,
          link: url,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: false },
    advanced: {
      disableCSRFCheck: true,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    telemetry: { enabled: false },
    plugins: [
      bearer(),
      organization({
        // Workspace roles: owner, admin, member (room role from metadata.roomRole) and the
        // custom viewer / editor, which pin one member's room role (cloud/orgs.js roomRoleFor).
        // Viewers and editors have a member's organization permissions.
        ac: defaultAc,
        roles: {
          owner: ownerAc,
          admin: adminAc,
          member: memberAc,
          editor: defaultAc.newRole(memberAc.statements),
          viewer: defaultAc.newRole(memberAc.statements),
        },
        // Room access follows membership (cloud/orgs.js); these push changes to live sockets.
        organizationHooks: organizationHooks(env),
        sendInvitationEmail: async ({ email, organization: org, inviter, id }) => {
          const link = `${baseURL}/#invitation=${id}`;
          await mail({
            to: email,
            subject: `${inviter.user.name || inviter.user.email} invited you to ${org.name} on Verynize`,
            text: `Join ${org.name}: ${link}`,
            link,
          });
        },
      }),
    ],
  };
}

/** The Better Auth instance for one request. */
export function createAuth(env, request) {
  const baseURL = env.AUTH_URL || new URL(request.url).origin;
  return betterAuth(
    authOptions(env, {
      baseURL,
      database: drizzleAdapter(database(env), { provider: "sqlite", schema, transaction: false }),
    }),
  );
}

/** Count active sessions without the fresh-session requirement of listSessions. */
export async function activeSessionCount(env, userId) {
  const [result] = await database(env)
    .select({ total: count() })
    .from(schema.session)
    .where(
      and(
        eq(schema.session.userId, userId),
        gt(schema.session.expiresAt, new Date().toISOString()),
      ),
    );
  return result.total;
}
