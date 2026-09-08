import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

import {
  buildAuthorizationUrl,
  describeTokenResponse,
  googleCalendarScopes,
  googleMailScopes,
  googleTokenEndpoint,
  upsertEnvValue,
} from "./google-oauth.js";

/**
 * The mailbox this run authorizes, or undefined for the calendar credential.
 *
 * Ming authorizes three Google accounts for different purposes, so the run
 * names which one it is for. Without that, the second consent silently
 * overwrites the first and nobody notices until a brief reads the wrong
 * inbox.
 */
function requestedMailbox(): string | undefined {
  const flag = process.argv.indexOf("--mailbox");
  if (flag === -1) return undefined;
  const value = process.argv[flag + 1]?.trim();
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error("--mailbox needs an address, e.g. --mailbox you@gmail.com");
  }
  return value;
}

const envPath = new URL("../../.env", import.meta.url);

function requireEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) {
    throw new Error(
      `${name} is not set. Fill it in .env from the Branding step first.`,
    );
  }
  return value;
}

async function exchangeCode(request: {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}): Promise<string> {
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: request.code,
      client_id: request.clientId,
      client_secret: request.clientSecret,
      redirect_uri: request.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  return describeTokenResponse(await response.json()).refreshToken;
}

function readEnv(): string {
  try {
    return readFileSync(envPath, "utf8");
  } catch {
    return "";
  }
}

function writeRefreshToken(refreshToken: string): void {
  writeFileSync(
    envPath,
    upsertEnvValue(readEnv(), "REAL_MING_GOOGLE_REFRESH_TOKEN", refreshToken),
    "utf8",
  );
}

/**
 * Mailbox tokens live in one JSON map rather than a variable per address, so
 * adding a fourth mailbox needs no new configuration name and no new Key Vault
 * secret. Existing entries are merged, never replaced.
 */
function writeMailRefreshToken(mailbox: string, refreshToken: string): void {
  const existing = readEnv();
  const current = /^REAL_MING_MAIL_REFRESH_TOKENS=(.*)$/m.exec(existing);
  let tokens: Record<string, string> = {};
  if (current?.[1] !== undefined && current[1].trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(current[1].trim());
      if (typeof parsed === "object" && parsed !== null) {
        tokens = parsed as Record<string, string>;
      }
    } catch {
      throw new Error(
        "REAL_MING_MAIL_REFRESH_TOKENS is not valid JSON. Fix or clear it before running again; nothing was written.",
      );
    }
  }
  tokens[mailbox] = refreshToken;
  writeFileSync(
    envPath,
    upsertEnvValue(
      existing,
      "REAL_MING_MAIL_REFRESH_TOKENS",
      JSON.stringify(tokens),
    ),
    "utf8",
  );
}

/**
 * Refuses a token that belongs to a different account than the one asked for.
 *
 * With three Google accounts signed in to one browser, consenting as the wrong
 * one is the likeliest mistake, and it fails silently: the token works, it just
 * reads someone else's mail.
 */
async function accountOf(refreshToken: string, request: {
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<string | undefined> {
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: request.clientId,
      client_secret: request.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload: unknown = await response.json();
  const accessToken =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)["access_token"] === "string"
      ? ((payload as Record<string, unknown>)["access_token"] as string)
      : undefined;
  if (accessToken === undefined) return undefined;
  const profile = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!profile.ok) return undefined;
  const body: unknown = await profile.json();
  return typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>)["email"] === "string"
    ? ((body as Record<string, unknown>)["email"] as string)
    : undefined;
}

async function main(): Promise<number> {
  const clientId = requireEnv("REAL_MING_GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("REAL_MING_GOOGLE_CLIENT_SECRET");
  const mailbox = requestedMailbox();
  const scopes = mailbox === undefined ? googleCalendarScopes : googleMailScopes;
  const state = randomUUID();

  return new Promise<number>((resolve) => {
    const server = createServer((request, response) => {
      void (async () => {
        const address = server.address();
        const port =
          address !== null && typeof address !== "string" ? address.port : 0;
        const url = new URL(request.url ?? "/", `http://localhost:${port}`);

        const finish = (status: number, message: string): void => {
          response.writeHead(status, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            `<!doctype html><meta charset="utf-8"><title>Real-Ming</title>` +
              `<body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">` +
              `<h1 style="font-size:1.3rem">${message}</h1>` +
              `<p style="color:#666">You can close this tab and return to the terminal.</p>`,
          );
        };

        const failure = url.searchParams.get("error");
        if (failure !== null) {
          finish(400, "Consent was refused.");
          process.stderr.write(`Google reported: ${failure}\n`);
          server.close();
          resolve(1);
          return;
        }

        const code = url.searchParams.get("code");
        if (code === null) {
          finish(400, "No authorization code was returned.");
          return;
        }
        if (url.searchParams.get("state") !== state) {
          finish(400, "The state parameter did not match.");
          process.stderr.write(
            "The callback state did not match. Nothing was written.\n",
          );
          server.close();
          resolve(1);
          return;
        }

        try {
          const refreshToken = await exchangeCode({
            code,
            clientId,
            clientSecret,
            redirectUri: `http://localhost:${port}`,
          });
          if (mailbox !== undefined) {
            const granted = await accountOf(refreshToken, {
              clientId,
              clientSecret,
            });
            if (granted !== undefined && granted.toLowerCase() !== mailbox.toLowerCase()) {
              // Writing this would point the mailbox at someone else's inbox
              // and nothing downstream could tell.
              finish(400, "That consent was given by the wrong account.");
              process.stderr.write(
                `Asked for ${mailbox} but consent came from ${granted}. ` +
                  "Nothing was written. Sign out of the other account, or use " +
                  "a private window, and run it again.\n",
              );
              server.close();
              resolve(1);
              return;
            }
            writeMailRefreshToken(mailbox, refreshToken);
            finish(200, "Mailbox refresh token stored.");
            process.stdout.write(
              `\nREAL_MING_MAIL_REFRESH_TOKENS updated in .env for ${mailbox}.\n` +
                (granted === undefined
                  ? "The account could not be confirmed; verify it before use.\n"
                  : `Confirmed as ${granted}.\n`) +
                "The value was not printed, logged, or transmitted anywhere else.\n" +
                "Store it in Key Vault as real-ming-mail-refresh-tokens.\n",
            );
            server.close();
            resolve(0);
            return;
          }
          writeRefreshToken(refreshToken);
          finish(200, "Refresh token stored.");
          process.stdout.write(
            "\nREAL_MING_GOOGLE_REFRESH_TOKEN written to .env.\n" +
              "The value was not printed, logged, or transmitted anywhere else.\n" +
              "Verify with: npm run secrets:preflight\n",
          );
          server.close();
          resolve(0);
        } catch (error) {
          finish(500, "The token exchange failed.");
          process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`,
          );
          server.close();
          resolve(1);
        }
      })();
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        process.stderr.write("Could not bind a local callback port.\n");
        resolve(1);
        return;
      }

      const redirectUri = `http://localhost:${address.port}`;
      process.stdout.write(
        [
          "",
          "Real-Ming Google refresh token helper",
          "",
          `Scopes requested: ${scopes.join(", ")}`,
          "",
          mailbox === undefined
            ? "1. Open this URL in the browser signed in as the calendar owner:"
            : `1. Open this URL and consent AS ${mailbox}. Any other account is refused.`,
          "",
          buildAuthorizationUrl({
            clientId,
            redirectUri,
            state,
            scopes,
            ...(mailbox === undefined ? {} : { loginHint: mailbox }),
          }),
          "",
          '2. Expect an "unverified app" warning. Choose Advanced, then continue.',
          mailbox === undefined
            ? "3. Approve the Calendar permissions."
            : "3. Approve the Gmail permissions. Real-Ming reads mail and writes drafts; it never sends.",
          "",
          "Waiting for the callback...",
          "",
        ].join("\n"),
      );
    });
  });
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
