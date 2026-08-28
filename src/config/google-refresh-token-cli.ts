import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

import {
  buildAuthorizationUrl,
  describeTokenResponse,
  googleCalendarScopes,
  googleTokenEndpoint,
  upsertEnvValue,
} from "./google-oauth.js";

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

function writeRefreshToken(refreshToken: string): void {
  let existing = "";
  try {
    existing = readFileSync(envPath, "utf8");
  } catch {
    existing = "";
  }

  writeFileSync(
    envPath,
    upsertEnvValue(existing, "REAL_MING_GOOGLE_REFRESH_TOKEN", refreshToken),
    "utf8",
  );
}

async function main(): Promise<number> {
  const clientId = requireEnv("REAL_MING_GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("REAL_MING_GOOGLE_CLIENT_SECRET");
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
          `Scopes requested: ${googleCalendarScopes.join(", ")}`,
          "",
          "1. Open this URL in the browser signed in as the calendar owner:",
          "",
          buildAuthorizationUrl({ clientId, redirectUri, state }),
          "",
          '2. Expect an "unverified app" warning. Choose Advanced, then continue.',
          "3. Approve both Calendar permissions.",
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
