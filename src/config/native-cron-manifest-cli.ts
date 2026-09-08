import { nativeCronJobManifest } from "./native-cron-manifest.js";
import { nativeKnowledgeCronManifest } from "./native-knowledge-cron-manifest.js";

process.stdout.write(`${JSON.stringify({
  reports: nativeCronJobManifest,
  knowledgeConsolidation: nativeKnowledgeCronManifest,
}, null, 2)}\n`);
