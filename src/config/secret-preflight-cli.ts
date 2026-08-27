import { preflightTracerSecrets, tracerCredentials } from "./tracer-secrets.js";

const preflight = preflightTracerSecrets(process.env);

const lines = [
  `Tracer 1 secret preflight: ${preflight.present.length}/${tracerCredentials.length} supplied`,
  "",
  ...preflight.present.map((name) => `  supplied  ${name}`),
  ...preflight.missing.map((name) => `  missing   ${name}`),
  "",
  preflight.ready
    ? "Every credential name is supplied. No value was read, printed, or transmitted."
    : "Supply the missing names in the authorized secret store, then run this again.",
];

process.stdout.write(`${lines.join("\n")}\n`);
process.exitCode = preflight.ready ? 0 : 1;
