import {
  createDevDemoProject,
  deleteDevDemoProject,
  getDevDemoAuditLogs,
  getDevDemoWorkspaceSnapshot,
  migrateOrSeedDevDemoWorkspace,
  resetDevDemoWorkspace,
  updateDevDemoProject,
} from "./devDemoStore.js";
import type { VerifiedFirebaseUser } from "./firebaseAuth.js";
import {
  type CreateProjectInput,
  createProjectInDb,
  deleteProjectInDb,
  getAuditLogsFromDb,
  getWorkspaceSnapshot,
  type LegacyProjectInput,
  migrateLegacyOrSeedWorkspace,
  RepoError,
  resetWorkspaceToDemoInDb,
  type UpdateProjectPatch,
  updateProjectInDb,
} from "./firestoreRepo.js";
import { type AuthCaller, isPublicDemoEnabled } from "./security.js";

function assertCallerCanUsePublicDemo(caller: AuthCaller): void {
  if (caller.isPublicDemo && !isPublicDemoEnabled()) {
    throw new RepoError(
      403,
      "PUBLIC_DEMO_DISABLED",
      "Public demo mode is disabled."
    );
  }
}

export async function getWorkspaceSnapshotForCaller(caller: AuthCaller) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return getDevDemoWorkspaceSnapshot(caller.uid);
  }
  return getWorkspaceSnapshot(caller as VerifiedFirebaseUser);
}

export async function migrateLegacyOrSeedForCaller(
  caller: AuthCaller,
  legacyProjects: LegacyProjectInput[]
) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return migrateOrSeedDevDemoWorkspace(caller.uid, legacyProjects);
  }
  return migrateLegacyOrSeedWorkspace(caller as VerifiedFirebaseUser, legacyProjects);
}

export async function resetWorkspaceToDemoForCaller(caller: AuthCaller) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return resetDevDemoWorkspace(caller.uid);
  }
  return resetWorkspaceToDemoInDb(caller as VerifiedFirebaseUser);
}

export async function createProjectForCaller(
  caller: AuthCaller,
  input: CreateProjectInput
) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return createDevDemoProject(caller.uid, input);
  }
  return createProjectInDb(caller as VerifiedFirebaseUser, input);
}

export async function updateProjectForCaller(
  caller: AuthCaller,
  projectId: string,
  patch: UpdateProjectPatch,
  expectedVersion: number
) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return updateDevDemoProject(caller.uid, projectId, patch, expectedVersion);
  }
  return updateProjectInDb(
    caller as VerifiedFirebaseUser,
    projectId,
    patch,
    expectedVersion
  );
}

export async function deleteProjectForCaller(
  caller: AuthCaller,
  projectId: string,
  expectedVersion?: number
) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return deleteDevDemoProject(caller.uid, projectId, expectedVersion);
  }
  return deleteProjectInDb(
    caller as VerifiedFirebaseUser,
    projectId,
    expectedVersion
  );
}

export async function getAuditLogsForCaller(caller: AuthCaller, limit = 50) {
  if (caller.isPublicDemo) {
    assertCallerCanUsePublicDemo(caller);
    return getDevDemoAuditLogs(caller.uid, limit);
  }
  return getAuditLogsFromDb(caller as VerifiedFirebaseUser, limit);
}
