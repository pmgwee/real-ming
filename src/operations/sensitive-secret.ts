const sensitiveFieldPatterns: readonly RegExp[] = [
  /pass(word|phrase)/i,
  /secret/i,
  /token/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /credential/i,
  /recovery[-_]?(code|key|phrase)/i,
  /card[-_]?(number|cvv|cvc)/i,
  /\bcvv\b|\bcvc\b/i,
  /passport[-_]?(number|no)?/i,
  /identity[-_]?(card|document)/i,
  /\bic[-_]?(number|no)\b/i,
  /session[-_]?id/i,
  /authorization/i,
];

const sensitiveValuePatterns: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9-]{16,}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  // Telegram tokens occur as `.../bot<digits>:<token>` in URLs. The `bot`
  // prefix means a word-boundary-before-digits pattern misses the secret.
  /(?:\bbot)?\d{5,12}:[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Card and account numbers are commonly written in separated groups, so the
 * heuristic has to treat spaces and hyphens as part of the number.
 */
const accountNumberPattern = /\b(?:\d[ -]?){13,19}\b/;

/** 8-4-4-4-12 hex: the shape every record id in this system is written in. */
const recordIdentifierPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * A numeric-heavy identifier reads as a grouped account number once its
 * hyphens count as separators -- about one id in seven hundred and fifty.
 * Ids are removed before the heuristic runs, because refusing one blocks the
 * audit event and therefore the Work Item behind it.
 */
function looksLikeAccountNumber(value: string): boolean {
  const withoutIds = withoutRecordIdentifiers(value);
  return accountNumberPattern.test(withoutIds);
}

function withoutRecordIdentifiers(value: string): string {
  return value.replace(recordIdentifierPattern, (match) =>
    // An id with no hex letter in it is indistinguishable from a grouped
    // account number, so it keeps its place in the string.
    /[a-f]/iu.test(match) ? " " : match,
  );
}

export function detectSensitiveFields(
  payload: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  if (payload === undefined) {
    return [];
  }

  return Object.entries(payload)
    .filter(
      ([field, value]) =>
        sensitiveFieldPatterns.some((pattern) => pattern.test(field)) ||
        // A UUID tail followed by a delimiter can otherwise look exactly like
        // a Telegram bot token (`digits:token`). Strip only known mixed-case
        // record identifiers before value-pattern scanning; all-digit UUID
        // shapes remain subject to the account-number heuristic below.
        sensitiveValuePatterns.some((pattern) => pattern.test(withoutRecordIdentifiers(value))) ||
        looksLikeAccountNumber(value),
    )
    .map(([field]) => field);
}
