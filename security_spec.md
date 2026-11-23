# OpsPilot AI Firestore Security Specification (Phase 0)

## 1. Data Invariants

1. **Identity & Email Verification**: Every read and write requires an authenticated Firebase user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`).
2. **Tenant Isolation**: Every document under `/workspaces/{userId}` and its subcollections (`employees`, `projects`, `auditLogs`) must belong strictly to `{userId}` (`ownerId == request.auth.uid && ownerId == userId`), enforced on `get`, `list`, `create`, `update`, and `delete`.
3. **Referential Integrity**: A `Project` cannot exist without a valid parent `Workspace` (`existsAfter(/workspaces/{userId})`) and an existing assigned `Employee` (`existsAfter(/workspaces/{userId}/employees/{assignedEmployeeId})`).
4. **Monotonic Version & Timestamp Integrity**:
   - `createdAt` is server-enforced (`request.time`) on creation and immutable thereafter (`incoming().createdAt == existing().createdAt`).
   - `updatedAt` is server-enforced (`request.time`) on create and update.
   - `version` starts at `1` on creation and strictly increments (`incoming().version == existing().version + 1`) on update.
5. **Immutable Audit Trail**: `auditLogs` entries can only be created with `actorId == request.auth.uid` and `createdAt == request.time`; updates and deletes on `auditLogs` are unconditionally denied (`allow update, delete: if false;`).
6. **PII Isolation**: No personal email addresses, phone numbers, or addresses are stored in workspace or project collections.
7. **Strict Schema & Size Guards**: Every document enforces exact `hasAll`/`hasOnly` keys, `isValidId()` regex (`^[a-zA-Z0-9_-]+$`, max 128 chars), strict string/number/list bounds, and no shadow fields.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Cross-Tenant Read/Write**: Authenticated User B attempting `get`/`list`/`create` under `/workspaces/{userA}`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempting `create` on `/workspaces/{uid}/projects/OP-9001`.
3. **Owner Spoofing**: Authenticated User A attempting to create `/workspaces/{userA}/projects/OP-9002` with `ownerId: userB`.
4. **Shadow / Ghost Field Injection**: Creating or updating a project with an extra key such as `isAdmin: true` or `shadowRole: "super"`.
5. **Immutable Timestamp Tampering**: Updating a project while altering `createdAt`, or forging `updatedAt` to a client-chosen timestamp instead of `request.time`.
6. **Version Downgrade / Skip**: Updating a project at `version: 2` with `version: 2` or `version: 5` instead of `3`.
7. **Orphaned Project Assignment**: Creating a project with `assignedEmployeeId: "EMP-NONEXISTENT"` where no matching employee document exists.
8. **Path ID Poisoning**: Attempting to create a project at `/workspaces/{uid}/projects/bad$id..with/junk` or >128-char ID.
9. **Audit Log Tampering / Deletion**: Attempting `update` or `delete` on `/workspaces/{uid}/auditLogs/{auditId}`.
10. **Actor Spoofing in Audit Log**: Creating an audit log entry with `actorId` different from `request.auth.uid`.
11. **Value Poisoning / Bounds Overflow**: Updating a project with `progress: 500`, `estimatedWorkload: -10`, `notes` > 2000 chars, or `skills` containing `"unauthorized_skill"`.
12. **Unfiltered List Query**: Attempting a `list` query on `/workspaces/{userA}/projects` without `where('ownerId', '==', request.auth.uid)`.
