/**
 * OAuth client credentials for the Antigravity gateway.
 *
 * This file is a TEMPLATE. Copy it to `credentials.ts` (which is git-ignored) and fill
 * in the values before building:
 *
 *     cp src/api/credentials.example.ts src/api/credentials.ts
 *
 * The values belong to Google's Antigravity desktop client, not to you, so they are
 * deliberately kept out of version control. Recover them from a local Antigravity or
 * Antigravity CLI installation, or from any of the open-source clients that talk to
 * this gateway.
 *
 * `CLIENT_SECRET` is an installed-application secret: it ships inside a desktop binary
 * and is not confidential in the usual sense. It is excluded here to keep the
 * repository clean of provider credentials, not because it protects anything.
 */

export const OAUTH_CLIENT_ID = 'REPLACE_ME.apps.googleusercontent.com';
export const OAUTH_CLIENT_SECRET = 'REPLACE_ME';
