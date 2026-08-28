export const googleCalendarScopes: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export const googleAuthorizationEndpoint =
  "https://accounts.google.com/o/oauth2/v2/auth";

export const googleTokenEndpoint = "https://oauth2.googleapis.com/token";

export function buildAuthorizationUrl(request: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scopes?: readonly string[];
}): string {
  const url = new URL(googleAuthorizationEndpoint);
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    (request.scopes ?? googleCalendarScopes).join(" "),
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", request.state);
  return url.toString();
}

export function upsertEnvValue(
  contents: string,
  name: string,
  value: string,
): string {
  const lines = contents.length === 0 ? [] : contents.split(/\r?\n/);
  const assignment = `${name}=${value}`;
  let replaced = false;

  const updated = lines.map((line) => {
    if (replaced || !line.startsWith(`${name}=`)) {
      return line;
    }
    replaced = true;
    return assignment;
  });

  if (!replaced) {
    if (updated.length > 0 && updated[updated.length - 1] === "") {
      updated[updated.length - 1] = assignment;
    } else {
      updated.push(assignment);
    }
  }

  const joined = updated.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

export function describeTokenResponse(payload: unknown): {
  readonly refreshToken: string;
} {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Google returned an unreadable token response.");
  }

  const record = payload as Record<string, unknown>;
  if (typeof record["error"] === "string") {
    throw new Error(
      `Google refused the token exchange: ${record["error"]}. Re-run the helper.`,
    );
  }

  const refreshToken = record["refresh_token"];
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new Error(
      "Google returned no refresh token. This happens when the account has already consented; the helper requests prompt=consent to avoid it, so revoke Real-Ming at https://myaccount.google.com/permissions and run it again.",
    );
  }

  return { refreshToken };
}
