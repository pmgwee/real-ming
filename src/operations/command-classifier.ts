import type {
  CeoCommand,
  CommandClassification,
  CommandClassifier,
} from "./contracts.js";

const informationRequestPatterns = [
  /^(what|when|where|which|who|why|how|is|are|was|were|do i)\b/,
  /^(please\s+)?(tell me|show me|explain|summarize|list|give me)\b/,
  /^(can|could|may|would)\s+(i|we|you)\s+(please\s+)?(see|view|know|get|check|review|tell|show|explain|summarize|list|give)\b/,
] as const;

function isInformationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return informationRequestPatterns.some((pattern) => pattern.test(normalized));
}

export function createCommandClassifier(): CommandClassifier {
  return {
    classify(command: CeoCommand): CommandClassification {
      if (command.expectedEffect !== undefined) {
        return { kind: "action" };
      }

      if (isInformationRequest(command.text)) {
        return { kind: "information-question" };
      }

      return { kind: "ambiguous" };
    },
  };
}
