/**
 * Security Rule Adversarial Test Suite Specification ("Dirty Dozen")
 * Maps each adversarial payload from security_spec.md to the exact rule gate in firestore.rules
 * that enforces PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  targetPath: string;
  operation: "get" | "list" | "create" | "update" | "delete";
  actor: { uid: string; emailVerified: boolean };
  payload?: Record<string, unknown>;
  expectedOutcome: "PERMISSION_DENIED";
  enforcedBy: string;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: "Cross-tenant project read",
    targetPath: "/workspaces/userA/projects/OP-1041",
    operation: "get",
    actor: { uid: "userB", emailVerified: true },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isVerifiedOwner(userId) checks request.auth.uid == userId",
  },
  {
    id: 2,
    name: "Unverified email project creation",
    targetPath: "/workspaces/userA/projects/OP-9001",
    operation: "create",
    actor: { uid: "userA", emailVerified: false },
    payload: { id: "OP-9001", ownerId: "userA", version: 1 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isVerifiedUser() requires request.auth.token.email_verified == true",
  },
  {
    id: 3,
    name: "Owner spoofing on project creation",
    targetPath: "/workspaces/userA/projects/OP-9002",
    operation: "create",
    actor: { uid: "userA", emailVerified: true },
    payload: { id: "OP-9002", ownerId: "userB", version: 1 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isValidProject() checks data.ownerId == request.auth.uid && data.ownerId == userId",
  },
  {
    id: 4,
    name: "Shadow / ghost field injection",
    targetPath: "/workspaces/userA/projects/OP-9003",
    operation: "create",
    actor: { uid: "userA", emailVerified: true },
    payload: { id: "OP-9003", ownerId: "userA", isAdmin: true, version: 1 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isValidProject() enforces strict keys().hasOnly([...])",
  },
  {
    id: 5,
    name: "Immutable createdAt tampering on update",
    targetPath: "/workspaces/userA/projects/OP-1041",
    operation: "update",
    actor: { uid: "userA", emailVerified: true },
    payload: { createdAt: "2020-01-01T00:00:00Z", version: 2 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "allow update enforces incoming().createdAt == existing().createdAt && affectedKeys().hasOnly(...)",
  },
  {
    id: 6,
    name: "Version downgrade or skip on update",
    targetPath: "/workspaces/userA/projects/OP-1041",
    operation: "update",
    actor: { uid: "userA", emailVerified: true },
    payload: { version: 99 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "allow update enforces incoming().version == existing().version + 1",
  },
  {
    id: 7,
    name: "Orphaned project assignment to non-existent employee",
    targetPath: "/workspaces/userA/projects/OP-9004",
    operation: "create",
    actor: { uid: "userA", emailVerified: true },
    payload: { id: "OP-9004", ownerId: "userA", assignedEmployeeId: "EMP-FAKE", version: 1 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "allow create enforces existsAfter(.../employees/$(incoming().assignedEmployeeId))",
  },
  {
    id: 8,
    name: "Path variable ID poisoning",
    targetPath: "/workspaces/userA/projects/bad$id..junk",
    operation: "create",
    actor: { uid: "userA", emailVerified: true },
    payload: { id: "bad$id..junk", ownerId: "userA", version: 1 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isValidId(projectId) enforces ^[a-zA-Z0-9_\\-]+$ and <= 128 chars",
  },
  {
    id: 9,
    name: "Audit log modification or deletion",
    targetPath: "/workspaces/userA/auditLogs/AUD-001",
    operation: "delete",
    actor: { uid: "userA", emailVerified: true },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "auditLogs enforces allow update, delete: if false;",
  },
  {
    id: 10,
    name: "Audit log actorId spoofing",
    targetPath: "/workspaces/userA/auditLogs/AUD-002",
    operation: "create",
    actor: { uid: "userA", emailVerified: true },
    payload: { id: "AUD-002", ownerId: "userA", actorId: "userB" },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isValidAuditLog() enforces data.actorId == request.auth.uid",
  },
  {
    id: 11,
    name: "Value poisoning (progress > 100 / notes > 2000)",
    targetPath: "/workspaces/userA/projects/OP-1041",
    operation: "update",
    actor: { uid: "userA", emailVerified: true },
    payload: { progress: 500, notes: "x".repeat(2500), version: 2 },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "isValidProject() enforces progress <= 100 and notes.size() <= 2000",
  },
  {
    id: 12,
    name: "Unfiltered collection list without ownerId constraint",
    targetPath: "/workspaces/userA/projects",
    operation: "list",
    actor: { uid: "userB", emailVerified: true },
    expectedOutcome: "PERMISSION_DENIED",
    enforcedBy: "allow list enforces isVerifiedOwner(userId) && resource.data.ownerId == request.auth.uid",
  },
];
