import type { AuditEvent, WorkItemState } from "./contracts.js";

type LifecycleEvent = Extract<
  AuditEvent["type"],
  | "work-item.triaged"
  | "work-item.planned"
  | "work-item.awaiting-approval"
  | "work-item.executing"
  | "work-item.waiting-blocked"
  | "work-item.verifying"
  | "work-item.ready-for-ceo-review"
  | "work-item.completed"
  | "work-item.changes-requested"
  | "work-item.cancelled"
>;

interface LifecycleTransition {
  readonly from: WorkItemState;
  readonly to: WorkItemState;
  readonly event: LifecycleEvent;
}

const lifecycleTransitions: readonly LifecycleTransition[] = [
  { from: "Captured", to: "Triaged", event: "work-item.triaged" },
  { from: "Triaged", to: "Planned", event: "work-item.planned" },
  {
    from: "Planned",
    to: "Awaiting Approval",
    event: "work-item.awaiting-approval",
  },
  { from: "Planned", to: "Executing", event: "work-item.executing" },
  { from: "Awaiting Approval", to: "Executing", event: "work-item.executing" },
  {
    from: "Executing",
    to: "Waiting/Blocked",
    event: "work-item.waiting-blocked",
  },
  { from: "Executing", to: "Verifying", event: "work-item.verifying" },
  {
    from: "Verifying",
    to: "Waiting/Blocked",
    event: "work-item.waiting-blocked",
  },
  {
    from: "Verifying",
    to: "Ready for CEO Review",
    event: "work-item.ready-for-ceo-review",
  },
  { from: "Waiting/Blocked", to: "Planned", event: "work-item.planned" },
  { from: "Waiting/Blocked", to: "Executing", event: "work-item.executing" },
  {
    from: "Ready for CEO Review",
    to: "Completed",
    event: "work-item.completed",
  },
  {
    from: "Ready for CEO Review",
    to: "Changes Requested",
    event: "work-item.changes-requested",
  },
  {
    from: "Ready for CEO Review",
    to: "Cancelled",
    event: "work-item.cancelled",
  },
  { from: "Changes Requested", to: "Planned", event: "work-item.planned" },
];

const advanceableStates: readonly WorkItemState[] = [
  "Captured",
  "Triaged",
  "Planned",
  "Awaiting Approval",
  "Waiting/Blocked",
  "Changes Requested",
];

export function lifecycleEventFor(
  from: WorkItemState,
  to: WorkItemState,
): LifecycleEvent | undefined {
  return lifecycleTransitions.find(
    (transition) => transition.from === from && transition.to === to,
  )?.event;
}

export function lifecyclePathTo(
  from: WorkItemState,
  to: WorkItemState,
): readonly WorkItemState[] | undefined {
  if (from === to || !advanceableStates.includes(from)) {
    return undefined;
  }

  const cameFrom = new Map<WorkItemState, WorkItemState>();
  const visited = new Set<WorkItemState>([from]);
  const queue: WorkItemState[] = [from];

  while (queue.length > 0) {
    const current = queue.shift() as WorkItemState;

    for (const transition of lifecycleTransitions) {
      if (
        transition.from !== current ||
        transition.to === "Ready for CEO Review" ||
        visited.has(transition.to)
      ) {
        continue;
      }
      visited.add(transition.to);
      cameFrom.set(transition.to, current);

      if (transition.to === to) {
        const path: WorkItemState[] = [];
        let step: WorkItemState | undefined = to;
        while (step !== undefined && step !== from) {
          path.unshift(step);
          step = cameFrom.get(step);
        }
        return path;
      }

      queue.push(transition.to);
    }
  }

  return undefined;
}
