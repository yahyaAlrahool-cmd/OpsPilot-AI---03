import {
  AuditLogEntry,
  Project,
  WorkspaceSnapshotResponse,
} from "../types";
import { safeParseJson } from "../utils/aiNormalizers";
import { notifyUnauthorized, resolveAuthHeaders } from "./aiService";

export class WorkspaceApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "WorkspaceApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function requestWorkspaceJson<T>(
  url: string,
  init: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  let authHeaders = await resolveAuthHeaders(false);
  const makeRequest = (headers: Record<string, string>) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...headers,
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  let res = await makeRequest(authHeaders);

  if (res.status === 401) {
    const refreshedHeaders = await resolveAuthHeaders(true);
    if (
      refreshedHeaders.Authorization &&
      refreshedHeaders.Authorization !== authHeaders.Authorization
    ) {
      authHeaders = refreshedHeaders;
      res = await makeRequest(authHeaders);
    }
  }

  const rawText = await res.text();
  const parsed = safeParseJson(rawText);
  const bodyObj =
    parsed.ok && typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : null;

  if (!res.ok) {
    const errMsg =
      typeof bodyObj?.error === "string"
        ? bodyObj.error
        : `Workspace request failed (${res.status})`;
    const errCode =
      typeof bodyObj?.code === "string"
        ? bodyObj.code
        : res.status === 401
        ? "AUTH_REQUIRED"
        : res.status === 409
        ? "VERSION_CONFLICT"
        : "WORKSPACE_ERROR";

    if (res.status === 401) {
      notifyUnauthorized();
    }

    throw new WorkspaceApiError(res.status, errCode, errMsg);
  }

  if (!parsed.ok || parsed.data === null) {
    throw new WorkspaceApiError(502, "INVALID_RESPONSE", "Invalid JSON returned from workspace API.");
  }

  return parsed.data as T;
}

export function fetchWorkspaceApi(signal?: AbortSignal): Promise<WorkspaceSnapshotResponse> {
  return requestWorkspaceJson<WorkspaceSnapshotResponse>("/api/workspace", {
    method: "GET",
    signal,
  });
}

export interface MigrateLegacyResponse {
  snapshot: WorkspaceSnapshotResponse;
  migratedCount: number;
  skippedDuplicates: number;
  seeded: boolean;
}

export function migrateLegacyWorkspaceApi(
  projects: Project[]
): Promise<MigrateLegacyResponse> {
  // Strip client/server metadata fields to satisfy strict server validation
  const sanitizedProjects = projects.map((p) => ({
    id: p.id,
    clientName: p.clientName,
    clientNameAr: p.clientNameAr,
    serviceType: p.serviceType,
    title: p.title,
    titleAr: p.titleAr,
    assignedEmployeeId: p.assignedEmployeeId,
    startDate: p.startDate,
    deadline: p.deadline,
    ...(p.completedDate ? { completedDate: p.completedDate } : {}),
    lastUpdated: p.lastUpdated,
    status: p.status,
    progress: p.progress,
    priority: p.priority,
    estimatedWorkload: p.estimatedWorkload,
    ...(typeof p.budget === "number" ? { budget: p.budget } : {}),
    notes: p.notes,
    notesAr: p.notesAr,
  }));

  return requestWorkspaceJson<MigrateLegacyResponse>("/api/workspace/migrate-legacy", {
    method: "POST",
    body: JSON.stringify({ projects: sanitizedProjects }),
  });
}

export type CreateProjectPayload = Omit<
  Project,
  "id" | "lastUpdated" | "ownerId" | "version" | "createdAt" | "updatedAt"
> & { id?: string };

export function createProjectApi(
  project: CreateProjectPayload
): Promise<{ project: Project; revision: number }> {
  const payload: Record<string, unknown> = {
    ...(project.id ? { id: project.id } : {}),
    clientName: project.clientName,
    clientNameAr: project.clientNameAr,
    serviceType: project.serviceType,
    title: project.title,
    titleAr: project.titleAr,
    assignedEmployeeId: project.assignedEmployeeId,
    startDate: project.startDate,
    deadline: project.deadline,
    ...(project.completedDate ? { completedDate: project.completedDate } : {}),
    status: project.status,
    progress: project.progress,
    priority: project.priority,
    estimatedWorkload: project.estimatedWorkload,
    ...(typeof project.budget === "number" ? { budget: project.budget } : {}),
    notes: project.notes,
    notesAr: project.notesAr,
  };

  return requestWorkspaceJson<{ project: Project; revision: number }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProjectApi(
  id: string,
  patch: Partial<Project>,
  expectedVersion: number
): Promise<{ project: Project; revision: number }> {
  const allowedPatch: Record<string, unknown> = {};
  const keys = [
    "clientName",
    "clientNameAr",
    "serviceType",
    "title",
    "titleAr",
    "assignedEmployeeId",
    "startDate",
    "deadline",
    "status",
    "progress",
    "priority",
    "estimatedWorkload",
    "budget",
    "notes",
    "notesAr",
  ] as const;

  for (const key of keys) {
    if (key in patch && patch[key] !== undefined) {
      allowedPatch[key] = patch[key];
    }
  }

  if ("completedDate" in patch) {
    allowedPatch.completedDate = patch.completedDate ?? null;
  }

  return requestWorkspaceJson<{ project: Project; revision: number }>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion,
        patch: allowedPatch,
      }),
    }
  );
}

export function deleteProjectApi(
  id: string,
  expectedVersion?: number
): Promise<{ deletedId: string; revision: number }> {
  return requestWorkspaceJson<{ deletedId: string; revision: number }>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      body: JSON.stringify(
        typeof expectedVersion === "number" ? { expectedVersion } : {}
      ),
    }
  );
}

export function resetWorkspaceToDemoApi(): Promise<WorkspaceSnapshotResponse> {
  return requestWorkspaceJson<WorkspaceSnapshotResponse>("/api/workspace/reset-demo", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchAuditLogsApi(
  limit = 60,
  signal?: AbortSignal
): Promise<AuditLogEntry[]> {
  const res = await requestWorkspaceJson<{ entries: AuditLogEntry[] }>(
    `/api/audit?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      signal,
    }
  );
  return Array.isArray(res.entries) ? res.entries : [];
}
