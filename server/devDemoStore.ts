import crypto from "crypto";
import { createInitialProjects, INITIAL_EMPLOYEES } from "../src/data/seedData.js";
import type {
  AuditAction,
  AuditLogEntry,
  Employee,
  Project,
  WorkspaceMetadata,
  WorkspaceSnapshotResponse,
} from "../src/types.js";
import {
  type CreateProjectInput,
  type LegacyProjectInput,
  RepoError,
  type UpdateProjectPatch,
} from "./firestoreRepo.js";

interface DevDemoWorkspaceState {
  initialized: boolean;
  lastAccessedAt: number;
  workspace: WorkspaceMetadata;
  employees: Employee[];
  projects: Project[];
  auditLogs: AuditLogEntry[];
}

const MAX_DEMO_WORKSPACES = 250;
const WORKSPACE_TTL_MS = 4 * 60 * 60 * 1000;
const demoWorkspaces = new Map<string, DevDemoWorkspaceState>();

function assertPublicDemoRuntime(uid: string): void {
  if (process.env.OPSPILOT_PUBLIC_DEMO === "false") {
    throw new RepoError(
      403,
      "PUBLIC_DEMO_DISABLED",
      "Public demo mode is disabled."
    );
  }
  if (!uid || !uid.startsWith("demo_")) {
    throw new RepoError(
      403,
      "INVALID_DEMO_CALLER",
      "Invalid demo session identifier."
    );
  }
}

export function pruneExpiredDemoWorkspaces(now = Date.now()): void {
  for (const [id, st] of demoWorkspaces) {
    if (now - st.lastAccessedAt >= WORKSPACE_TTL_MS) {
      demoWorkspaces.delete(id);
    }
  }
  while (demoWorkspaces.size > MAX_DEMO_WORKSPACES) {
    const oldest = demoWorkspaces.keys().next().value;
    if (!oldest) break;
    demoWorkspaces.delete(oldest);
  }
}

const cleanupInterval = setInterval(() => {
  pruneExpiredDemoWorkspaces(Date.now());
}, 10 * 60 * 1000);
cleanupInterval.unref?.();

export function stopDemoCleanupTimer(): void {
  clearInterval(cleanupInterval);
}

function nowISO(): string {
  return new Date().toISOString();
}

function offsetHoursISO(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function cloneEmployee(emp: Employee): Employee {
  return { ...emp, skills: [...emp.skills] };
}

function cloneProject(proj: Project): Project {
  return { ...proj };
}

function sortProjectsStable(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    if (b.createdAt && a.createdAt && b.createdAt !== a.createdAt) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    return a.id.localeCompare(b.id);
  });
}

function appendAuditEntry(
  state: DevDemoWorkspaceState,
  uid: string,
  params: {
    action: AuditAction;
    entityType: "workspace" | "project" | "employee";
    entityId: string;
    previousVersion: number;
    newVersion: number;
    changedFields: string[];
    summary: string;
    createdAt?: string;
  }
): void {
  const entry: AuditLogEntry = {
    id: `AUD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    ownerId: uid,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    actorId: uid,
    previousVersion: params.previousVersion,
    newVersion: params.newVersion,
    changedFields: params.changedFields.slice(0, 25),
    summary: params.summary.slice(0, 500),
    createdAt: params.createdAt ?? nowISO(),
  };
  state.auditLogs.unshift(entry);
  if (state.auditLogs.length > 500) {
    state.auditLogs.length = 500;
  }
}

function seedHistoricalAudits(
  state: DevDemoWorkspaceState,
  uid: string,
  projectsCount: number,
  employeesCount: number
): void {
  const historical: Array<{
    action: AuditAction;
    entityType: "workspace" | "project" | "employee";
    entityId: string;
    previousVersion: number;
    newVersion: number;
    changedFields: string[];
    summary: string;
    hoursAgo: number;
  }> = [
    {
      action: "workspace_seeded",
      entityType: "workspace",
      entityId: uid,
      previousVersion: 0,
      newVersion: 1,
      changedFields: ["seeded"],
      summary: `Provisioned isolated portfolio demo workspace with ${projectsCount} projects and ${employeesCount} specialists across 7 departments.`,
      hoursAgo: 336,
    },
    {
      action: "project_updated",
      entityType: "project",
      entityId: "OP-1061",
      previousVersion: 1,
      newVersion: 2,
      changedFields: ["status", "progress", "completedDate"],
      summary: "Completed OP-1061 (Lab Supply Chain Risk Playbook) ahead of deadline with clinical committee sign-off.",
      hoursAgo: 240,
    },
    {
      action: "project_updated",
      entityType: "project",
      entityId: "OP-1041",
      previousVersion: 1,
      newVersion: 2,
      changedFields: ["priority", "notes"],
      summary: "Escalated OP-1041 (Customer Shipment Tracking Portal) to critical after carrier gateway webhook stall.",
      hoursAgo: 168,
    },
    {
      action: "project_reassigned",
      entityType: "project",
      entityId: "OP-1060",
      previousVersion: 1,
      newVersion: 2,
      changedFields: ["assignedEmployeeId"],
      summary: "Reassigned OP-1060 (Q1 Partner Enablement Campaign Brief) to EMP-06 (Layla Al-Harbi) in Marketing Operations.",
      hoursAgo: 96,
    },
    {
      action: "project_updated",
      entityType: "project",
      entityId: "OP-1042",
      previousVersion: 1,
      newVersion: 2,
      changedFields: ["status", "progress"],
      summary: "Moved OP-1042 (GCC Outpatient Expansion Market Study) to Under Review at 82% completion.",
      hoursAgo: 48,
    },
    {
      action: "project_created",
      entityType: "project",
      entityId: "OP-1059",
      previousVersion: 0,
      newVersion: 1,
      changedFields: ["title", "assignedEmployeeId", "priority", "budget"],
      summary: "Created OP-1059 (Zero-Downtime Auth Gateway QA) assigned to EMP-07 (Rami Khoury).",
      hoursAgo: 20,
    },
    {
      action: "project_updated",
      entityType: "project",
      entityId: "OP-1046",
      previousVersion: 1,
      newVersion: 2,
      changedFields: ["progress", "notes"],
      summary: "Updated OP-1046 (Boutique Hotel Rebrand & Print Kit) to 75% after print vendor dieline revision.",
      hoursAgo: 2,
    },
  ];

  // Insert chronological oldest -> newest so unshift produces newest-first
  for (const item of historical) {
    appendAuditEntry(state, uid, {
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      previousVersion: item.previousVersion,
      newVersion: item.newVersion,
      changedFields: item.changedFields,
      summary: item.summary,
      createdAt: offsetHoursISO(item.hoursAgo),
    });
  }
}

function createSeededState(uid: string): DevDemoWorkspaceState {
  const ts = nowISO();
  const now = Date.now();
  const employees: Employee[] = INITIAL_EMPLOYEES.map((emp) => ({
    ...cloneEmployee(emp),
    ownerId: uid,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  }));

  const projects: Project[] = createInitialProjects().map((proj) => ({
    ...cloneProject(proj),
    ownerId: uid,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  }));

  const state: DevDemoWorkspaceState = {
    initialized: true,
    lastAccessedAt: now,
    workspace: {
      ownerId: uid,
      revision: 1,
      legacyMigrated: true,
      seedOrigin: "seeded",
      createdAt: ts,
      updatedAt: ts,
    },
    employees,
    projects,
    auditLogs: [],
  };

  seedHistoricalAudits(state, uid, projects.length, employees.length);

  return state;
}

function ensureState(uid: string): DevDemoWorkspaceState {
  assertPublicDemoRuntime(uid);
  const now = Date.now();
  pruneExpiredDemoWorkspaces(now);

  let state = demoWorkspaces.get(uid);
  if (!state) {
    if (demoWorkspaces.size >= MAX_DEMO_WORKSPACES) {
      const oldest = demoWorkspaces.keys().next().value;
      if (oldest) demoWorkspaces.delete(oldest);
    }
    state = createSeededState(uid);
    demoWorkspaces.set(uid, state);
  } else {
    // Touch LRU insertion order
    demoWorkspaces.delete(uid);
    state.lastAccessedAt = now;
    demoWorkspaces.set(uid, state);
  }
  return state;
}

function buildSnapshot(state: DevDemoWorkspaceState): WorkspaceSnapshotResponse {
  return {
    initialized: state.initialized,
    workspace: { ...state.workspace },
    employees: state.employees.map(cloneEmployee).sort((a, b) => a.id.localeCompare(b.id)),
    projects: sortProjectsStable(state.projects.map(cloneProject)),
  };
}

export function getDevDemoWorkspaceSnapshot(uid: string): WorkspaceSnapshotResponse {
  const state = ensureState(uid);
  return buildSnapshot(state);
}

export function migrateOrSeedDevDemoWorkspace(
  uid: string,
  _legacyProjects: LegacyProjectInput[]
): {
  snapshot: WorkspaceSnapshotResponse;
  migratedCount: number;
  skippedDuplicates: number;
  seeded: boolean;
} {
  const existed = demoWorkspaces.has(uid);
  const state = ensureState(uid);
  return {
    snapshot: buildSnapshot(state),
    migratedCount: 0,
    skippedDuplicates: 0,
    seeded: !existed,
  };
}

export function createDevDemoProject(
  uid: string,
  input: CreateProjectInput
): { project: Project; revision: number } {
  const state = ensureState(uid);

  const validEmpIds = new Set(state.employees.map((e) => e.id));
  if (!validEmpIds.has(input.assignedEmployeeId)) {
    throw new RepoError(
      400,
      "INVALID_EMPLOYEE",
      `Assigned employee "${input.assignedEmployeeId}" does not exist in this workspace.`
    );
  }

  if (state.projects.length >= 200) {
    throw new RepoError(
      400,
      "LIMIT_REACHED",
      "Workspace has reached the maximum limit of 200 projects."
    );
  }

  let nextId = input.id;
  if (nextId && state.projects.some((p) => p.id === nextId)) {
    throw new RepoError(
      409,
      "VERSION_CONFLICT",
      `Project "${nextId}" already exists in this workspace.`
    );
  }
  if (!nextId) {
    const maxNum = state.projects.reduce((max, p) => {
      const m = p.id.match(/^OP-(\d+)$/);
      const num = m ? Number(m[1]) : 0;
      return Number.isFinite(num) ? Math.max(max, num) : max;
    }, 1061);
    nextId = `OP-${maxNum + 1}`;
  }

  const ts = nowISO();
  const today = todayISO();
  const completedDate =
    input.status === "completed" ? input.completedDate ?? today : undefined;
  const progress = input.status === "completed" ? 100 : input.progress;

  const projectRecord: Project = {
    id: nextId,
    ownerId: uid,
    clientName: input.clientName.trim().slice(0, 240),
    clientNameAr: (input.clientNameAr?.trim() || input.clientName.trim()).slice(0, 240),
    serviceType: input.serviceType,
    title: input.title.trim().slice(0, 240),
    titleAr: (input.titleAr?.trim() || input.title.trim()).slice(0, 240),
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
    notes: (input.notes ?? "").slice(0, 2000),
    notesAr: (input.notesAr ?? input.notes ?? "").slice(0, 2000),
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };

  state.projects.unshift(projectRecord);
  state.workspace.revision += 1;
  state.workspace.updatedAt = ts;

  const createdFields = [
    "title",
    "clientName",
    "serviceType",
    "assignedEmployeeId",
    "deadline",
    "status",
    "priority",
    "estimatedWorkload",
  ];
  if (input.budget !== undefined) createdFields.push("budget");

  appendAuditEntry(state, uid, {
    action: "project_created",
    entityType: "project",
    entityId: projectRecord.id,
    previousVersion: 0,
    newVersion: 1,
    changedFields: createdFields,
    summary: `Created project ${projectRecord.id} (${projectRecord.title}) assigned to ${projectRecord.assignedEmployeeId}.`,
  });

  return {
    project: cloneProject(projectRecord),
    revision: state.workspace.revision,
  };
}

export function updateDevDemoProject(
  uid: string,
  projectId: string,
  patch: UpdateProjectPatch,
  expectedVersion: number
): { project: Project; revision: number } {
  const state = ensureState(uid);
  const idx = state.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) {
    throw new RepoError(404, "NOT_FOUND", `Project "${projectId}" was not found.`);
  }

  const existing = state.projects[idx];
  const currentVersion = existing.version ?? 1;
  if (currentVersion !== expectedVersion) {
    throw new RepoError(
      409,
      "VERSION_CONFLICT",
      `Project ${projectId} was modified concurrently (expected v${expectedVersion}, found v${currentVersion}).`
    );
  }

  if (patch.assignedEmployeeId) {
    const validEmpIds = new Set(state.employees.map((e) => e.id));
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
  const ts = nowISO();
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
    updatedAt: ts,
  };

  const changedFields: string[] = [];
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
  ).forEach((k) => {
    if (existing[k] !== updatedProject[k]) {
      changedFields.push(k);
    }
  });

  const isPureReassignment =
    changedFields.length === 1 && changedFields[0] === "assignedEmployeeId";

  state.projects[idx] = updatedProject;
  state.workspace.revision += 1;
  state.workspace.updatedAt = ts;

  const summary = isPureReassignment
    ? `Reassigned ${projectId} from ${existing.assignedEmployeeId} to ${updatedProject.assignedEmployeeId} (v${currentVersion} -> v${nextVersion}).`
    : `Updated ${projectId} (${changedFields.length > 0 ? changedFields.join(", ") : "lastUpdated"}) (v${currentVersion} -> v${nextVersion}).`;

  appendAuditEntry(state, uid, {
    action: isPureReassignment ? "project_reassigned" : "project_updated",
    entityType: "project",
    entityId: projectId,
    previousVersion: currentVersion,
    newVersion: nextVersion,
    changedFields: changedFields.length > 0 ? changedFields : ["lastUpdated"],
    summary,
  });

  return {
    project: cloneProject(updatedProject),
    revision: state.workspace.revision,
  };
}

export function deleteDevDemoProject(
  uid: string,
  projectId: string,
  expectedVersion?: number
): { deletedId: string; revision: number } {
  const state = ensureState(uid);
  const idx = state.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) {
    throw new RepoError(404, "NOT_FOUND", `Project "${projectId}" was not found.`);
  }

  const existing = state.projects[idx];
  const currentVersion = existing.version ?? 1;
  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new RepoError(
      409,
      "VERSION_CONFLICT",
      `Project ${projectId} changed concurrently before deletion.`
    );
  }

  const ts = nowISO();
  state.projects.splice(idx, 1);
  state.workspace.revision += 1;
  state.workspace.updatedAt = ts;

  appendAuditEntry(state, uid, {
    action: "project_deleted",
    entityType: "project",
    entityId: projectId,
    previousVersion: currentVersion,
    newVersion: 0,
    changedFields: ["deleted"],
    summary: `Deleted project ${projectId} (${existing.title}) at v${currentVersion}.`,
  });

  return {
    deletedId: projectId,
    revision: state.workspace.revision,
  };
}

export function resetDevDemoWorkspace(uid: string): WorkspaceSnapshotResponse {
  const state = ensureState(uid);
  const prevRev = state.workspace.revision;
  const nextRev = prevRev + 1;
  const ts = nowISO();

  state.projects = createInitialProjects().map((proj) => ({
    ...cloneProject(proj),
    ownerId: uid,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  }));
  state.workspace.revision = nextRev;
  state.workspace.seedOrigin = "reset";
  state.workspace.updatedAt = ts;
  state.auditLogs = [];

  seedHistoricalAudits(state, uid, state.projects.length, state.employees.length);

  appendAuditEntry(state, uid, {
    action: "workspace_reset",
    entityType: "workspace",
    entityId: uid,
    previousVersion: prevRev,
    newVersion: nextRev,
    changedFields: ["reset"],
    summary: `Reset public demo workspace to ${state.projects.length} baseline sample projects (revision ${prevRev} -> ${nextRev}).`,
  });

  return buildSnapshot(state);
}

export function getDevDemoAuditLogs(uid: string, limit = 50): AuditLogEntry[] {
  const state = ensureState(uid);
  const bounded = Math.max(1, Math.min(200, limit));
  return state.auditLogs.slice(0, bounded).map((entry) => ({
    ...entry,
    changedFields: [...entry.changedFields],
  }));
}
