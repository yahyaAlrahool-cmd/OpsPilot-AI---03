import type {
  Language,
  PriorityLevel,
  ProjectStatus,
  ServiceType,
} from "../src/types.js";
import type { ChatIntent } from "../src/services/contextRetriever.js";
import type {
  CreateProjectInput,
  LegacyProjectInput,
  UpdateProjectPatch,
} from "./firestoreRepo.js";

export type { ChatIntent };

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ALLOWED_LANGUAGES = ["en", "ar"] as const;
const ALLOWED_CHAT_ROLES = ["user", "assistant"] as const;
const ALLOWED_CHAT_INTENTS = [
  "greeting",
  "workload",
  "risk_overdue",
  "performance",
  "projects_lookup",
  "complex_analysis",
] as const;

const ALLOWED_STATUSES: readonly ProjectStatus[] = [
  "new",
  "in_progress",
  "under_review",
  "completed",
  "on_hold",
];
const ALLOWED_PRIORITIES: readonly PriorityLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
];
const ALLOWED_SERVICE_TYPES: readonly ServiceType[] = [
  "research_reports",
  "presentations",
  "graphic_design",
  "website_development",
  "business_services",
];

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRAPH_NODE_ID_RE = /^[a-zA-Z0-9_:\-.\s]{1,160}$/;

function fail(error: string): ValidationResult<never> {
  return { ok: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertAllowedKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): string | null {
  const allowedSet = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      return `Unexpected field "${key}" at ${path}.`;
    }
  }
  return null;
}

function readString(
  value: unknown,
  path: string,
  options: { minLen?: number; maxLen?: number; trim?: boolean; pattern?: RegExp } = {}
): ValidationResult<string> {
  if (typeof value !== "string") {
    return fail(`${path} must be a string.`);
  }
  const str = options.trim ? value.trim() : value;
  const minLen = options.minLen ?? 0;
  const maxLen = options.maxLen ?? 2_000;
  if (str.length < minLen) {
    return fail(`${path} must be at least ${minLen} character(s).`);
  }
  if (str.length > maxLen) {
    return fail(`${path} exceeds maximum length of ${maxLen} characters.`);
  }
  if (options.pattern && !options.pattern.test(str)) {
    return fail(`${path} has an invalid format.`);
  }
  return { ok: true, data: str };
}

function readOptionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  options: { minLen?: number; maxLen?: number; trim?: boolean; pattern?: RegExp } = {}
): ValidationResult<string | undefined> {
  if (!(key in obj) || obj[key] === undefined) return { ok: true, data: undefined };
  return readString(obj[key], `${path}.${key}`, options);
}

function readNumber(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): ValidationResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`${path} must be a finite number.`);
  }
  if (options.integer && !Number.isInteger(value)) {
    return fail(`${path} must be an integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    return fail(`${path} must be >= ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    return fail(`${path} must be <= ${options.max}.`);
  }
  return { ok: true, data: value };
}

function readBoolean(value: unknown, path: string): ValidationResult<boolean> {
  if (typeof value !== "boolean") {
    return fail(`${path} must be a boolean.`);
  }
  return { ok: true, data: value };
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): ValidationResult<T> {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(`${path} must be one of: ${allowed.join(", ")}.`);
  }
  return { ok: true, data: value as T };
}

function readArray<T>(
  value: unknown,
  path: string,
  maxItems: number,
  itemValidator: (item: unknown, itemPath: string) => ValidationResult<T>,
  minItems = 0
): ValidationResult<T[]> {
  if (!Array.isArray(value)) {
    return fail(`${path} must be an array.`);
  }
  if (value.length < minItems) {
    return fail(`${path} must contain at least ${minItems} item(s).`);
  }
  if (value.length > maxItems) {
    return fail(`${path} exceeds maximum count of ${maxItems} items.`);
  }
  const out: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const res = itemValidator(value[i], `${path}[${i}]`);
    if (!res.ok) return res;
    out.push(res.data);
  }
  return { ok: true, data: out };
}

function validateLanguage(value: unknown): ValidationResult<Language> {
  if (value === undefined) return { ok: true, data: "en" };
  return readEnum(value, ALLOWED_LANGUAGES, "language");
}

function validateISODate(value: unknown, path: string): ValidationResult<string> {
  const s = readString(value, path, { minLen: 10, maxLen: 10, pattern: DATE_ISO_RE });
  if (!s.ok) return s;
  const parsed = Date.parse(`${s.data}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return fail(`${path} must be a valid calendar date (YYYY-MM-DD).`);
  }
  return s;
}

export function validateProjectIdParam(rawId: unknown): ValidationResult<string> {
  return readString(rawId, "id", { minLen: 1, maxLen: 64, trim: true, pattern: ID_RE });
}

export function validateCreateProjectBody(
  body: unknown
): ValidationResult<CreateProjectInput> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(
    body,
    [
      "id",
      "clientName",
      "clientNameAr",
      "serviceType",
      "title",
      "titleAr",
      "assignedEmployeeId",
      "startDate",
      "deadline",
      "completedDate",
      "status",
      "progress",
      "priority",
      "estimatedWorkload",
      "budget",
      "notes",
      "notesAr",
    ],
    "body"
  );
  if (keyErr) return fail(keyErr);

  const idOpt = readOptionalString(body, "id", "body", {
    minLen: 1,
    maxLen: 64,
    trim: true,
    pattern: ID_RE,
  });
  if (!idOpt.ok) return idOpt;

  const clientName = readString(body.clientName, "body.clientName", {
    minLen: 1,
    maxLen: 240,
    trim: true,
  });
  if (!clientName.ok) return clientName;

  const clientNameArOpt = readOptionalString(body, "clientNameAr", "body", {
    minLen: 0,
    maxLen: 240,
    trim: true,
  });
  if (!clientNameArOpt.ok) return clientNameArOpt;

  const serviceType = readEnum(body.serviceType, ALLOWED_SERVICE_TYPES, "body.serviceType");
  if (!serviceType.ok) return serviceType;

  const title = readString(body.title, "body.title", {
    minLen: 1,
    maxLen: 240,
    trim: true,
  });
  if (!title.ok) return title;

  const titleArOpt = readOptionalString(body, "titleAr", "body", {
    minLen: 0,
    maxLen: 240,
    trim: true,
  });
  if (!titleArOpt.ok) return titleArOpt;

  const assignedEmployeeId = readString(
    body.assignedEmployeeId,
    "body.assignedEmployeeId",
    { minLen: 1, maxLen: 64, trim: true, pattern: ID_RE }
  );
  if (!assignedEmployeeId.ok) return assignedEmployeeId;

  const startDate = validateISODate(body.startDate, "body.startDate");
  if (!startDate.ok) return startDate;

  const deadline = validateISODate(body.deadline, "body.deadline");
  if (!deadline.ok) return deadline;

  let completedDate: string | undefined;
  if ("completedDate" in body && body.completedDate !== undefined) {
    const cd = validateISODate(body.completedDate, "body.completedDate");
    if (!cd.ok) return cd;
    completedDate = cd.data;
  }

  const status = readEnum(body.status, ALLOWED_STATUSES, "body.status");
  if (!status.ok) return status;

  const progress = readNumber(body.progress, "body.progress", { min: 0, max: 100 });
  if (!progress.ok) return progress;

  const priority = readEnum(body.priority, ALLOWED_PRIORITIES, "body.priority");
  if (!priority.ok) return priority;

  const estimatedWorkload = readNumber(
    body.estimatedWorkload,
    "body.estimatedWorkload",
    { min: 1, max: 1_000 }
  );
  if (!estimatedWorkload.ok) return estimatedWorkload;

  let budget: number | undefined;
  if ("budget" in body && body.budget !== undefined) {
    const b = readNumber(body.budget, "body.budget", { min: 0, max: 10_000_000 });
    if (!b.ok) return b;
    budget = b.data;
  }

  const notes = readOptionalString(body, "notes", "body", { minLen: 0, maxLen: 2_000 });
  if (!notes.ok) return notes;

  const notesAr = readOptionalString(body, "notesAr", "body", { minLen: 0, maxLen: 2_000 });
  if (!notesAr.ok) return notesAr;

  const cleanNotes = notes.data ?? "";
  const cleanNotesAr = notesAr.data ?? cleanNotes;

  return {
    ok: true,
    data: {
      id: idOpt.data,
      clientName: clientName.data,
      clientNameAr:
        clientNameArOpt.data && clientNameArOpt.data.length > 0
          ? clientNameArOpt.data
          : clientName.data,
      serviceType: serviceType.data,
      title: title.data,
      titleAr:
        titleArOpt.data && titleArOpt.data.length > 0
          ? titleArOpt.data
          : title.data,
      assignedEmployeeId: assignedEmployeeId.data,
      startDate: startDate.data,
      deadline: deadline.data,
      completedDate,
      status: status.data,
      progress: progress.data,
      priority: priority.data,
      estimatedWorkload: estimatedWorkload.data,
      budget,
      notes: cleanNotes,
      notesAr: cleanNotesAr,
    },
  };
}

export function validateUpdateProjectBody(
  body: unknown
): ValidationResult<{ expectedVersion: number; patch: UpdateProjectPatch }> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(body, ["expectedVersion", "patch"], "body");
  if (keyErr) return fail(keyErr);

  const expectedVersion = readNumber(body.expectedVersion, "body.expectedVersion", {
    min: 1,
    max: 1_000_000,
    integer: true,
  });
  if (!expectedVersion.ok) return expectedVersion;

  if (!isPlainObject(body.patch)) {
    return fail("body.patch must be a plain object.");
  }

  const p = body.patch;
  const patchErr = assertAllowedKeys(
    p,
    [
      "clientName",
      "clientNameAr",
      "serviceType",
      "title",
      "titleAr",
      "assignedEmployeeId",
      "startDate",
      "deadline",
      "completedDate",
      "status",
      "progress",
      "priority",
      "estimatedWorkload",
      "budget",
      "notes",
      "notesAr",
    ],
    "body.patch"
  );
  if (patchErr) return fail(patchErr);

  const patchKeys = Object.keys(p);
  if (patchKeys.length === 0) {
    return fail("body.patch must specify at least one updatable field.");
  }

  const patch: UpdateProjectPatch = {};

  if ("clientName" in p && p.clientName !== undefined) {
    const r = readString(p.clientName, "body.patch.clientName", {
      minLen: 1,
      maxLen: 240,
      trim: true,
    });
    if (!r.ok) return r;
    patch.clientName = r.data;
  }

  if ("clientNameAr" in p && p.clientNameAr !== undefined) {
    const r = readString(p.clientNameAr, "body.patch.clientNameAr", {
      minLen: 1,
      maxLen: 240,
      trim: true,
    });
    if (!r.ok) return r;
    patch.clientNameAr = r.data;
  }

  if ("serviceType" in p && p.serviceType !== undefined) {
    const r = readEnum(p.serviceType, ALLOWED_SERVICE_TYPES, "body.patch.serviceType");
    if (!r.ok) return r;
    patch.serviceType = r.data;
  }

  if ("title" in p && p.title !== undefined) {
    const r = readString(p.title, "body.patch.title", {
      minLen: 1,
      maxLen: 240,
      trim: true,
    });
    if (!r.ok) return r;
    patch.title = r.data;
  }

  if ("titleAr" in p && p.titleAr !== undefined) {
    const r = readString(p.titleAr, "body.patch.titleAr", {
      minLen: 1,
      maxLen: 240,
      trim: true,
    });
    if (!r.ok) return r;
    patch.titleAr = r.data;
  }

  if ("assignedEmployeeId" in p && p.assignedEmployeeId !== undefined) {
    const r = readString(p.assignedEmployeeId, "body.patch.assignedEmployeeId", {
      minLen: 1,
      maxLen: 64,
      trim: true,
      pattern: ID_RE,
    });
    if (!r.ok) return r;
    patch.assignedEmployeeId = r.data;
  }

  if ("startDate" in p && p.startDate !== undefined) {
    const r = validateISODate(p.startDate, "body.patch.startDate");
    if (!r.ok) return r;
    patch.startDate = r.data;
  }

  if ("deadline" in p && p.deadline !== undefined) {
    const r = validateISODate(p.deadline, "body.patch.deadline");
    if (!r.ok) return r;
    patch.deadline = r.data;
  }

  if ("completedDate" in p) {
    if (p.completedDate === null) {
      patch.completedDate = null;
    } else if (p.completedDate !== undefined) {
      const r = validateISODate(p.completedDate, "body.patch.completedDate");
      if (!r.ok) return r;
      patch.completedDate = r.data;
    }
  }

  if ("status" in p && p.status !== undefined) {
    const r = readEnum(p.status, ALLOWED_STATUSES, "body.patch.status");
    if (!r.ok) return r;
    patch.status = r.data;
  }

  if ("progress" in p && p.progress !== undefined) {
    const r = readNumber(p.progress, "body.patch.progress", { min: 0, max: 100 });
    if (!r.ok) return r;
    patch.progress = r.data;
  }

  if ("priority" in p && p.priority !== undefined) {
    const r = readEnum(p.priority, ALLOWED_PRIORITIES, "body.patch.priority");
    if (!r.ok) return r;
    patch.priority = r.data;
  }

  if ("estimatedWorkload" in p && p.estimatedWorkload !== undefined) {
    const r = readNumber(p.estimatedWorkload, "body.patch.estimatedWorkload", {
      min: 1,
      max: 1_000,
    });
    if (!r.ok) return r;
    patch.estimatedWorkload = r.data;
  }

  if ("budget" in p && p.budget !== undefined) {
    const r = readNumber(p.budget, "body.patch.budget", {
      min: 0,
      max: 10_000_000,
    });
    if (!r.ok) return r;
    patch.budget = r.data;
  }

  if ("notes" in p && p.notes !== undefined) {
    const r = readString(p.notes, "body.patch.notes", { minLen: 0, maxLen: 2_000 });
    if (!r.ok) return r;
    patch.notes = r.data;
  }

  if ("notesAr" in p && p.notesAr !== undefined) {
    const r = readString(p.notesAr, "body.patch.notesAr", { minLen: 0, maxLen: 2_000 });
    if (!r.ok) return r;
    patch.notesAr = r.data;
  }

  return {
    ok: true,
    data: {
      expectedVersion: expectedVersion.data,
      patch,
    },
  };
}

export function validateDeleteProjectBody(
  body: unknown
): ValidationResult<{ expectedVersion?: number }> {
  if (body === undefined || body === null) return { ok: true, data: {} };
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(body, ["expectedVersion"], "body");
  if (keyErr) return fail(keyErr);

  if ("expectedVersion" in body && body.expectedVersion !== undefined) {
    const v = readNumber(body.expectedVersion, "body.expectedVersion", {
      min: 1,
      max: 1_000_000,
      integer: true,
    });
    if (!v.ok) return v;
    return { ok: true, data: { expectedVersion: v.data } };
  }
  return { ok: true, data: {} };
}

export function validateMigrateLegacyBody(
  body: unknown
): ValidationResult<{ projects: LegacyProjectInput[] }> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(body, ["projects"], "body");
  if (keyErr) return fail(keyErr);

  const projectsRes = readArray(
    body.projects,
    "body.projects",
    200,
    (item, p) => {
      if (!isPlainObject(item)) return fail(`${p} must be an object.`);
      const pErr = assertAllowedKeys(
        item,
        [
          "id",
          "clientName",
          "clientNameAr",
          "serviceType",
          "title",
          "titleAr",
          "assignedEmployeeId",
          "startDate",
          "deadline",
          "completedDate",
          "lastUpdated",
          "status",
          "progress",
          "priority",
          "estimatedWorkload",
          "budget",
          "notes",
          "notesAr",
        ],
        p
      );
      if (pErr) return fail(pErr);

      const id = readString(item.id, `${p}.id`, {
        minLen: 1,
        maxLen: 64,
        trim: true,
        pattern: ID_RE,
      });
      if (!id.ok) return id;

      const clientName = readString(item.clientName, `${p}.clientName`, {
        minLen: 1,
        maxLen: 240,
        trim: true,
      });
      if (!clientName.ok) return clientName;

      const clientNameAr = readOptionalString(item, "clientNameAr", p, {
        minLen: 0,
        maxLen: 240,
        trim: true,
      });
      if (!clientNameAr.ok) return clientNameAr;

      const serviceType = readEnum(item.serviceType, ALLOWED_SERVICE_TYPES, `${p}.serviceType`);
      if (!serviceType.ok) return serviceType;

      const title = readString(item.title, `${p}.title`, {
        minLen: 1,
        maxLen: 240,
        trim: true,
      });
      if (!title.ok) return title;

      const titleAr = readOptionalString(item, "titleAr", p, {
        minLen: 0,
        maxLen: 240,
        trim: true,
      });
      if (!titleAr.ok) return titleAr;

      const assignedEmployeeId = readString(
        item.assignedEmployeeId,
        `${p}.assignedEmployeeId`,
        { minLen: 1, maxLen: 64, trim: true, pattern: ID_RE }
      );
      if (!assignedEmployeeId.ok) return assignedEmployeeId;

      const startDate = validateISODate(item.startDate, `${p}.startDate`);
      if (!startDate.ok) return startDate;

      const deadline = validateISODate(item.deadline, `${p}.deadline`);
      if (!deadline.ok) return deadline;

      let completedDate: string | undefined;
      if ("completedDate" in item && item.completedDate !== undefined) {
        const cd = validateISODate(item.completedDate, `${p}.completedDate`);
        if (!cd.ok) return cd;
        completedDate = cd.data;
      }

      const lastUpdated = validateISODate(item.lastUpdated, `${p}.lastUpdated`);
      if (!lastUpdated.ok) return lastUpdated;

      const status = readEnum(item.status, ALLOWED_STATUSES, `${p}.status`);
      if (!status.ok) return status;

      const progress = readNumber(item.progress, `${p}.progress`, { min: 0, max: 100 });
      if (!progress.ok) return progress;

      const priority = readEnum(item.priority, ALLOWED_PRIORITIES, `${p}.priority`);
      if (!priority.ok) return priority;

      const estimatedWorkload = readNumber(
        item.estimatedWorkload,
        `${p}.estimatedWorkload`,
        { min: 1, max: 1_000 }
      );
      if (!estimatedWorkload.ok) return estimatedWorkload;

      let budget: number | undefined;
      if ("budget" in item && item.budget !== undefined) {
        const b = readNumber(item.budget, `${p}.budget`, { min: 0, max: 10_000_000 });
        if (!b.ok) return b;
        budget = b.data;
      }

      const notes = readOptionalString(item, "notes", p, { minLen: 0, maxLen: 2_000 });
      if (!notes.ok) return notes;

      const notesAr = readOptionalString(item, "notesAr", p, { minLen: 0, maxLen: 2_000 });
      if (!notesAr.ok) return notesAr;

      const cleanNotes = notes.data ?? "";
      return {
        ok: true,
        data: {
          id: id.data,
          clientName: clientName.data,
          clientNameAr:
            clientNameAr.data && clientNameAr.data.length > 0
              ? clientNameAr.data
              : clientName.data,
          serviceType: serviceType.data,
          title: title.data,
          titleAr:
            titleAr.data && titleAr.data.length > 0
              ? titleAr.data
              : title.data,
          assignedEmployeeId: assignedEmployeeId.data,
          startDate: startDate.data,
          deadline: deadline.data,
          completedDate,
          lastUpdated: lastUpdated.data,
          status: status.data,
          progress: progress.data,
          priority: priority.data,
          estimatedWorkload: estimatedWorkload.data,
          budget,
          notes: cleanNotes,
          notesAr: notesAr.data ?? cleanNotes,
        },
      };
    },
    0
  );

  if (!projectsRes.ok) return projectsRes;
  return { ok: true, data: { projects: projectsRes.data } };
}

export function validateDailyBriefBody(
  body: unknown
): ValidationResult<{ language: Language }> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(body, ["language"], "body");
  if (keyErr) return fail(keyErr);

  const lang = validateLanguage(body.language);
  if (!lang.ok) return lang;

  return { ok: true, data: { language: lang.data } };
}

export function validateAnalystBody(
  body: unknown
): ValidationResult<{ language: Language }> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(body, ["language"], "body");
  if (keyErr) return fail(keyErr);

  const lang = validateLanguage(body.language);
  if (!lang.ok) return lang;

  return { ok: true, data: { language: lang.data } };
}

export function validatePerformanceInsightsBody(
  body: unknown
): ValidationResult<{ language: Language }> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(body, ["language"], "body");
  if (keyErr) return fail(keyErr);

  const lang = validateLanguage(body.language);
  if (!lang.ok) return lang;

  return { ok: true, data: { language: lang.data } };
}

export interface ValidatedChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ValidatedChatRequest {
  language: Language;
  messages: ValidatedChatMessage[];
  intent?: ChatIntent;
  focusNodeId?: string;
  stream: boolean;
  preferFast: boolean;
}

export function validateChatBody(body: unknown): ValidationResult<ValidatedChatRequest> {
  if (!isPlainObject(body)) return fail("Request body must be a JSON object.");
  const keyErr = assertAllowedKeys(
    body,
    ["language", "messages", "intent", "focusNodeId", "stream", "preferFast"],
    "body"
  );
  if (keyErr) return fail(keyErr);

  const lang = validateLanguage(body.language);
  if (!lang.ok) return lang;

  let intent: ChatIntent | undefined;
  if ("intent" in body && body.intent !== undefined) {
    const intentRes = readEnum(body.intent, ALLOWED_CHAT_INTENTS, "intent");
    if (!intentRes.ok) return intentRes;
    intent = intentRes.data;
  }

  let focusNodeId: string | undefined;
  if ("focusNodeId" in body && body.focusNodeId !== undefined && body.focusNodeId !== null) {
    const fnRes = readString(body.focusNodeId, "focusNodeId", {
      minLen: 1,
      maxLen: 160,
      trim: true,
      pattern: GRAPH_NODE_ID_RE,
    });
    if (!fnRes.ok) return fnRes;
    focusNodeId = fnRes.data;
  }

  let stream = true;
  if ("stream" in body && body.stream !== undefined) {
    const streamRes = readBoolean(body.stream, "stream");
    if (!streamRes.ok) return streamRes;
    stream = streamRes.data;
  }

  let preferFast = true;
  if ("preferFast" in body && body.preferFast !== undefined) {
    const pfRes = readBoolean(body.preferFast, "preferFast");
    if (!pfRes.ok) return pfRes;
    preferFast = pfRes.data;
  }

  const messagesRes = readArray(
    body.messages,
    "messages",
    30,
    (item, p) => {
      if (!isPlainObject(item)) return fail(`${p} must be an object.`);
      const mErr = assertAllowedKeys(item, ["role", "content"], p);
      if (mErr) return fail(mErr);
      const role = readEnum(item.role, ALLOWED_CHAT_ROLES, `${p}.role`);
      if (!role.ok) return role;
      const content = readString(item.content, `${p}.content`, {
        minLen: 1,
        maxLen: 4_000,
        trim: true,
      });
      if (!content.ok) return content;
      return { ok: true, data: { role: role.data, content: content.data } };
    },
    1
  );
  if (!messagesRes.ok) return messagesRes;

  let totalChars = 0;
  for (const m of messagesRes.data) {
    totalChars += m.content.length;
  }
  if (totalChars > 24_000) {
    return fail("Total messages character length exceeds maximum of 24000 characters.");
  }

  const lastMessage = messagesRes.data[messagesRes.data.length - 1];
  if (lastMessage.role !== "user") {
    return fail("The last message in messages must have role 'user'.");
  }

  return {
    ok: true,
    data: {
      language: lang.data,
      messages: messagesRes.data,
      intent,
      focusNodeId,
      stream,
      preferFast,
    },
  };
}
