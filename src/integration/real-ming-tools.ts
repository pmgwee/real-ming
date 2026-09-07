import type { WorkItem, WorkItemState } from "../operations/contracts.js";
import type { ExecutionLinkStore } from "./execution-link.js";
import type { NativeScheduledReportRequest } from "../operations/native-scheduled-reports.js";
import type { NativeCronReportClient } from "./native-cron-client.js";

/**
 * The Real-Ming extension: the small set of operations native Hermes cannot
 * perform for itself.
 *
 * Revision 6 makes Hermes the runtime, so this is deliberately not a planner,
 * not a router and not a second agent. It answers two questions the native
 * runtime has no way to answer — what work exists and what it means — and
 * records one fact it has no way to record: which native task did which work.
 */

export interface RealMingToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type RealMingToolResult =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "failed"; readonly reason: string };

export interface RealMingTools {
  list(): readonly RealMingToolDefinition[];
  call(name: string, args: Record<string, unknown>): RealMingToolResult;
  /** Optional asynchronous boundary used by the provider-backed tools. */
  callAsync?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<RealMingToolResult>;
}

/** One calendar entry, reduced to what a briefing actually reads out. */
export interface CalendarAgendaEntry {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly status: string;
}

export type CalendarAgendaResult =
  | { readonly kind: "ok"; readonly events: readonly CalendarAgendaEntry[] }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The narrow slice of calendar reading the extension needs.
 *
 * Deliberately not the provider adapter type: the extension states what it
 * asks for and the composition root decides what satisfies it, so a controlled
 * calendar and the real Google adapter are the same shape here.
 */
export interface CalendarAgendaClient {
  listEvents(request: {
    readonly calendarId: string;
    readonly from?: string;
    readonly to?: string;
  }): Promise<CalendarAgendaResult>;
}

/**
 * The Notion board category a lifecycle state presents as, per
 * `docs/agents/notion-task-status-semantics.md`.
 *
 * States with no board equivalent return null rather than being rounded to the
 * nearest one. Rounding is how `Ready for CEO Review` becomes `Done`, which is
 * the specific mistake the semantics document exists to prevent.
 */
export function notionCategoryForLifecycle(state: WorkItemState): string | null {
  switch (state) {
    case "Captured":
      return "Pending";
    case "Planned":
      return "To Do";
    case "Waiting/Blocked":
      return "Issues";
    case "Ready for CEO Review":
      return "Pending to Review";
    case "Completed":
      return "Done";
    default:
      return null;
  }
}

/** Only one lifecycle state means the work is finished. */
export function isCompleted(state: WorkItemState): boolean {
  return state === "Completed";
}

/** States where nothing moves until Ming decides. */
export function awaitsCeoDecision(state: WorkItemState): boolean {
  return state === "Awaiting Approval" || state === "Ready for CEO Review";
}

interface WorkItemView {
  readonly id: string;
  readonly intent: string;
  readonly state: WorkItemState;
  readonly notionCategory: string | null;
  readonly completed: boolean;
  readonly awaitingCeoDecision: boolean;
  readonly accountableExecutive: string;
  readonly workstream: string | null;
  readonly updatedAt: string;
}

function viewOf(workItem: WorkItem): WorkItemView {
  return {
    id: workItem.id,
    intent: workItem.intent,
    state: workItem.state,
    notionCategory: notionCategoryForLifecycle(workItem.state),
    completed: isCompleted(workItem.state),
    awaitingCeoDecision: awaitsCeoDecision(workItem.state),
    accountableExecutive: workItem.accountableExecutive,
    workstream: workItem.workstream,
    updatedAt: workItem.updatedAt,
  };
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function createRealMingTools(options: {
  readonly workItems: () => readonly WorkItem[];
  readonly workItem: (id: string) => WorkItem | undefined;
  readonly links: ExecutionLinkStore;
  readonly now: () => string;
  /** Present only when native Hermes cron has been staged for this process. */
  readonly scheduledReports?: NativeCronReportClient;
  /** Present only where an authorized calendar credential is configured. */
  readonly calendar?: CalendarAgendaClient;
  /** The calendar read when the caller names none. */
  readonly defaultCalendarId?: string;
}): RealMingTools {
  const scheduledReports = options.scheduledReports;
  const calendar = options.calendar;
  const definitions: readonly RealMingToolDefinition[] = [
    {
      name: "real_ming_list_work_items",
      description:
        "List Ming's Work Items with their canonical lifecycle state and the Notion board category each one presents as. Use before summarising what is outstanding. 'Ready for CEO Review' is NOT completed.",
      inputSchema: {
        type: "object",
        properties: {
          state: {
            type: "string",
            description: "Optional exact lifecycle state to filter by.",
          },
          accountableExecutive: {
            type: "string",
            description: "Optional role filter: COO, CTO, Personal CFO, CAO, CMO.",
          },
          limit: { type: "number", description: "Maximum items to return." },
        },
      },
    },
    {
      name: "real_ming_get_work_item",
      description:
        "Read one Work Item in full, including any native execution tasks already linked to it.",
      inputSchema: {
        type: "object",
        properties: { workItemId: { type: "string" } },
        required: ["workItemId"],
      },
    },
    {
      name: "real_ming_link_execution_task",
      description:
        "Record that a native Hermes task did the work for a Work Item. Idempotent: pass a stable idempotencyKey and a retry will not create a second link.",
      inputSchema: {
        type: "object",
        properties: {
          workItemId: { type: "string" },
          nativeTaskId: {
            type: "string",
            description: "The native Hermes session or Kanban task identifier.",
          },
          idempotencyKey: {
            type: "string",
            description:
              "Stable key for this link. Reuse it on retry so a replay is a read, not a duplicate.",
          },
        },
        required: ["workItemId", "nativeTaskId", "idempotencyKey"],
      },
    },
    ...(scheduledReports === undefined
      ? []
      : [
          {
            name: "real_ming_run_scheduled_report",
            description:
              "Compose one Real-Ming morning brief or executive roll-up for native Hermes cron. Return the exact text field as your final response so Hermes can deliver it through its native Telegram gateway. If delivery is skipped, return [SILENT]. Do not call Telegram tools or add a preamble.",
            inputSchema: {
              type: "object",
              properties: {
                job: {
                  type: "string",
                  enum: ["morning-brief", "executive-roll-up"],
                },
                runId: {
                  type: "string",
                  description: "Native Hermes cron execution/session identifier.",
                },
                occurrenceDate: {
                  type: "string",
                  description: "Optional Kuala Lumpur operating date (YYYY-MM-DD).",
                },
              },
              required: ["job"],
            },
          } satisfies RealMingToolDefinition,
        ]),
    ...(calendar === undefined
      ? []
      : [
          {
            name: "real_ming_list_calendar_events",
            description:
              "Read Ming's calendar for a time window. Use for questions about his schedule, availability or what is coming up. Returns only events the calendar actually holds; if the calendar cannot be reached this fails rather than reporting a clear day.",
            inputSchema: {
              type: "object",
              properties: {
                calendarId: {
                  type: "string",
                  description:
                    "Optional calendar to read. Defaults to Ming's configured calendar.",
                },
                from: {
                  type: "string",
                  description:
                    "Optional ISO-8601 start of the window, inclusive.",
                },
                to: {
                  type: "string",
                  description: "Optional ISO-8601 end of the window, exclusive.",
                },
              },
            },
          } satisfies RealMingToolDefinition,
        ]),
  ];

  const scheduledReportRequest = (
    args: Record<string, unknown>,
  ): NativeScheduledReportRequest | undefined => {
    const job = requiredString(args, "job");
    if (job !== "morning-brief" && job !== "executive-roll-up") return undefined;
    const runId = args["runId"];
    const occurrenceDate = args["occurrenceDate"];
    return {
      job,
      ...(typeof runId === "string" && runId.trim().length > 0
        ? { runId: runId.trim() }
        : {}),
      ...(typeof occurrenceDate === "string" && occurrenceDate.trim().length > 0
        ? { occurrenceDate: occurrenceDate.trim() }
        : {}),
    };
  };

  const readCalendar = async (
    args: Record<string, unknown>,
  ): Promise<RealMingToolResult> => {
    if (calendar === undefined) {
      return {
        kind: "failed",
        reason: "No calendar is configured for this Real-Ming process.",
      };
    }
    const calendarId =
      requiredString(args, "calendarId") ?? options.defaultCalendarId;
    if (calendarId === undefined) {
      return {
        kind: "failed",
        reason:
          "calendarId is required because no default calendar is configured.",
      };
    }
    const from = requiredString(args, "from");
    const to = requiredString(args, "to");
    const result = await calendar.listEvents({
      calendarId,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
    if (result.kind === "unavailable") {
      // An empty agenda and an unreachable calendar are indistinguishable once
      // reported as "no events", and the second one tells Ming his day is
      // clear when nothing ever looked at it.
      return {
        kind: "failed",
        reason: `The calendar could not be read: ${result.reason}`,
      };
    }
    return {
      kind: "ok",
      value: { calendarId, events: result.events },
    };
  };

  const tools: RealMingTools = {
    list: () => definitions,
    call(name, args) {
      switch (name) {
        case "real_ming_list_work_items": {
          const state = requiredString(args, "state");
          const executive = requiredString(args, "accountableExecutive");
          const rawLimit = args["limit"];
          const limit =
            typeof rawLimit === "number" && Number.isSafeInteger(rawLimit) && rawLimit > 0
              ? rawLimit
              : 50;
          const matching = options
            .workItems()
            .filter((item) => state === undefined || item.state === state)
            .filter(
              (item) =>
                executive === undefined || item.accountableExecutive === executive,
            );
          return {
            kind: "ok",
            value: {
              total: matching.length,
              returned: Math.min(matching.length, limit),
              workItems: matching.slice(0, limit).map(viewOf),
            },
          };
        }
        case "real_ming_get_work_item": {
          const workItemId = requiredString(args, "workItemId");
          if (workItemId === undefined) {
            return { kind: "failed", reason: "workItemId is required." };
          }
          const workItem = options.workItem(workItemId);
          if (workItem === undefined) {
            // A missing record is reported, never invented. An agent that gets
            // a plausible-looking empty object will summarise it as real work.
            return { kind: "failed", reason: `No Work Item ${workItemId}.` };
          }
          return {
            kind: "ok",
            value: {
              ...viewOf(workItem),
              executionTasks: options.links.forWorkItem(workItem.id),
            },
          };
        }
        case "real_ming_link_execution_task": {
          const workItemId = requiredString(args, "workItemId");
          const nativeTaskId = requiredString(args, "nativeTaskId");
          const idempotencyKey = requiredString(args, "idempotencyKey");
          if (
            workItemId === undefined ||
            nativeTaskId === undefined ||
            idempotencyKey === undefined
          ) {
            return {
              kind: "failed",
              reason:
                "workItemId, nativeTaskId and idempotencyKey are all required.",
            };
          }
          if (options.workItem(workItemId) === undefined) {
            // Linking to a Work Item that does not exist would create a record
            // pointing at nothing, which reads as evidence later.
            return { kind: "failed", reason: `No Work Item ${workItemId}.` };
          }
          const result = options.links.link({
            workItemId,
            nativeTaskId,
            idempotencyKey,
            linkedAt: options.now(),
          });
          return {
            kind: "ok",
            value: { ...result.link, deduplicated: result.deduplicated },
          };
        }
        case "real_ming_run_scheduled_report":
          return scheduledReports === undefined
            ? {
                kind: "failed",
                reason: "Native Hermes cron report composition is not enabled.",
              }
            : {
                kind: "failed",
                reason:
                  "This scheduled report tool requires the asynchronous MCP call path.",
              };
        case "real_ming_list_calendar_events":
          return calendar === undefined
            ? {
                kind: "failed",
                reason: "No calendar is configured for this Real-Ming process.",
              }
            : {
                kind: "failed",
                reason:
                  "Reading the calendar requires the asynchronous MCP call path.",
              };
        default:
          return { kind: "failed", reason: `Unknown tool ${name}.` };
      }
    },
  };

  if (scheduledReports === undefined && calendar === undefined) return tools;

  return {
    ...tools,
    callAsync: async (name: string, args: Record<string, unknown>) => {
      if (name === "real_ming_list_calendar_events") return readCalendar(args);
      if (name !== "real_ming_run_scheduled_report") {
        // Everything else is synchronous; route it back through the same
        // implementation rather than a second copy that can drift.
        return tools.call(name, args);
      }
      if (scheduledReports === undefined) {
        return {
          kind: "failed" as const,
          reason: "Native Hermes cron report composition is not enabled.",
        };
      }
      const request = scheduledReportRequest(args);
      if (request === undefined) {
        return {
          kind: "failed" as const,
          reason:
            "job is required and must be morning-brief or executive-roll-up.",
        };
      }
      return scheduledReports.run(request);
    },
  };
}
