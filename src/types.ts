export type Language = "en" | "ar";

export type NavSection =
  | "dashboard"
  | "projects"
  | "analyst"
  | "workload"
  | "performance"
  | "ask"
  | "opsgraph";

export type ProjectStatus =
  | "new"
  | "in_progress"
  | "under_review"
  | "completed"
  | "on_hold";

export type PriorityLevel = "low" | "medium" | "high" | "critical";

export type ServiceType =
  | "research_reports"
  | "presentations"
  | "graphic_design"
  | "website_development"
  | "business_services";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Employee {
  id: string;
  ownerId?: string;
  name: string;
  nameAr: string;
  role: string;
  roleAr: string;
  department?: string;
  departmentAr?: string;
  weeklyCapacityHours: number;
  skills: ServiceType[];
  skillsVerified: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  ownerId?: string;
  clientName: string;
  clientNameAr: string;
  serviceType: ServiceType;
  title: string;
  titleAr: string;
  assignedEmployeeId: string;
  startDate: string; // YYYY-MM-DD
  deadline: string; // YYYY-MM-DD
  completedDate?: string; // YYYY-MM-DD
  lastUpdated: string; // YYYY-MM-DD
  status: ProjectStatus;
  progress: number; // 0-100
  priority: PriorityLevel;
  estimatedWorkload: number; // hours
  budget?: number; // USD
  notes: string;
  notesAr: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type AuditAction =
  | "workspace_seeded"
  | "legacy_migrated"
  | "project_created"
  | "project_updated"
  | "project_reassigned"
  | "project_deleted"
  | "workspace_reset";

export interface AuditLogEntry {
  id: string;
  ownerId: string;
  action: AuditAction;
  entityType: "workspace" | "project" | "employee";
  entityId: string;
  actorId: string;
  previousVersion: number;
  newVersion: number;
  changedFields: string[];
  summary: string;
  createdAt: string;
}

export interface WorkspaceMetadata {
  ownerId: string;
  revision: number;
  legacyMigrated: boolean;
  seedOrigin: "seeded" | "migrated" | "reset";
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSnapshotResponse {
  initialized: boolean;
  workspace: WorkspaceMetadata | null;
  employees: Employee[];
  projects: Project[];
}

export type WorkspaceSyncState = "idle" | "loading" | "saving" | "ready" | "error" | "conflict";

export interface RiskSignal {
  code:
    | "overdue"
    | "deadline_lag"
    | "stale_update"
    | "missing_notes"
    | "overloaded_owner"
    | "on_hold_near_deadline"
    | "excessive_workload";
  detailEn: string;
  detailAr: string;
  points: number;
}

export interface ProjectRiskAssessment {
  project: Project;
  owner: Employee | undefined;
  riskScore: number; // 0-100
  riskLevel: RiskLevel;
  daysUntilDeadline: number;
  daysSinceUpdate: number;
  remainingWorkloadHours: number;
  signals: RiskSignal[];
  missingDataEn: string[];
  missingDataAr: string[];
  observationEn: string;
  observationAr: string;
  evidenceEn: string;
  evidenceAr: string;
  impactEn: string;
  impactAr: string;
  recommendedActionEn: string;
  recommendedActionAr: string;
}

export interface RebalanceSuggestion {
  projectId: string;
  projectTitle: string;
  projectTitleAr: string;
  fromEmployeeId: string;
  fromEmployeeName: string;
  fromEmployeeNameAr: string;
  toEmployeeId: string;
  toEmployeeName: string;
  toEmployeeNameAr: string;
  hoursMoved: number;
  skillMatch: boolean;
  requiresManagerVerification: boolean;
  reasonEn: string;
  reasonAr: string;
}

export interface EmployeeWorkloadSummary {
  employee: Employee;
  assignedProjects: Project[];
  activeProjectsCount: number;
  completedProjectsCount: number;
  overdueProjectsCount: number;
  activeWorkloadHours: number;
  utilizationPct: number;
  capacityStatus: "overloaded" | "optimal" | "available";
}

export interface MonthlyTrendPoint {
  monthKey: string;
  labelEn: string;
  labelAr: string;
  completedCount: number;
  onTimeCount: number;
  delayedCount: number;
  totalHours: number;
}

export interface OperationalMetrics {
  totalOrders: number;
  activeProjects: number;
  completedProjects: number;
  completedOnTimeCount: number;
  completedLateCount: number;
  overdueProjects: number;
  totalDelayedProjects: number;
  atRiskProjects: number;
  completionRate: number;
  onTimeCompletionRate: number;
  avgCompletionDays: number;
  totalPortfolioBudget: number;
  activePortfolioBudget: number;
  statusCounts: Record<ProjectStatus, number>;
  categoryCounts: Record<ServiceType, { total: number; delayed: number; completed: number }>;
  monthlyTrends: MonthlyTrendPoint[];
}

export interface DailyBriefResponse {
  overallStatus: string;
  mostUrgentIssue: string;
  attentionToday: Array<{
    projectId: string;
    projectTitle: string;
    reason: string;
    deadline: string;
  }>;
  workloadConcerns: string;
  recommendedPriorities: Array<{
    observation: string;
    evidence: string;
    impact: string;
    action: string;
  }>;
}

export interface AnalystAIResponse {
  executiveSummary: string;
  bottlenecksDetected: Array<{
    title: string;
    observation: string;
    evidence: string;
    impact: string;
    action: string;
  }>;
  rankedActions: Array<{
    priority: string;
    relatedProjectId: string;
    action: string;
    reason: string;
    expectedImpact: string;
  }>;
}

export interface PerformanceAIResponse {
  whatsImproving: Array<{ observation: string; evidence: string }>;
  whatsGettingWorse: Array<{ observation: string; evidence: string }>;
  delayPatterns: Array<{ pattern: string; evidence: string; impact: string }>;
  improvementActions: Array<{ action: string; evidence: string; expectedImpact: string }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export type AIRequestStatus = "idle" | "analyzing" | "success" | "error" | "canceled";

export type AIErrorKind =
  | "unauthorized"
  | "canceled"
  | "timeout"
  | "rate_limit"
  | "network"
  | "invalid_response"
  | "server";

export type AuthMode = "firebase_google" | "public_demo" | "unconfigured";

export interface AuthUserSummary {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

export interface AuthStatusInfo {
  authenticated: boolean;
  authMode: AuthMode;
  setupAllowed: boolean;
  publicDemoEnabled?: boolean;
  isPublicDemo?: boolean;
  devDemoAvailable?: boolean;
  isDevDemo?: boolean;
  expiresAt: number | null;
  user?: AuthUserSummary | null;
}

export interface AIRequestState<T> {
  status: AIRequestStatus;
  data: T | null;
  errorKind: AIErrorKind | null;
  errorMessage: string | null;
}

export type ThemeMode = "light" | "dark" | "system";

export interface AttentionItem {
  projectId: string;
  project: Project;
  ownerName: string;
  ownerNameAr: string;
  ownerUtilizationPct: number;
  riskScore: number;
  riskLevel: RiskLevel;
  priorityRankScore: number;
  daysUntilDeadline: number;
  remainingWorkloadHours: number;
  blockerEn: string;
  blockerAr: string;
  hasRecordedBlocker: boolean;
  whyItMattersEn: string;
  whyItMattersAr: string;
  recommendedActionEn: string;
  recommendedActionAr: string;
}

export interface ProactiveInsight {
  id: string;
  kind: "concentration" | "deadline_collision" | "capacity" | "blockers";
  severity: "critical" | "warning" | "info";
  titleEn: string;
  titleAr: string;
  detailEn: string;
  detailAr: string;
  evidenceEn: string;
  evidenceAr: string;
}

export interface OperationalIntelligenceReport {
  immediateAttention: AttentionItem[];
  proactiveInsights: ProactiveInsight[];
  overloadedOwnersSummaryEn: string;
  overloadedOwnersSummaryAr: string;
  capacityRebalanceNarrativeEn: string;
  capacityRebalanceNarrativeAr: string;
  deadlineCollisionCount7d: number;
  overdueTotalHours: number;
  unrecordedNotesCount: number;
}

export type OpsGraphNodeType =
  | "project"
  | "employee"
  | "customer"
  | "blocker"
  | "deadline"
  | "risk";

export type OpsGraphEdgeKind =
  | "owns"
  | "client_of"
  | "blocked_by"
  | "deadline_window"
  | "risk_exposure"
  | "related_project";

export type OpsGraphDateRange = "all" | "7d" | "14d" | "30d";

export interface OpsGraphFilters {
  types: Record<OpsGraphNodeType, boolean>;
  showDependencies: boolean;
  criticalOnly: boolean;
  overdueOnly: boolean;
  highUtilizationOnly: boolean;
  upcomingDeadlinesOnly: boolean;
  dateRange: OpsGraphDateRange;
  collapsedSecondary: boolean;
}

export interface OpsGraphNode {
  id: string;
  type: OpsGraphNodeType;
  labelEn: string;
  labelAr: string;
  subtitleEn: string;
  subtitleAr: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  x: number;
  y: number;
  projectId?: string;
  employeeId?: string;
  customerName?: string;
  riskScore?: number;
  riskLevel?: RiskLevel;
  utilizationPct?: number;
  affectedCount?: number;
  daysDelta?: number;
  deadlineState?: "overdue" | "due_soon" | "upcoming" | "completed";
  hasVisibilityGap?: boolean;
  priorityRank?: number;
  signalCount?: number;
  searchTokens: string;
}

export interface OpsGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: OpsGraphEdgeKind;
  labelEn: string;
  labelAr: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
}

export interface OpsGraphData {
  nodes: OpsGraphNode[];
  edges: OpsGraphEdge[];
  nodeMap: Map<string, OpsGraphNode>;
  adjacency: Map<string, Set<string>>;
  missingDataSummaryEn: string[];
  missingDataSummaryAr: string[];
}

export interface NodeImpactReport {
  nodeId: string;
  affectedProjects: Array<{
    project: Project;
    riskScore: number;
    riskLevel: RiskLevel;
    daysUntilDeadline: number;
    remainingHours: number;
    ownerName: string;
    ownerNameAr: string;
    blockerEn: string;
    blockerAr: string;
    hasRecordedBlocker: boolean;
  }>;
  totalRemainingHours: number;
  highOrCriticalCount: number;
  overdueCount: number;
  summaryEn: string;
  summaryAr: string;
  tracedNodeIds: Set<string>;
  tracedEdgeIds: Set<string>;
}

export interface GraphEntityInvestigationContext {
  investigationMode: boolean;
  nodeId: string;
  nodeType: OpsGraphNodeType;
  label: string;
  summary: string;
  severity: OpsGraphNode["severity"];
  confirmedEntityData: Record<string, unknown>;
  connectedRelationships: Array<{
    edgeKind: OpsGraphEdgeKind;
    relationshipLabel: string;
    targetNodeId: string;
    targetType: OpsGraphNodeType;
    targetLabel: string;
    targetSeverity: OpsGraphNode["severity"];
  }>;
  impactSummary?: string;
  impactMetrics: {
    affectedProjectsCount: number;
    highOrCriticalCount: number;
    overdueCount: number;
    totalRemainingHours: number;
  };
  affectedProjects: Array<{
    id: string;
    title: string;
    client: string;
    owner: string;
    deadline: string;
    daysUntilDeadline: number;
    progress: number;
    remainingHours: number;
    riskScore: number;
    riskLevel: RiskLevel;
    hasRecordedBlocker: boolean;
    blocker: string;
  }>;
  dependencies: string[];
  visibilityGaps: string[];
}

export interface WhatIfScenarioResult {
  projectId: string;
  projectTitle: string;
  projectTitleAr: string;
  fromEmployeeId: string;
  fromEmployeeName: string;
  fromEmployeeNameAr: string;
  toEmployeeId: string;
  toEmployeeName: string;
  toEmployeeNameAr: string;
  hoursMoved: number;
  skillMatch: boolean;
  before: {
    fromUtilizationPct: number;
    toUtilizationPct: number;
    projectRiskScore: number;
    projectRiskLevel: RiskLevel;
    fromHighRiskCount: number;
  };
  after: {
    fromUtilizationPct: number;
    toUtilizationPct: number;
    projectRiskScore: number;
    projectRiskLevel: RiskLevel;
    fromHighRiskCount: number;
  };
  affectedProjectIds: string[];
}
