import crypto from "crypto";
import { getFirebaseConfig, type VerifiedFirebaseUser } from "./firebaseAuth.js";
import { createInitialProjects, INITIAL_EMPLOYEES } from "../src/data/seedData.js";
import type {
  AuditAction,
  AuditLogEntry,
  Employee,
  PriorityLevel,
  Project,
  ProjectStatus,
  ServiceType,
  WorkspaceMetadata,
  WorkspaceSnapshotResponse,
} from "../src/types.js";

export class RepoError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RepoError";
    this.status = status;
    this.code = code;
  }
}

function assertFirebaseCaller(caller: VerifiedFirebaseUser): void {
  if (!caller || !caller.uid || caller.uid.startsWith("demo_") || !caller.idToken) {
    throw new RepoError(
      403,
      "FORBIDDEN",
      "Public demo callers cannot access Firebase Firestore."
    );
  }
}

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

interface FirestoreWrite {
  update?: {
    name: string;
    fields: Record<string, FirestoreValue>;
  };
  delete?: string;
  updateMask?: {
    fieldPaths: string[];
  };
  updateTransforms?: Array<{
    fieldPath: string;
    setToServerValue: "REQUEST_TIME";
  }>;
  currentDocument?: {
    exists?: boolean;
    updateTime?: string;
  };
}

function getDbEndpoints(): {
  projectId: string;
  databaseId: string;
  dbRoot: string;
  docsRoot: string;
} {
  const cfg = getFirebaseConfig();
  if (!cfg) {
    throw new RepoError(503, "DB_NOT_CONFIGURED", "Database configuration is missing.");
  }
  const dbRoot = `projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}`;
  const docsRoot = `${dbRoot}/documents`;
  return {
    projectId: cfg.projectId,
    databaseId: cfg.firestoreDatabaseId,
    dbRoot,
    docsRoot,
  };
}

function baseUrl(docsRoot: string): string {
  return `https://firestore.googleapis.com/v1/${docsRoot}`;
}

async function firestoreFetch<T>(
  url: string,
  idToken: string,
  init: RequestInit = {}
): Promise<{ status: number; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const errObj =
        parsed && typeof parsed === "object" && "error" in parsed
          ? (parsed as { error?: { status?: string; message?: string } }).error
          : undefined;
      const grpcStatus = errObj?.status ?? "";
      const errMsg = errObj?.message ?? `Database request failed (${res.status})`;

      if (res.status === 401) {
        throw new RepoError(401, "AUTH_REQUIRED", "Authentication expired or invalid.");
      }
      if (res.status === 403 || grpcStatus === "PERMISSION_DENIED") {
        throw new RepoError(403, "PERMISSION_DENIED", "Access denied for this workspace record.");
      }
      if (res.status === 404 || grpcStatus === "NOT_FOUND") {
        throw new RepoError(404, "NOT_FOUND", "Requested workspace record was not found.");
      }
      if (
        res.status === 409 ||
        grpcStatus === "ABORTED" ||
        grpcStatus === "FAILED_PRECONDITION" ||
        grpcStatus === "ALREADY_EXISTS"
      ) {
        throw new RepoError(
          409,
          "VERSION_CONFLICT",
          "This record was updated elsewhere. Reloading the latest workspace data."
        );
      }
      if (res.status === 429 || grpcStatus === "RESOURCE_EXHAUSTED") {
        throw new RepoError(429, "DB_QUOTA_EXCEEDED", "Database quota or rate limit reached.");
      }
      throw new RepoError(502, "DB_ERROR", errMsg);
    }

    return { status: res.status, data: parsed as T };
  } catch (err) {
    if (err instanceof RepoError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new RepoError(504, "DB_TIMEOUT", "Database request timed out.");
    }
    throw new RepoError(503, "DB_UNAVAILABLE", "Database service is temporarily unreachable.");
  } finally {
    clearTimeout(timer);
  }
}

async function getDocIfExists(
  docPath: string,
  idToken: string
): Promise<FirestoreDocument | null> {
  const { docsRoot } = getDbEndpoints();
  const url = `${baseUrl(docsRoot)}/${docPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${idToken}` },
      signal: controller.signal,
    });
    if (res.status === 404) return null;

    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as FirestoreDocument | { error?: { message?: string; status?: string } }) : null;
    if (!res.ok) {
      const errStatus =
        parsed && typeof parsed === "object" && "error" in parsed
          ? parsed.error?.status
          : undefined;
      if (res.status === 404 || errStatus === "NOT_FOUND") return null;
      if (res.status === 401) throw new RepoError(401, "AUTH_REQUIRED", "Authentication expired.");
      if (res.status === 403 || errStatus === "PERMISSION_DENIED") {
        throw new RepoError(403, "PERMISSION_DENIED", "Access denied for workspace document.");
      }
      throw new RepoError(502, "DB_ERROR", "Unable to read workspace document.");
    }
    return parsed as FirestoreDocument;
  } catch (err) {
    if (err instanceof RepoError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new RepoError(504, "DB_TIMEOUT", "Database request timed out.");
    }
    throw new RepoError(503, "DB_UNAVAILABLE", "Database service is temporarily unreachable.");
  } finally {
    clearTimeout(timer);
  }
}

async function queryOwnedCollection(
  uid: string,
  collectionId: "employees" | "projects" | "auditLogs",
  idToken: string
): Promise<FirestoreDocument[]> {
  const { docsRoot } = getDbEndpoints();
  const parentUrl = `${baseUrl(docsRoot)}/workspaces/${uid}:runQuery`;

  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: "ownerId" },
          op: "EQUAL",
          value: { stringValue: uid },
        },
      },
    },
  };

  const { data } = await firestoreFetch<Array<{ document?: FirestoreDocument }>>(
    parentUrl,
    idToken,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

  const docs: FirestoreDocument[] = [];
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && row.document) {
        docs.push(row.document);
      }
    }
  }
  return docs;
}

async function commitWrites(idToken: string, writes: FirestoreWrite[]): Promise<void> {
  if (writes.length === 0) return;
  const { docsRoot } = getDbEndpoints();
  const commitUrl = `${baseUrl(docsRoot)}:commit`;
  await firestoreFetch(commitUrl, idToken, {
    method: "POST",
    body: JSON.stringify({ writes }),
  });
}

function intVal(n: number): FirestoreValue {
  return { integerValue: String(Math.trunc(n)) };
}

function numVal(n: number): FirestoreValue {
  return Number.isInteger(n) ? intVal(n) : { doubleValue: n };
}

function strVal(s: string): FirestoreValue {
  return { stringValue: s };
}

function boolVal(b: boolean): FirestoreValue {
  return { booleanValue: b };
}

function strArrayVal(items: string[]): FirestoreValue {
  return {
    arrayValue: {
      values: items.map((s) => strVal(s)),
    },
  };
}

function readStr(fields: Record<string, FirestoreValue> | undefined, key: string, fallback = ""): string {
  const v = fields?.[key];
  if (v && "stringValue" in v) return v.stringValue;
  return fallback;
}

function readOptStr(fields: Record<string, FirestoreValue> | undefined, key: string): string | undefined {
  const v = fields?.[key];
  if (v && "stringValue" in v && v.stringValue.length > 0) return v.stringValue;
  return undefined;
}

function readNum(fields: Record<string, FirestoreValue> | undefined, key: string, fallback = 0): number {
  const v = fields?.[key];
  if (!v) return fallback;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  return fallback;
}

function readBool(fields: Record<string, FirestoreValue> | undefined, key: string, fallback = false): boolean {
  const v = fields?.[key];
  if (v && "booleanValue" in v) return v.booleanValue;
  return fallback;
}

function readTimestamp(fields: Record<string, FirestoreValue> | undefined, key: string, fallback = ""): string {
  const v = fields?.[key];
  if (v && "timestampValue" in v) return v.timestampValue;
  return fallback;
}

function readStrArray(fields: Record<string, FirestoreValue> | undefined, key: string): string[] {
  const v = fields?.[key];
  if (!v || !("arrayValue" in v)) return [];
  const vals = v.arrayValue.values ?? [];
  return vals
    .map((item) => ("stringValue" in item ? item.stringValue : null))
    .filter((x): x is string => x !== null);
}

function docToWorkspace(doc: FirestoreDocument): WorkspaceMetadata {
  const f = doc.fields;
  const origin = readStr(f, "seedOrigin", "seeded");
  return {
    ownerId: readStr(f, "ownerId"),
    revision: readNum(f, "revision", 1),
    legacyMigrated: readBool(f, "legacyMigrated", false),
    seedOrigin:
      origin === "migrated" || origin === "reset" ? origin : "seeded",
    createdAt: readTimestamp(f, "createdAt", doc.createTime ?? ""),
    updatedAt: readTimestamp(f, "updatedAt", doc.updateTime ?? ""),
  };
}

function docToEmployee(doc: FirestoreDocument): Employee {
  const f = doc.fields;
  return {
    id: readStr(f, "id"),
    ownerId: readStr(f, "ownerId"),
    name: readStr(f, "name"),
    nameAr: readStr(f, "nameAr"),
    role: readStr(f, "role"),
    roleAr: readStr(f, "roleAr"),
    department: readOptStr(f, "department"),
    departmentAr: readOptStr(f, "departmentAr"),
    weeklyCapacityHours: readNum(f, "weeklyCapacityHours", 40),
    skills: readStrArray(f, "skills") as ServiceType[],
    skillsVerified: readBool(f, "skillsVerified", false),
    version: readNum(f, "version", 1),
    createdAt: readTimestamp(f, "createdAt", doc.createTime ?? ""),
    updatedAt: readTimestamp(f, "updatedAt", doc.updateTime ?? ""),
  };
}

function docToProject(doc: FirestoreDocument): Project {
  const f = doc.fields;
  const hasBudget = f && ("budget" in f);
  return {
    id: readStr(f, "id"),
    ownerId: readStr(f, "ownerId"),
    clientName: readStr(f, "clientName"),
    clientNameAr: readStr(f, "clientNameAr"),
    serviceType: readStr(f, "serviceType") as ServiceType,
    title: readStr(f, "title"),
    titleAr: readStr(f, "titleAr"),
    assignedEmployeeId: readStr(f, "assignedEmployeeId"),
    startDate: readStr(f, "startDate"),
    deadline: readStr(f, "deadline"),
    completedDate: readOptStr(f, "completedDate"),
    lastUpdated: readStr(f, "lastUpdated"),
    status: readStr(f, "status") as ProjectStatus,
    progress: readNum(f, "progress", 0),
    priority: readStr(f, "priority") as PriorityLevel,
    estimatedWorkload: readNum(f, "estimatedWorkload", 1),
    budget: hasBudget ? readNum(f, "budget", 0) : undefined,
    notes: readStr(f, "notes"),
    notesAr: readStr(f, "notesAr"),
    version: readNum(f, "version", 1),
    createdAt: readTimestamp(f, "createdAt", doc.createTime ?? ""),
    updatedAt: readTimestamp(f, "updatedAt", doc.updateTime ?? ""),
  };
}

function docToAuditLog(doc: FirestoreDocument): AuditLogEntry {
  const f = doc.fields;
  return {
    id: readStr(f, "id"),
    ownerId: readStr(f, "ownerId"),
    action: readStr(f, "action") as AuditAction,
    entityType: readStr(f, "entityType") as AuditLogEntry["entityType"],
    entityId: readStr(f, "entityId"),
    actorId: readStr(f, "actorId"),
    previousVersion: readNum(f, "previousVersion", 0),
    newVersion: readNum(f, "newVersion", 0),
    changedFields: readStrArray(f, "changedFields"),
    summary: readStr(f, "summary"),
    createdAt: readTimestamp(f, "createdAt", doc.createTime ?? ""),
  };
}

function buildEmployeeFields(emp: Employee, uid: string, version: number): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {
    id: strVal(emp.id),
    ownerId: strVal(uid),
    name: strVal(emp.name.slice(0, 160)),
    nameAr: strVal((emp.nameAr || emp.name).slice(0, 160)),
    role: strVal(emp.role.slice(0, 160)),
    roleAr: strVal((emp.roleAr || emp.role).slice(0, 160)),
    weeklyCapacityHours: numVal(emp.weeklyCapacityHours),
    skills: strArrayVal(emp.skills),
    skillsVerified: boolVal(emp.skillsVerified),
    version: intVal(version),
  };
  if (emp.department) {
    fields.department = strVal(emp.department.slice(0, 160));
  }
  if (emp.departmentAr) {
    fields.departmentAr = strVal(emp.departmentAr.slice(0, 160));
  }
  return fields;
}

function buildProjectFields(proj: Project, uid: string, version: number): Record<string, FirestoreValue> {
  const title = proj.title.trim().slice(0, 240);
  const clientName = proj.clientName.trim().slice(0, 240);
  const fields: Record<string, FirestoreValue> = {
    id: strVal(proj.id),
    ownerId: strVal(uid),
    clientName: strVal(clientName),
    clientNameAr: strVal((proj.clientNameAr?.trim() || clientName).slice(0, 240)),
    serviceType: strVal(proj.serviceType),
    title: strVal(title),
    titleAr: strVal((proj.titleAr?.trim() || title).slice(0, 240)),
    assignedEmployeeId: strVal(proj.assignedEmployeeId),
    startDate: strVal(proj.startDate),
    deadline: strVal(proj.deadline),
    lastUpdated: strVal(proj.lastUpdated),
    status: strVal(proj.status),
    progress: numVal(proj.progress),
    priority: strVal(proj.priority),
    estimatedWorkload: numVal(proj.estimatedWorkload),
    notes: strVal((proj.notes ?? "").slice(0, 2000)),
    notesAr: strVal((proj.notesAr ?? proj.notes ?? "").slice(0, 2000)),
    version: intVal(version),
  };
  if (typeof proj.budget === "number" && Number.isFinite(proj.budget)) {
    fields.budget = numVal(proj.budget);
  }
  if (proj.completedDate) {
    fields.completedDate = strVal(proj.completedDate);
  }
  return fields;
}

function buildAuditWrite(
  docsRoot: string,
  uid: string,
  params: {
    action: AuditAction;
    entityType: "workspace" | "project" | "employee";
    entityId: string;
    previousVersion: number;
    newVersion: number;
    changedFields: string[];
    summary: string;
  }
): FirestoreWrite {
  const auditId = `AUD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    update: {
      name: `${docsRoot}/workspaces/${uid}/auditLogs/${auditId}`,
      fields: {
        id: strVal(auditId),
        ownerId: strVal(uid),
        action: strVal(params.action),
        entityType: strVal(params.entityType),
        entityId: strVal(params.entityId),
        actorId: strVal(uid),
        previousVersion: intVal(params.previousVersion),
        newVersion: intVal(params.newVersion),
        changedFields: strArrayVal(params.changedFields.slice(0, 25)),
        summary: strVal(params.summary.slice(0, 500)),
      },
    },
    updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
    currentDocument: { exists: false },
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sortProjectsStable(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    if (b.createdAt && a.createdAt && b.createdAt !== a.createdAt) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    return a.id.localeCompare(b.id);
  });
}

export async function getWorkspaceSnapshot(
  caller: VerifiedFirebaseUser
): Promise<WorkspaceSnapshotResponse> {
  assertFirebaseCaller(caller);
  const workspaceDoc = await getDocIfExists(`workspaces/${caller.uid}`, caller.idToken);
  if (!workspaceDoc) {
    return {
      initialized: false,
      workspace: null,
      employees: [],
      projects: [],
    };
  }

  const [empDocs, projDocs] = await Promise.all([
    queryOwnedCollection(caller.uid, "employees", caller.idToken),
    queryOwnedCollection(caller.uid, "projects", caller.idToken),
  ]);

  const employees = empDocs.map(docToEmployee).sort((a, b) => a.id.localeCompare(b.id));
  const projects = sortProjectsStable(projDocs.map(docToProject));

  return {
    initialized: true,
    workspace: docToWorkspace(workspaceDoc),
    employees,
    projects,
  };
}

export interface LegacyProjectInput {
  id: string;
  clientName: string;
  clientNameAr: string;
  serviceType: ServiceType;
  title: string;
  titleAr: string;
  assignedEmployeeId: string;
  startDate: string;
  deadline: string;
  completedDate?: string;
  lastUpdated: string;
  status: ProjectStatus;
  progress: number;
  priority: PriorityLevel;
  estimatedWorkload: number;
  budget?: number;
  notes: string;
  notesAr: string;
}

export async function migrateLegacyOrSeedWorkspace(
  caller: VerifiedFirebaseUser,
  legacyProjects: LegacyProjectInput[]
): Promise<{
  snapshot: WorkspaceSnapshotResponse;
  migratedCount: number;
  skippedDuplicates: number;
  seeded: boolean;
}> {
  assertFirebaseCaller(caller);
  const { docsRoot } = getDbEndpoints();
  const uid = caller.uid;
  const existingWorkspaceDoc = await getDocIfExists(`workspaces/${uid}`, caller.idToken);

  const validEmpIds = new Set(INITIAL_EMPLOYEES.map((e) => e.id));
  const dedupedLegacy: LegacyProjectInput[] = [];
  const seenIds = new Set<string>();
  let skippedDuplicates = 0;

  for (const item of legacyProjects) {
    if (seenIds.has(item.id)) {
      skippedDuplicates += 1;
      continue;
    }
    seenIds.add(item.id);
    dedupedLegacy.push({
      ...item,
      assignedEmployeeId: validEmpIds.has(item.assignedEmployeeId)
        ? item.assignedEmployeeId
        : INITIAL_EMPLOYEES[0].id,
    });
  }

  if (!existingWorkspaceDoc) {
    const hasLegacy = dedupedLegacy.length > 0;
    const projectsToCreate = hasLegacy ? dedupedLegacy : createInitialProjects();
    const writes: FirestoreWrite[] = [];

    writes.push({
      update: {
        name: `${docsRoot}/workspaces/${uid}`,
        fields: {
          ownerId: strVal(uid),
          revision: intVal(1),
          legacyMigrated: boolVal(true),
          seedOrigin: strVal(hasLegacy ? "migrated" : "seeded"),
        },
      },
      updateTransforms: [
        { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
        { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
      ],
      currentDocument: { exists: false },
    });

    for (const emp of INITIAL_EMPLOYEES) {
      writes.push({
        update: {
          name: `${docsRoot}/workspaces/${uid}/employees/${emp.id}`,
          fields: buildEmployeeFields(emp, uid, 1),
        },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
        ],
        currentDocument: { exists: false },
      });
    }

    for (const proj of projectsToCreate) {
      writes.push({
        update: {
          name: `${docsRoot}/workspaces/${uid}/projects/${proj.id}`,
          fields: buildProjectFields(proj, uid, 1),
        },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
        ],
        currentDocument: { exists: false },
      });
    }

    writes.push(
      buildAuditWrite(docsRoot, uid, {
        action: hasLegacy ? "legacy_migrated" : "workspace_seeded",
        entityType: "workspace",
        entityId: uid,
        previousVersion: 0,
        newVersion: 1,
        changedFields: [hasLegacy ? "migrated" : "seeded"],
        summary: hasLegacy
          ? `Migrated ${projectsToCreate.length} legacy project(s) into cloud workspace (${skippedDuplicates} duplicate(s) skipped).`
          : `Initialized cloud workspace with ${projectsToCreate.length} starter project(s) and ${INITIAL_EMPLOYEES.length} team members.`,
      })
    );

    await commitWrites(caller.idToken, writes);
    const snapshot = await getWorkspaceSnapshot(caller);
    return {
      snapshot,
      migratedCount: hasLegacy ? projectsToCreate.length : 0,
      skippedDuplicates,
      seeded: !hasLegacy,
    };
  }

  // Workspace already exists: NEVER overwrite existing DB rows!
  const currentWs = docToWorkspace(existingWorkspaceDoc);
  if (currentWs.legacyMigrated) {
    const snapshot = await getWorkspaceSnapshot(caller);
    return {
      snapshot,
      migratedCount: 0,
      skippedDuplicates: dedupedLegacy.length + skippedDuplicates,
      seeded: false,
    };
  }

  const [existingProjDocs, existingEmpDocs] = await Promise.all([
    queryOwnedCollection(uid, "projects", caller.idToken),
    queryOwnedCollection(uid, "employees", caller.idToken),
  ]);
  const existingProjectIds = new Set(existingProjDocs.map((d) => docToProject(d).id));
  const existingEmpIds = new Set(existingEmpDocs.map((d) => docToEmployee(d).id));

  const writes: FirestoreWrite[] = [];
  for (const emp of INITIAL_EMPLOYEES) {
    if (!existingEmpIds.has(emp.id)) {
      writes.push({
        update: {
          name: `${docsRoot}/workspaces/${uid}/employees/${emp.id}`,
          fields: buildEmployeeFields(emp, uid, 1),
        },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
        ],
        currentDocument: { exists: false },
      });
    }
  }

  let migratedCount = 0;
  for (const proj of dedupedLegacy) {
    if (existingProjectIds.has(proj.id)) {
      skippedDuplicates += 1;
      continue;
    }
    migratedCount += 1;
    writes.push({
      update: {
        name: `${docsRoot}/workspaces/${uid}/projects/${proj.id}`,
        fields: buildProjectFields(proj, uid, 1),
      },
      updateTransforms: [
        { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
        { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
      ],
      currentDocument: { exists: false },
    });
  }

  const nextRevision = currentWs.revision + 1;
  writes.push({
    update: {
      name: `${docsRoot}/workspaces/${uid}`,
      fields: {
        revision: intVal(nextRevision),
        legacyMigrated: boolVal(true),
      },
    },
    updateMask: { fieldPaths: ["revision", "legacyMigrated", "updatedAt"] },
    updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
    currentDocument: { updateTime: existingWorkspaceDoc.updateTime },
  });

  writes.push(
    buildAuditWrite(docsRoot, uid, {
      action: "legacy_migrated",
      entityType: "workspace",
      entityId: uid,
      previousVersion: currentWs.revision,
      newVersion: nextRevision,
      changedFields: ["migrated"],
      summary: `Completed legacy migration check: imported ${migratedCount} new project(s), skipped ${skippedDuplicates} existing/duplicate record(s).`,
    })
  );

  await commitWrites(caller.idToken, writes);
  const snapshot = await getWorkspaceSnapshot(caller);
  return {
    snapshot,
    migratedCount,
    skippedDuplicates,
    seeded: false,
  };
}

export interface CreateProjectInput {
  id?: string;
  clientName: string;
  clientNameAr: string;
  serviceType: ServiceType;
  title: string;
  titleAr: string;
  assignedEmployeeId: string;
  startDate: string;
  deadline: string;
  completedDate?: string;
  status: ProjectStatus;
  progress: number;
  priority: PriorityLevel;
  estimatedWorkload: number;
  budget?: number;
  notes: string;
  notesAr: string;
}

export async function createProjectInDb(
  caller: VerifiedFirebaseUser,
  input: CreateProjectInput
): Promise<{ project: Project; revision: number }> {
  assertFirebaseCaller(caller);
  const { docsRoot } = getDbEndpoints();
  const uid = caller.uid;

  const [wsDoc, empDocs, projDocs] = await Promise.all([
    getDocIfExists(`workspaces/${uid}`, caller.idToken),
    queryOwnedCollection(uid, "employees", caller.idToken),
    queryOwnedCollection(uid, "projects", caller.idToken),
  ]);

  if (!wsDoc) {
    throw new RepoError(
      409,
      "WORKSPACE_NOT_INITIALIZED",
      "Workspace must be initialized before creating projects."
    );
  }

  const validEmpIds = new Set(empDocs.map((d) => docToEmployee(d).id));
  if (!validEmpIds.has(input.assignedEmployeeId)) {
    throw new RepoError(
      400,
      "INVALID_EMPLOYEE",
      `Assigned employee "${input.assignedEmployeeId}" does not exist in this workspace.`
    );
  }

  const existingProjects = projDocs.map(docToProject);
  if (existingProjects.length >= 200) {
    throw new RepoError(
      400,
      "LIMIT_REACHED",
      "Workspace has reached the maximum limit of 200 projects."
    );
  }

  let nextId = input.id;
  if (!nextId) {
    const maxNum = existingProjects.reduce((max, p) => {
      const m = p.id.match(/^OP-(\d+)$/);
      const num = m ? Number(m[1]) : 0;
      return Number.isFinite(num) ? Math.max(max, num) : max;
    }, 1061);
    nextId = `OP-${maxNum + 1}`;
  }

  const today = todayISO();
  const completedDate =
    input.status === "completed" ? input.completedDate ?? today : undefined;
  const progress = input.status === "completed" ? 100 : input.progress;

  const projectRecord: Project = {
    id: nextId,
    ownerId: uid,
    clientName: input.clientName,
    clientNameAr: input.clientNameAr || input.clientName,
    serviceType: input.serviceType,
    title: input.title,
    titleAr: input.titleAr || input.title,
    assignedEmployeeId: input.assignedEmployeeId,
    startDate: input.startDate,
    deadline: input.deadline,
    completedDate,
    lastUpdated: today,
    status: input.status,
    progress,
    priority: input.priority,
    estimatedWorkload: input.estimatedWorkload,
    budget: input.budget,
    notes: input.notes,
    notesAr: input.notesAr || input.notes,
    version: 1,
  };

  const ws = docToWorkspace(wsDoc);
  const nextRevision = ws.revision + 1;

  const writes: FirestoreWrite[] = [
    {
      update: {
        name: `${docsRoot}/workspaces/${uid}`,
        fields: {
          revision: intVal(nextRevision),
        },
      },
      updateMask: { fieldPaths: ["revision", "updatedAt"] },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { updateTime: wsDoc.updateTime },
    },
    {
      update: {
        name: `${docsRoot}/workspaces/${uid}/projects/${projectRecord.id}`,
        fields: buildProjectFields(projectRecord, uid, 1),
      },
      updateTransforms: [
        { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
        { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
      ],
      currentDocument: { exists: false },
    },
    buildAuditWrite(docsRoot, uid, {
      action: "project_created",
      entityType: "project",
      entityId: projectRecord.id,
      previousVersion: 0,
      newVersion: 1,
      changedFields: [
        "title",
        "clientName",
        "serviceType",
        "assignedEmployeeId",
        "deadline",
        "status",
        "priority",
        "estimatedWorkload",
      ],
      summary: `Created project ${projectRecord.id} (${projectRecord.title}) assigned to ${projectRecord.assignedEmployeeId}.`,
    }),
  ];

  await commitWrites(caller.idToken, writes);

  const createdDoc = await getDocIfExists(
    `workspaces/${uid}/projects/${projectRecord.id}`,
    caller.idToken
  );
  return {
    project: createdDoc ? docToProject(createdDoc) : projectRecord,
    revision: nextRevision,
  };
}

export interface UpdateProjectPatch {
  clientName?: string;
  clientNameAr?: string;
  serviceType?: ServiceType;
  title?: string;
  titleAr?: string;
  assignedEmployeeId?: string;
  startDate?: string;
  deadline?: string;
  completedDate?: string | null;
  status?: ProjectStatus;
  progress?: number;
  priority?: PriorityLevel;
  estimatedWorkload?: number;
  budget?: number;
  notes?: string;
  notesAr?: string;
}

export async function updateProjectInDb(
  caller: VerifiedFirebaseUser,
  projectId: string,
  patch: UpdateProjectPatch,
  expectedVersion: number
): Promise<{ project: Project; revision: number }> {
  assertFirebaseCaller(caller);
  const { docsRoot } = getDbEndpoints();
  const uid = caller.uid;

  const [wsDoc, existingDoc, empDocs] = await Promise.all([
    getDocIfExists(`workspaces/${uid}`, caller.idToken),
    getDocIfExists(`workspaces/${uid}/projects/${projectId}`, caller.idToken),
    patch.assignedEmployeeId
      ? queryOwnedCollection(uid, "employees", caller.idToken)
      : Promise.resolve([]),
  ]);

  if (!wsDoc || !existingDoc) {
    throw new RepoError(404, "NOT_FOUND", `Project "${projectId}" was not found.`);
  }

  const existing = docToProject(existingDoc);
  const currentVersion = existing.version ?? 1;
  if (currentVersion !== expectedVersion) {
    throw new RepoError(
      409,
      "VERSION_CONFLICT",
      `Project ${projectId} was modified concurrently (expected v${expectedVersion}, found v${currentVersion}).`
    );
  }

  if (patch.assignedEmployeeId) {
    const validEmpIds = new Set(empDocs.map((d) => docToEmployee(d).id));
    if (!validEmpIds.has(patch.assignedEmployeeId)) {
      throw new RepoError(
        400,
        "INVALID_EMPLOYEE",
        `Assigned employee "${patch.assignedEmployeeId}" does not exist in this workspace.`
      );
    }
  }

  const nextStatus = patch.status ?? existing.status;
  const nextProgress =
    nextStatus === "completed"
      ? 100
      : patch.progress !== undefined
      ? patch.progress
      : existing.progress;

  let nextCompletedDate: string | undefined = existing.completedDate;
  if (patch.completedDate === null || (nextStatus !== "completed" && patch.status !== undefined)) {
    nextCompletedDate = undefined;
  } else if (nextStatus === "completed") {
    nextCompletedDate =
      typeof patch.completedDate === "string"
        ? patch.completedDate
        : existing.completedDate ?? todayISO();
  } else if (typeof patch.completedDate === "string") {
    nextCompletedDate = patch.completedDate;
  }

  const nextVersion = currentVersion + 1;
  const today = todayISO();

  const updatedProject: Project = {
    ...existing,
    clientName: patch.clientName ?? existing.clientName,
    clientNameAr:
      patch.clientNameAr ??
      (patch.clientName ? patch.clientName : existing.clientNameAr),
    serviceType: patch.serviceType ?? existing.serviceType,
    title: patch.title ?? existing.title,
    titleAr:
      patch.titleAr ??
      (patch.title ? patch.title : existing.titleAr),
    assignedEmployeeId: patch.assignedEmployeeId ?? existing.assignedEmployeeId,
    startDate: patch.startDate ?? existing.startDate,
    deadline: patch.deadline ?? existing.deadline,
    completedDate: nextCompletedDate,
    lastUpdated: today,
    status: nextStatus,
    progress: nextProgress,
    priority: patch.priority ?? existing.priority,
    estimatedWorkload: patch.estimatedWorkload ?? existing.estimatedWorkload,
    budget: patch.budget !== undefined ? patch.budget : existing.budget,
    notes: patch.notes ?? existing.notes,
    notesAr:
      patch.notesAr ??
      (patch.notes !== undefined ? patch.notes : existing.notesAr),
    version: nextVersion,
  };

  const changedFields: string[] = [];
  const checkField = (k: keyof Project) => {
    if (existing[k] !== updatedProject[k]) {
      changedFields.push(k);
    }
  };
  (
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
    ] as const
  ).forEach(checkField);

  const isPureReassignment =
    changedFields.length === 1 && changedFields[0] === "assignedEmployeeId";

  const fieldPathsToUpdate = Array.from(
    new Set([
      ...changedFields,
      "lastUpdated",
      "version",
      "updatedAt",
    ])
  );

  const fullFields = buildProjectFields(updatedProject, uid, nextVersion);
  const patchFields: Record<string, FirestoreValue> = {};
  for (const fp of fieldPathsToUpdate) {
    if (fp === "updatedAt") continue;
    if (fp in fullFields) {
      patchFields[fp] = fullFields[fp];
    }
    // If completedDate is in fieldPathsToUpdate but omitted from patchFields, Firestore deletes the field cleanly
  }

  const ws = docToWorkspace(wsDoc);
  const nextRevision = ws.revision + 1;

  const summary = isPureReassignment
    ? `Reassigned ${projectId} from ${existing.assignedEmployeeId} to ${updatedProject.assignedEmployeeId} (v${currentVersion} -> v${nextVersion}).`
    : `Updated ${projectId} (${changedFields.length > 0 ? changedFields.join(", ") : "lastUpdated"}) (v${currentVersion} -> v${nextVersion}).`;

  const writes: FirestoreWrite[] = [
    {
      update: {
        name: `${docsRoot}/workspaces/${uid}`,
        fields: {
          revision: intVal(nextRevision),
        },
      },
      updateMask: { fieldPaths: ["revision", "updatedAt"] },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { updateTime: wsDoc.updateTime },
    },
    {
      update: {
        name: `${docsRoot}/workspaces/${uid}/projects/${projectId}`,
        fields: patchFields,
      },
      updateMask: { fieldPaths: fieldPathsToUpdate },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { updateTime: existingDoc.updateTime },
    },
    buildAuditWrite(docsRoot, uid, {
      action: isPureReassignment ? "project_reassigned" : "project_updated",
      entityType: "project",
      entityId: projectId,
      previousVersion: currentVersion,
      newVersion: nextVersion,
      changedFields: changedFields.length > 0 ? changedFields : ["lastUpdated"],
      summary,
    }),
  ];

  await commitWrites(caller.idToken, writes);
  const refreshed = await getDocIfExists(
    `workspaces/${uid}/projects/${projectId}`,
    caller.idToken
  );
  return {
    project: refreshed ? docToProject(refreshed) : updatedProject,
    revision: nextRevision,
  };
}

export async function deleteProjectInDb(
  caller: VerifiedFirebaseUser,
  projectId: string,
  expectedVersion?: number
): Promise<{ deletedId: string; revision: number }> {
  assertFirebaseCaller(caller);
  const { docsRoot } = getDbEndpoints();
  const uid = caller.uid;

  const [wsDoc, existingDoc] = await Promise.all([
    getDocIfExists(`workspaces/${uid}`, caller.idToken),
    getDocIfExists(`workspaces/${uid}/projects/${projectId}`, caller.idToken),
  ]);

  if (!wsDoc || !existingDoc) {
    throw new RepoError(404, "NOT_FOUND", `Project "${projectId}" was not found.`);
  }

  const existing = docToProject(existingDoc);
  const currentVersion = existing.version ?? 1;
  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new RepoError(
      409,
      "VERSION_CONFLICT",
      `Project ${projectId} changed concurrently before deletion.`
    );
  }

  const ws = docToWorkspace(wsDoc);
  const nextRevision = ws.revision + 1;

  const writes: FirestoreWrite[] = [
    {
      update: {
        name: `${docsRoot}/workspaces/${uid}`,
        fields: {
          revision: intVal(nextRevision),
        },
      },
      updateMask: { fieldPaths: ["revision", "updatedAt"] },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { updateTime: wsDoc.updateTime },
    },
    {
      delete: `${docsRoot}/workspaces/${uid}/projects/${projectId}`,
      currentDocument: { updateTime: existingDoc.updateTime },
    },
    buildAuditWrite(docsRoot, uid, {
      action: "project_deleted",
      entityType: "project",
      entityId: projectId,
      previousVersion: currentVersion,
      newVersion: 0,
      changedFields: ["deleted"],
      summary: `Deleted project ${projectId} (${existing.title}) at v${currentVersion}.`,
    }),
  ];

  await commitWrites(caller.idToken, writes);
  return { deletedId: projectId, revision: nextRevision };
}

export async function resetWorkspaceToDemoInDb(
  caller: VerifiedFirebaseUser
): Promise<WorkspaceSnapshotResponse> {
  assertFirebaseCaller(caller);
  const { docsRoot } = getDbEndpoints();
  const uid = caller.uid;

  const wsDoc = await getDocIfExists(`workspaces/${uid}`, caller.idToken);
  if (!wsDoc) {
    const res = await migrateLegacyOrSeedWorkspace(caller, []);
    return res.snapshot;
  }

  const [existingProjDocs, existingEmpDocs] = await Promise.all([
    queryOwnedCollection(uid, "projects", caller.idToken),
    queryOwnedCollection(uid, "employees", caller.idToken),
  ]);

  const ws = docToWorkspace(wsDoc);
  const nextRevision = ws.revision + 1;
  const freshProjects = createInitialProjects();
  const freshIds = new Set(freshProjects.map((p) => p.id));
  const existingEmpMap = new Map(existingEmpDocs.map((d) => [docToEmployee(d).id, d]));

  const writes: FirestoreWrite[] = [];

  writes.push({
    update: {
      name: `${docsRoot}/workspaces/${uid}`,
      fields: {
        revision: intVal(nextRevision),
        legacyMigrated: boolVal(true),
        seedOrigin: strVal("reset"),
      },
    },
    updateMask: { fieldPaths: ["revision", "legacyMigrated", "seedOrigin", "updatedAt"] },
    updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
    currentDocument: { updateTime: wsDoc.updateTime },
  });

  // Delete projects not in fresh seed; replace matching IDs cleanly by deleting & recreating or updating
  for (const doc of existingProjDocs) {
    const p = docToProject(doc);
    if (!freshIds.has(p.id)) {
      writes.push({
        delete: `${docsRoot}/workspaces/${uid}/projects/${p.id}`,
        currentDocument: { updateTime: doc.updateTime },
      });
    }
  }

  const existingProjMap = new Map(existingProjDocs.map((d) => [docToProject(d).id, d]));

  for (const emp of INITIAL_EMPLOYEES) {
    const existingEmpDoc = existingEmpMap.get(emp.id);
    if (!existingEmpDoc) {
      writes.push({
        update: {
          name: `${docsRoot}/workspaces/${uid}/employees/${emp.id}`,
          fields: buildEmployeeFields(emp, uid, 1),
        },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
        ],
        currentDocument: { exists: false },
      });
    }
  }

  for (const proj of freshProjects) {
    const existingProjDoc = existingProjMap.get(proj.id);
    if (existingProjDoc) {
      const prevVersion = docToProject(existingProjDoc).version ?? 1;
      const nextVersion = prevVersion + 1;
      const fields = buildProjectFields(proj, uid, nextVersion);
      const maskPaths = [
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
        "version",
        "updatedAt",
      ];
      const updateFields: Record<string, FirestoreValue> = {};
      for (const mp of maskPaths) {
        if (mp === "updatedAt") continue;
        if (mp in fields) updateFields[mp] = fields[mp];
      }
      writes.push({
        update: {
          name: `${docsRoot}/workspaces/${uid}/projects/${proj.id}`,
          fields: updateFields,
        },
        updateMask: { fieldPaths: maskPaths },
        updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
        currentDocument: { updateTime: existingProjDoc.updateTime },
      });
    } else {
      writes.push({
        update: {
          name: `${docsRoot}/workspaces/${uid}/projects/${proj.id}`,
          fields: buildProjectFields(proj, uid, 1),
        },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
        ],
        currentDocument: { exists: false },
      });
    }
  }

  writes.push(
    buildAuditWrite(docsRoot, uid, {
      action: "workspace_reset",
      entityType: "workspace",
      entityId: uid,
      previousVersion: ws.revision,
      newVersion: nextRevision,
      changedFields: ["reset"],
      summary: `Reset workspace to ${freshProjects.length} baseline sample projects (revision ${ws.revision} -> ${nextRevision}).`,
    })
  );

  await commitWrites(caller.idToken, writes);
  return getWorkspaceSnapshot(caller);
}

export async function getAuditLogsFromDb(
  caller: VerifiedFirebaseUser,
  limit = 50
): Promise<AuditLogEntry[]> {
  assertFirebaseCaller(caller);
  const wsDoc = await getDocIfExists(`workspaces/${caller.uid}`, caller.idToken);
  if (!wsDoc) return [];

  const docs = await queryOwnedCollection(caller.uid, "auditLogs", caller.idToken);
  return docs
    .map(docToAuditLog)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(200, limit)));
}
