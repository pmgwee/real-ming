import { nativeCronJobManifest } from "./native-cron-manifest.js";

process.stdout.write(`${JSON.stringify(nativeCronJobManifest, null, 2)}\n`);
