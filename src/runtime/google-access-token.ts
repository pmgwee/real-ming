import { googleTokenEndpoint } from "../config/google-oauth.js";

export type AccessTokenResult =
  | { readonly kind: "ok"; readonly accessToken: string; readonly expiresAt: number }
  | { readonly kind: "failed"; readonly reason: "refused" | "unavailable" };

export interface GoogleAccessTokens {
  current(): Promise<AccessTokenResult>;
}

/** Refresh a minute early, so a token does not expire mid-request. */
const renewalMarginMs = 60_000;

/**
 * Exchange the long-lived refresh token for the short-lived access token the
 * Calendar adapter needs, and hold it until shortly before it expires.
 *
 * The response body is never read on a failure path. Google echoes the client
 * identifier in its error payloads, and this runs inside a service whose every
 * log line goes to the journal.
 */
export function createGoogleAccessTokens(options: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}): GoogleAccessTokens {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  let held: { readonly accessToken: string; readonly expiresAt: number } | null =
    null;

  return {
    async current(): Promise<AccessTokenResult> {
      const cached = held;
      if (cached !== null && cached.expiresAt - renewalMarginMs > now()) {
        return { kind: "ok", ...cached };
      }

      let response: Response;
      try {
        response = await request(googleTokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            refresh_token: options.refreshToken,
            grant_type: "refresh_token",
          }).toString(),
        });
      } catch {
        return { kind: "failed", reason: "unavailable" };
      }

      // A revoked or rotated refresh token is a CEO action, not a retry.
      if (response.status === 400 || response.status === 401) {
        return { kind: "failed", reason: "refused" };
      }
      if (!response.ok) return { kind: "failed", reason: "unavailable" };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: "failed", reason: "unavailable" };
      }

      const payload = body as {
        readonly access_token?: unknown;
        readonly expires_in?: unknown;
      };
      if (
        typeof payload.access_token !== "string" ||
        payload.access_token.trim().length === 0
      ) {
        return { kind: "failed", reason: "unavailable" };
      }
      const lifetimeSeconds =
        typeof payload.expires_in === "number" && payload.expires_in > 0
          ? payload.expires_in
          : 3600;
      held = {
        accessToken: payload.access_token,
        expiresAt: now() + lifetimeSeconds * 1000,
      };
      return { kind: "ok", ...held };
    },
  };
}
