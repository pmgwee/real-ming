import { verifyControlPlaneDeployment } from "../runtime/control-plane-deployment-preflight.js";

const result = await verifyControlPlaneDeployment(process.cwd());
if (result.kind === "failed") {
  process.stderr.write(
    `Control-plane deployment preflight failed:\n${result.failures.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Control-plane deployment preflight passed.\n");
}
