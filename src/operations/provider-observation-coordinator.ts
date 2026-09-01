import type { ExceptionNoticeRhythm } from "./exception-notice-rhythm.js";
import type {
  OperationsState,
  ProviderObservation,
  ProviderObservationTransition,
} from "./operations-state.js";
import {
  providerObservationIsFailure,
  type ProviderObservationInput,
} from "../providers/provider-health.js";

export interface ProviderObservationCoordinator {
  observe(input: ProviderObservationInput): Promise<ProviderObservationTransition>;
}

/**
 * Joins durable provider observations to the existing Exception Notice
 * rhythm.  State is written first; a notification outage therefore leaves a
 * visible observation that can be retried without duplicating the provider
 * event.  A changed failure status gets a different signature and cannot be
 * swallowed by grouping.
 */
export function createProviderObservationCoordinator(options: {
  readonly state: OperationsState;
  readonly notices: Pick<ExceptionNoticeRhythm, "admit" | "recordRecovery">;
}): ProviderObservationCoordinator {
  const noticeSignature = (observation: ProviderObservation): string =>
    `provider-observation:${observation.observationId}`;

  return {
    async observe(input): Promise<ProviderObservationTransition> {
      const transition = options.state.recordProviderObservation(input);
      if (!transition.isNewObservation) return transition;

      if (
        providerObservationIsFailure(transition.observation.status) &&
        transition.incidentStarted
      ) {
        const observation = transition.observation;
        await options.notices.admit({
          kind: "material-blocker",
          text: `Provider degradation: ${observation.provider} (${observation.status}).`,
          idempotencyKey: `provider-degradation:${observation.observationId}:${observation.lastObservedAt}`,
          signature: noticeSignature(observation),
        });
      }

      for (const recovered of transition.recovered) {
        const recoveryDetails = {
          text: `Provider recovered: ${recovered.provider} (${recovered.status}); observation ${recovered.observationId}${
            recovered.affectedWorkItemIds.length === 0
              ? ""
              : `; Work Items ${recovered.affectedWorkItemIds.join(", ")}`
          }; audits ${
            recovered.auditSequences.length === 0
              ? "none"
              : recovered.auditSequences.join(", ")
          }.`,
          idempotencyKey: `provider-recovery:${recovered.observationId}:${transition.observation.lastObservedAt}`,
        };
        const admission = await options.notices.recordRecovery(
          noticeSignature(recovered),
          recoveryDetails,
        );
        // If the first degradation notice was held or exhausted before it
        // reached Telegram, the generic rhythm correctly avoids a stale
        // recovery. A provider recovery is different: the CEO must still be
        // told that the dependency is healthy again, so enqueue one fresh,
        // independently-idempotent recovery notice.
        if (admission.kind === "recovered-without-delivery") {
          await options.notices.admit({
            kind: "recovery-notice",
            ...recoveryDetails,
          });
        }
      }
      return transition;
    },
  };
}
