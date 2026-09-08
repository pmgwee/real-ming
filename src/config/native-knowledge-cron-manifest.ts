import { operatingTimeZone } from "../operations/daily-schedule.js";
import { NATIVE_KNOWLEDGE_LIMITS } from "../knowledge/native-consolidation/contracts.js";

export interface NativeKnowledgeCronManifestEntry {
  readonly id: "real-ming-native-knowledge-consolidation";
  readonly name: string;
  readonly schedule: "0 2 * * *";
  readonly timeZone: typeof operatingTimeZone;
  readonly delivery: "local";
  readonly active: false;
  readonly wrapper: string;
  readonly skipMemory: true;
  readonly mcpTools: readonly [
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
  ];
  readonly generatedRoot: "${OBSIDIAN_VAULT_PATH}/.real-ming/generated";
  readonly stagingRoot: "${OBSIDIAN_VAULT_PATH}/.real-ming/staging";
  readonly limits: typeof NATIVE_KNOWLEDGE_LIMITS;
  readonly authProfileEnv: "HERMES_KNOWLEDGE_AUTH_PROFILE";
}

/** Inactive, secret-free proposal. Listing this value has no scheduler side effect. */
export const nativeKnowledgeCronManifest: NativeKnowledgeCronManifestEntry = {
  id: "real-ming-native-knowledge-consolidation",
  name: "Real-Ming Native Knowledge Consolidation",
  schedule: "0 2 * * *",
  timeZone: operatingTimeZone,
  delivery: "local",
  active: false,
  wrapper: "hermes/scripts/run-native-knowledge-consolidation.py",
  skipMemory: true,
  mcpTools: [
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
  ],
  generatedRoot: "${OBSIDIAN_VAULT_PATH}/.real-ming/generated",
  stagingRoot: "${OBSIDIAN_VAULT_PATH}/.real-ming/staging",
  limits: NATIVE_KNOWLEDGE_LIMITS,
  authProfileEnv: "HERMES_KNOWLEDGE_AUTH_PROFILE",
};
