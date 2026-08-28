import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  describeTokenResponse,
  googleCalendarScopes,
  upsertEnvValue,
} from "../../src/config/google-oauth.js";

describe("Google authorization URL", () => {
  const url = new URL(
    buildAuthorizationUrl({
      clientId: "client-123.apps.googleusercontent.com",
      redirectUri: "http://localhost:51234",
      state: "state-abc",
    }),
  );

  it("requests offline access with forced consent so a refresh token is returned", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("requests only the two least-privilege Calendar scopes", () => {
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    expect(googleCalendarScopes).not.toContain(
      "https://www.googleapis.com/auth/calendar",
    );
  });

  it("carries the loopback redirect and a state to match on the callback", () => {
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:51234",
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("client_id")).toBe(
      "client-123.apps.googleusercontent.com",
    );
  });
});

describe("Writing the refresh token into .env", () => {
  const name = "REAL_MING_GOOGLE_REFRESH_TOKEN";
  const value = "refresh-token-value-must-stay-in-the-file";

  it("fills a name that is present but empty", () => {
    const result = upsertEnvValue(
      `REAL_MING_GOOGLE_CLIENT_ID=abc\n${name}=\nREAL_MING_VAULT_KEY=def\n`,
      name,
      value,
    );

    expect(result).toBe(
      `REAL_MING_GOOGLE_CLIENT_ID=abc\n${name}=${value}\nREAL_MING_VAULT_KEY=def\n`,
    );
  });

  it("replaces an existing value without disturbing its neighbours", () => {
    const result = upsertEnvValue(
      `REAL_MING_GOOGLE_CLIENT_ID=abc\n${name}=stale\nREAL_MING_VAULT_KEY=def\n`,
      name,
      value,
    );

    expect(result).toContain(`${name}=${value}`);
    expect(result).not.toContain("stale");
    expect(result).toContain("REAL_MING_GOOGLE_CLIENT_ID=abc");
    expect(result).toContain("REAL_MING_VAULT_KEY=def");
  });

  it("appends the name when it is absent", () => {
    expect(
      upsertEnvValue("REAL_MING_VAULT_KEY=def\n", name, value),
    ).toBe(`REAL_MING_VAULT_KEY=def\n${name}=${value}\n`);
  });

  it("handles an empty file and a file with no trailing newline", () => {
    expect(upsertEnvValue("", name, value)).toBe(`${name}=${value}\n`);
    expect(upsertEnvValue("A=1", name, value)).toBe(
      `A=1\n${name}=${value}\n`,
    );
  });

  it("does not match a different name that shares a prefix", () => {
    const result = upsertEnvValue(
      `${name}_BACKUP=keep-me\n`,
      name,
      value,
    );

    expect(result).toContain(`${name}_BACKUP=keep-me`);
    expect(result).toContain(`${name}=${value}`);
  });

  it("preserves comments and blank lines", () => {
    const result = upsertEnvValue(
      `# Real-Ming\n\nREAL_MING_VAULT_KEY=def\n`,
      name,
      value,
    );

    expect(result.startsWith("# Real-Ming\n\n")).toBe(true);
    expect(result).toContain(`${name}=${value}`);
  });
});

describe("Reading Google's token response", () => {
  it("accepts a response carrying a refresh token", () => {
    expect(
      describeTokenResponse({
        access_token: "ignored",
        refresh_token: "the-refresh-token",
      }),
    ).toEqual({ refreshToken: "the-refresh-token" });
  });

  it("explains a missing refresh token as prior consent", () => {
    expect(() => describeTokenResponse({ access_token: "only" })).toThrow(
      /no refresh token/i,
    );
    expect(() => describeTokenResponse({ access_token: "only" })).toThrow(
      /myaccount\.google\.com\/permissions/,
    );
  });

  it("surfaces an error Google reports", () => {
    expect(() =>
      describeTokenResponse({ error: "invalid_grant" }),
    ).toThrow("Google refused the token exchange: invalid_grant.");
  });

  it("rejects an unreadable response", () => {
    expect(() => describeTokenResponse(null)).toThrow(
      "Google returned an unreadable token response.",
    );
  });
});
