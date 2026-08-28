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
  /\b\d{5,12}:[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:\d[ -]?){13,19}\b/,
];

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
        sensitiveValuePatterns.some((pattern) => pattern.test(value)),
    )
    .map(([field]) => field);
}
