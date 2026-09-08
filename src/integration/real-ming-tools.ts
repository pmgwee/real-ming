import type { WorkItem, WorkItemState } from "../operations/contracts.js";
import type { ExecutionLinkStore } from "./execution-link.js";
import type { NativeScheduledReportRequest } from "../operations/native-scheduled-reports.js";
import type { NativeCronReportClient } from "./native-cron-client.js";
import type {
  CaptureResult,
  NativeKnowledgeCandidate,
  SourceSnapshot,
  WikiRetrieveRequest,
} from "../knowledge/native-consolidation/contracts.js";
import { captureCandidate } from "../knowledge/native-consolidation/evidence.js";
import { wikiRetrieve } from "../knowledge/native-consolidation/retrieval.js";
import type { NativeKnowledgeRegistry } from "../knowledge/native-consolidation/registry.js";

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

/**
 * Optional native-knowledge boundary. It is absent from ordinary Real-Ming
 * processes and becomes available only to the pinned consolidation job or a
 * deliberately selected capture request.
 */
export interface NativeKnowledgeToolContext {
  readonly registry: NativeKnowledgeRegistry;
  readonly generatedRoot: string;
  readonly readSource?: (
    args: Record<string, unknown>,
  ) => Promise<SourceSnapshot | { readonly kind: "unavailable"; readonly reason: string }>;
  readonly stageGeneration?: (
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly isolationEligible?: () => boolean;
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
  | {
      readonly kind: "ok";
      readonly events: readonly CalendarAgendaEntry[];
      /** When the provider was actually read. */
      readonly retrievedAt?: string;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The outcome of a provider write the agent asked for.
 *
 * `deduplicated` is surfaced rather than hidden so a retried call can say "that
 * was already booked" instead of implying a second booking happened.
 */
export type ProviderWriteOutcome =
  | {
      readonly kind: "ok";
      readonly reference: string;
      readonly deduplicated: boolean;
    }
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
  /** Present only where the credential may write to the calendar. */
  createEvent?: (request: {
    readonly calendarId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly description?: string;
    readonly location?: string;
    readonly idempotencyKey: string;
  }) => Promise<ProviderWriteOutcome>;
}

/** One message, reduced to what "does this need a reply" is decided from. */
export interface MailSummary {
  /** Addresses one message, so it can be opened in full on request. */
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly receivedAt: string;
  readonly unread: boolean;
}

export type MailSearchResult =
  | {
      readonly kind: "ok";
      readonly messages: readonly MailSummary[];
      /** When the mailbox was actually read. */
      readonly retrievedAt?: string;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * Ming reads several mailboxes, so the client names which ones exist rather
 * than assuming a default. An agent that cannot see the list reads whichever
 * mailbox it assumes and reports the answer as though it covered them all.
 */
/** One message opened deliberately, body included. */
export interface MailMessageBody {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly body: string;
  readonly convertedFromHtml: boolean;
  readonly truncated: boolean;
}

export type MailReadResult =
  | { readonly kind: "ok"; readonly message: MailMessageBody }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface MailboxClient {
  readonly mailboxes: readonly string[];
  search(request: {
    readonly mailbox: string;
    readonly query?: string;
    readonly limit?: number;
  }): Promise<MailSearchResult>;
  /**
   * Writes a draft. There is deliberately no send: Ming reviews the message in
   * his own Gmail and presses send there, which is the only approval surface
   * the agent cannot reach.
   */
  draft?: (request: {
    readonly mailbox: string;
    readonly to: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly cc?: readonly string[];
    readonly idempotencyKey: string;
  }) => Promise<ProviderWriteOutcome>;
  /**
   * Opens one message in full.
   *
   * Separate from search on purpose: a sweep of the inbox must never put other
   * people's mail into a transcript, but a message Ming asked about can be
   * read.
   */
  read?: (request: {
    readonly mailbox: string;
    readonly messageId: string;
  }) => Promise<MailReadResult>;
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
  /** Present only where at least one authorized mailbox is configured. */
  readonly mail?: MailboxClient;
  /** The calendar read when the caller names none. */
  readonly defaultCalendarId?: string;
  /** Optional bounded native-knowledge MCP boundary. */
  readonly knowledge?: NativeKnowledgeToolContext;
}): RealMingTools {
  const scheduledReports = options.scheduledReports;
  const calendar = options.calendar;
  const mail =
    options.mail === undefined || options.mail.mailboxes.length === 0
      ? undefined
      : options.mail;
  const knowledge = options.knowledge;
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
    ...(knowledge === undefined
      ? []
      : [
          {
            name: "real_ming_capture_knowledge_candidate",
            description:
              "Admit one explicitly saved decision, correction, or deliberately selected project/research artifact. No ordinary conversation sweep and no native Hermes memory write.",
            inputSchema: {
              type: "object",
              properties: {
                candidate: { type: "object" },
                explicit: { type: "boolean" },
                marked: { type: "boolean" },
              },
              required: ["candidate"],
            },
          } satisfies RealMingToolDefinition,
          {
            name: "real_ming_knowledge_list_candidates",
            description:
              "List opaque admitted native-knowledge candidate metadata for the bounded consolidation job; prose is never returned from the registry.",
            inputSchema: {
              type: "object",
              properties: { status: { type: "string" } },
            },
          } satisfies RealMingToolDefinition,
          {
            name: "real_ming_read_knowledge_source",
            description:
              "Read one declared, bounded knowledge source through its provider route and return source identity, version, hash and content for evidence checking.",
            inputSchema: {
              type: "object",
              properties: {
                sourceIdentity: { type: "string" },
                sourceReference: { type: "string" },
                sourceVersion: { type: "string" },
              },
              required: ["sourceIdentity", "sourceReference"],
            },
          } satisfies RealMingToolDefinition,
          {
            name: "real_ming_stage_knowledge_generation",
            description:
              "Stage one complete immutable generated wiki snapshot through the deterministic publication boundary; activation remains a separate registry operation.",
            inputSchema: { type: "object" },
          } satisfies RealMingToolDefinition,
          {
            name: "real_ming_wiki_retrieve",
            description:
              "Retrieve cited, fresh pages only from the verified active generated knowledge snapshot. Staging, quarantine, tombstoned and malformed state fails closed.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                now: { type: "string" },
                role: { type: "string" },
                maxResults: { type: "number" },
              },
              required: ["query", "now"],
            },
          } satisfies RealMingToolDefinition,
        ]) ,
    ...(scheduledReports === undefined
      ? []
      : [
          {
            name: "real_ming_run_scheduled_report",
            description:
              "Compose evidence for one Real-Ming morning brief or executive roll-up for native Hermes cron. Present the text as a concise briefing in your own voice, preserving source warnings, task names, approval/review distinctions and omitted counts. Never turn backlog into priorities or invent commitments or outcomes. If delivery is skipped, return [SILENT]. Do not call Telegram tools; the native gateway delivers your final answer.",
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
    ...(mail === undefined
      ? []
      : [
          {
            name: "real_ming_search_mail",
            description:
              `Search one of Ming's mailboxes and read message headers. Use for what needs a reply, whether an application was answered, or which notices matter. Available mailboxes: ${mail.mailboxes.join(", ")}. Always say which mailbox you read. Returns headers and a snippet, never message bodies; if the mailbox cannot be reached this fails rather than reporting an empty inbox.`,
            inputSchema: {
              type: "object",
              properties: {
                mailbox: {
                  type: "string",
                  description: `The mailbox to read. One of: ${mail.mailboxes.join(", ")}.`,
                  enum: [...mail.mailboxes],
                },
                query: {
                  type: "string",
                  description:
                    "Optional Gmail search, e.g. `is:unread newer_than:7d`.",
                },
                limit: {
                  type: "number",
                  description:
                    "Maximum messages to return. Defaults to 10, ceiling 50. When the result carries possiblyMore, the page was filled — report the count as a page, not a total.",
                },
              },
              required: ["mailbox"],
            },
          } satisfies RealMingToolDefinition,
        ]),
    ...(mail?.draft === undefined
      ? []
      : [
          {
            name: "real_ming_draft_email",
            description:
              `Write a draft into one of Ming's mailboxes for him to review and send himself. Available mailboxes: ${mail.mailboxes.join(", ")}. This NEVER sends: say plainly that the draft is waiting in his Gmail and that he sends it. Reuse the same idempotencyKey on a retry so a second draft is not left behind.`,
            inputSchema: {
              type: "object",
              properties: {
                mailbox: {
                  type: "string",
                  description: `The mailbox to draft from. One of: ${mail.mailboxes.join(", ")}.`,
                  enum: [...mail.mailboxes],
                },
                to: {
                  type: "array",
                  items: { type: "string" },
                  description: "Recipient addresses.",
                },
                cc: { type: "array", items: { type: "string" } },
                subject: { type: "string" },
                body: { type: "string", description: "Plain-text message body." },
                idempotencyKey: {
                  type: "string",
                  description: "Stable key for this draft; reuse it on retry.",
                },
              },
              required: ["mailbox", "to", "subject", "body", "idempotencyKey"],
            },
          } satisfies RealMingToolDefinition,
        ]),
    ...(mail?.read === undefined
      ? []
      : [
          {
            name: "real_ming_read_email",
            description:
              "Open ONE of Ming's emails and read its body. Use after real_ming_search_mail when the snippet is not enough — to summarise a long message, find what someone is actually asking, or gather what a reply needs. Takes the id from a search result. Read one message at a time; do not sweep an inbox with this.",
            inputSchema: {
              type: "object",
              properties: {
                mailbox: {
                  type: "string",
                  description: `The mailbox holding the message. One of: ${mail.mailboxes.join(", ")}.`,
                  enum: [...mail.mailboxes],
                },
                messageId: {
                  type: "string",
                  description: "The id field from a real_ming_search_mail result.",
                },
              },
              required: ["mailbox", "messageId"],
            },
          } satisfies RealMingToolDefinition,
        ]),
    ...(calendar?.createEvent === undefined
      ? []
      : [
          {
            name: "real_ming_create_calendar_event",
            description:
              "Create an event on Ming's calendar. Times are ISO-8601 with an offset. Reuse the same idempotencyKey on a retry so the day is not double-booked; a replay reports deduplicated rather than a second booking.",
            inputSchema: {
              type: "object",
              properties: {
                calendarId: {
                  type: "string",
                  description: "Defaults to Ming's configured calendar.",
                },
                title: { type: "string" },
                start: { type: "string", description: "ISO-8601 start." },
                end: { type: "string", description: "ISO-8601 end." },
                description: { type: "string" },
                location: { type: "string" },
                idempotencyKey: {
                  type: "string",
                  description: "Stable key for this event; reuse it on retry.",
                },
              },
              required: ["title", "start", "end", "idempotencyKey"],
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
      value: {
        calendarId,
        events: result.events,
        ...(result.retrievedAt === undefined
          ? {}
          : { retrievedAt: result.retrievedAt }),
      },
    };
  };

  const readMail = async (
    args: Record<string, unknown>,
  ): Promise<RealMingToolResult> => {
    if (mail === undefined) {
      return {
        kind: "failed",
        reason: "No mailbox is configured for this Real-Ming process.",
      };
    }
    const mailbox = requiredString(args, "mailbox");
    if (mailbox === undefined) {
      return {
        kind: "failed",
        reason: `mailbox is required. Available: ${mail.mailboxes.join(", ")}.`,
      };
    }
    if (!mail.mailboxes.includes(mailbox)) {
      // Falling back to a default answers a question Ming did not ask, in a
      // form that reads as though he did.
      return {
        kind: "failed",
        reason: `No mailbox ${mailbox} is configured. Available: ${mail.mailboxes.join(", ")}.`,
      };
    }
    const query = requiredString(args, "query");
    const rawLimit = args["limit"];
    const limit =
      typeof rawLimit === "number" && Number.isSafeInteger(rawLimit) && rawLimit > 0
        ? rawLimit
        : undefined;
    const result = await mail.search({
      mailbox,
      ...(query === undefined ? {} : { query }),
      ...(limit === undefined ? {} : { limit }),
    });
    if (result.kind === "unavailable") {
      return {
        kind: "failed",
        reason: `The mailbox ${mailbox} could not be read: ${result.reason}`,
      };
    }
    return {
      kind: "ok",
      value: {
        mailbox,
        messages: result.messages,
        // A full page is not a total. Without this the agent reports "10
        // unread" when there are forty, which reads as a complete count.
        possiblyMore: result.messages.length >= (limit ?? 10),
        ...(result.retrievedAt === undefined
          ? {}
          : { retrievedAt: result.retrievedAt }),
      },
    };
  };

  const readOneEmail = async (
    args: Record<string, unknown>,
  ): Promise<RealMingToolResult> => {
    const read = mail?.read;
    if (mail === undefined || read === undefined) {
      return { kind: "failed", reason: "Reading mail bodies is not enabled here." };
    }
    const mailbox = requiredString(args, "mailbox");
    if (mailbox === undefined || !mail.mailboxes.includes(mailbox)) {
      return {
        kind: "failed",
        reason: `mailbox must be one of: ${mail.mailboxes.join(", ")}.`,
      };
    }
    const messageId = requiredString(args, "messageId");
    if (messageId === undefined) {
      return {
        kind: "failed",
        reason: "messageId is required; take it from a real_ming_search_mail result.",
      };
    }
    const result = await read({ mailbox, messageId });
    if (result.kind === "unavailable") {
      return {
        kind: "failed",
        reason: `That message could not be read from ${mailbox}: ${result.reason}`,
      };
    }
    return { kind: "ok", value: { mailbox, ...result.message } };
  };

  const writeDraft = async (
    args: Record<string, unknown>,
  ): Promise<RealMingToolResult> => {
    const draft = mail?.draft;
    if (mail === undefined || draft === undefined) {
      return { kind: "failed", reason: "Drafting mail is not enabled here." };
    }
    const mailbox = requiredString(args, "mailbox");
    if (mailbox === undefined || !mail.mailboxes.includes(mailbox)) {
      return {
        kind: "failed",
        reason: `mailbox must be one of: ${mail.mailboxes.join(", ")}.`,
      };
    }
    const subject = requiredString(args, "subject");
    const body = requiredString(args, "body");
    const idempotencyKey = requiredString(args, "idempotencyKey");
    const rawTo = args["to"];
    const to = (Array.isArray(rawTo) ? rawTo : []).filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
    );
    if (
      subject === undefined ||
      body === undefined ||
      idempotencyKey === undefined ||
      to.length === 0
    ) {
      return {
        kind: "failed",
        reason: "to, subject, body and idempotencyKey are all required.",
      };
    }
    const rawCc = args["cc"];
    const cc = (Array.isArray(rawCc) ? rawCc : []).filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
    );
    const result = await draft({
      mailbox,
      to,
      subject,
      body,
      ...(cc.length === 0 ? {} : { cc }),
      idempotencyKey,
    });
    if (result.kind === "unavailable") {
      return {
        kind: "failed",
        reason: `The draft could not be written to ${mailbox}: ${result.reason}`,
      };
    }
    return {
      kind: "ok",
      value: {
        mailbox,
        draftReference: result.reference,
        deduplicated: result.deduplicated,
        sent: false,
        note: `The draft is waiting in ${mailbox}. Ming sends it himself.`,
      },
    };
  };

  const writeCalendarEvent = async (
    args: Record<string, unknown>,
  ): Promise<RealMingToolResult> => {
    const createEvent = calendar?.createEvent;
    if (createEvent === undefined) {
      return {
        kind: "failed",
        reason: "Creating calendar events is not enabled here.",
      };
    }
    const calendarId =
      requiredString(args, "calendarId") ?? options.defaultCalendarId;
    const title = requiredString(args, "title");
    const start = requiredString(args, "start");
    const end = requiredString(args, "end");
    const idempotencyKey = requiredString(args, "idempotencyKey");
    if (
      calendarId === undefined ||
      title === undefined ||
      start === undefined ||
      end === undefined ||
      idempotencyKey === undefined
    ) {
      return {
        kind: "failed",
        reason:
          "title, start, end and idempotencyKey are required, and no default calendar is configured.",
      };
    }
    const description = requiredString(args, "description");
    const location = requiredString(args, "location");
    const result = await createEvent({
      calendarId,
      title,
      start,
      end,
      ...(description === undefined ? {} : { description }),
      ...(location === undefined ? {} : { location }),
      idempotencyKey,
    });
    if (result.kind === "unavailable") {
      return {
        kind: "failed",
        reason: `The event could not be created on ${calendarId}: ${result.reason}`,
      };
    }
    return {
      kind: "ok",
      value: {
        calendarId,
        eventReference: result.reference,
        deduplicated: result.deduplicated,
      },
    };
  };

  const candidateFromArgs = (args: Record<string, unknown>): NativeKnowledgeCandidate | undefined => {
    const value = args["candidate"];
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const candidate = value as Partial<NativeKnowledgeCandidate>;
    const strings = [
      candidate.candidateId,
      candidate.kind,
      candidate.claimClass,
      candidate.claim,
      candidate.sourceIdentity,
      candidate.sourceReference,
      candidate.sourceVersion,
      candidate.excerpt,
      candidate.contentHash,
      candidate.capturedAt,
      candidate.asOf,
      candidate.trustDomain,
      candidate.sensitivity,
      candidate.retentionClass,
    ];
    if (!strings.every((entry) => typeof entry === "string" && entry.trim().length > 0)) return undefined;
    if (!Array.isArray(candidate.dependencies) || !candidate.dependencies.every((entry) => typeof entry === "string")) return undefined;
    return candidate as NativeKnowledgeCandidate;
  };

  const captureKnowledge = async (args: Record<string, unknown>): Promise<RealMingToolResult> => {
    if (knowledge === undefined) return { kind: "failed", reason: "Native knowledge capture is not enabled." };
    const candidate = candidateFromArgs(args);
    if (candidate === undefined) return { kind: "failed", reason: "candidate contains invalid or missing fields." };
    const result: CaptureResult = await captureCandidate({
      candidate,
      explicit: args["explicit"] === true,
      marked: args["marked"] === true,
      registry: knowledge.registry,
    });
    return { kind: "ok", value: result };
  };

  const listKnowledge = (args: Record<string, unknown>): RealMingToolResult => {
    if (knowledge === undefined) return { kind: "failed", reason: "Native knowledge registry is not enabled." };
    const status = requiredString(args, "status") as Parameters<NativeKnowledgeRegistry["listCandidates"]>[0];
    return { kind: "ok", value: { candidates: knowledge.registry.listCandidates(status) } };
  };

  const readKnowledgeSource = async (args: Record<string, unknown>): Promise<RealMingToolResult> => {
    if (knowledge?.readSource === undefined) return { kind: "failed", reason: "No bounded knowledge source route is configured." };
    const sourceIdentity = requiredString(args, "sourceIdentity");
    const sourceReference = requiredString(args, "sourceReference");
    if (sourceIdentity === undefined || sourceReference === undefined) return { kind: "failed", reason: "sourceIdentity and sourceReference are required." };
    const result = await knowledge.readSource(args);
    return "kind" in result && result.kind === "unavailable"
      ? { kind: "failed", reason: result.reason }
      : { kind: "ok", value: result };
  };

  const stageKnowledge = async (args: Record<string, unknown>): Promise<RealMingToolResult> => {
    if (knowledge?.stageGeneration === undefined) return { kind: "failed", reason: "Native knowledge staging is not enabled." };
    return { kind: "ok", value: await knowledge.stageGeneration(args) };
  };

  const retrieveKnowledge = (args: Record<string, unknown>): RealMingToolResult => {
    if (knowledge === undefined) return { kind: "failed", reason: "Native knowledge retrieval is not enabled." };
    const query = requiredString(args, "query");
    const now = requiredString(args, "now");
    if (query === undefined || now === undefined) return { kind: "failed", reason: "query and now are required." };
    const rawMax = args["maxResults"];
    const role = requiredString(args, "role");
    const request: WikiRetrieveRequest = {
      query,
      now,
      ...(role === undefined ? {} : { role }),
      ...(typeof rawMax === "number" ? { maxResults: rawMax } : {}),
    };
    const result = wikiRetrieve({ ...request, registry: knowledge.registry, generatedRoot: knowledge.generatedRoot });
    return { kind: "ok", value: result };
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
        case "real_ming_knowledge_list_candidates":
          return listKnowledge(args);
        case "real_ming_capture_knowledge_candidate":
        case "real_ming_read_knowledge_source":
        case "real_ming_stage_knowledge_generation":
          return {
            kind: "failed",
            reason: "This knowledge tool requires the asynchronous MCP call path.",
          };
        case "real_ming_wiki_retrieve":
          return retrieveKnowledge(args);
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
        case "real_ming_read_email":
        case "real_ming_draft_email":
        case "real_ming_create_calendar_event":
          return {
            kind: "failed",
            reason: "This tool requires the asynchronous MCP call path.",
          };
        case "real_ming_search_mail":
          return mail === undefined
            ? {
                kind: "failed",
                reason: "No mailbox is configured for this Real-Ming process.",
              }
            : {
                kind: "failed",
                reason: "Reading mail requires the asynchronous MCP call path.",
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

  if (
    scheduledReports === undefined &&
    calendar === undefined &&
    mail === undefined &&
    knowledge === undefined
  ) {
    return tools;
  }

  return {
    ...tools,
    callAsync: async (name: string, args: Record<string, unknown>) => {
      if (name === "real_ming_list_calendar_events") return readCalendar(args);
      if (name === "real_ming_search_mail") return readMail(args);
      if (name === "real_ming_read_email") return readOneEmail(args);
      if (name === "real_ming_draft_email") return writeDraft(args);
      if (name === "real_ming_create_calendar_event") {
        return writeCalendarEvent(args);
      }
      if (name === "real_ming_capture_knowledge_candidate") return captureKnowledge(args);
      if (name === "real_ming_read_knowledge_source") return readKnowledgeSource(args);
      if (name === "real_ming_stage_knowledge_generation") return stageKnowledge(args);
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
