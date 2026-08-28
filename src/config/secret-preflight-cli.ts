import { preflightTracerSecrets, tracerCredentials } from "./tracer-secrets.js";

const preflight = preflightTracerSecrets(process.env);

const required = tracerCredentials.filter(
  (credential) => credential.producedBy === undefined,
).length;

const lines = [
  `Tracer 1 secret preflight: ${preflight.present.length}/${required} supplied`,
  "",
  ...preflight.present.map((name) => `  supplied  ${name}`),
  ...preflight.missing.map((name) => `  missing   ${name}`),
  ...preflight.deferred.map(
    (entry) => `  deferred  ${entry.name} (produced by ${entry.producedBy})`,
  ),
  "",
  preflight.ready
    ? "Every credential you provision is supplied. No value was read, printed, or transmitted."
    : "Supply the missing names in the authorized secret store, then run this again.",
  ...(preflight.deferred.length === 0
    ? []
    : [
        "A deferred value is produced by a later ticket and does not block Gate 1.",
      ]),
];

process.stdout.write(`${lines.join("\n")}\n`);
process.exitCode = preflight.ready ? 0 : 1;
