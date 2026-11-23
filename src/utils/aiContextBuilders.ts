import type {
  Employee,
  EmployeeWorkloadSummary,
  Language,
  OperationalIntelligenceReport,
  OperationalMetrics,
  Project,
  ProjectRiskAssessment,
  RebalanceSuggestion,
} from "../types.js";
import { getTodayISO } from "./analytics.js";

function truncateNote(text: string, maxLen = 120): string {
  const clean = text.trim();
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

export interface CompactPerformanceContext {
  currentDate: string;
  metrics: OperationalMetrics;
  teamUtilization: Array<{
    name: string;
    utilizationPct: number;
    capacityStatus: string;
    overdueProjectsCount: number;
  }>;
  delayedProjects: Array<{
    id: string;
    title: string;
    serviceType: string;
    owner: string;
    status: string;
    deadline: string;
    completedDate?: string;
    progress: number;
    note?: string;
  }>;
  operationalPatterns?: Array<{ title: string; detail: string; evidence: string }>;
}

export interface CompactDailyBriefContext {
  currentDate: string;
  metrics: {
    totalOrders: number;
    activeProjects: number;
    completedProjects: number;
    overdueProjects: number;
    atRiskProjects: number;
    completionRate: number;
    onTimeCompletionRate: number;
  };
  priorityProjects: Array<{
    id: string;
    title: string;
    client: string;
    owner: string;
    status: string;
    deadline: string;
    progress: number;
    remainingHours: number;
    riskScore: number;
    riskLevel: string;
    daysUntilDeadline: number;
    signals: string[];
    note?: string;
  }>;
  teamWorkload: Array<{
    name: string;
    utilizationPct: number;
    capacityStatus: string;
    activeProjectsCount: number;
    overdueProjectsCount: number;
  }>;
  operationalPatterns?: Array<{ title: string; detail: string; evidence: string }>;
}

export interface CompactAnalystContext {
  currentDate: string;
  metrics: {
    totalOrders: number;
    activeProjects: number;
    overdueProjects: number;
    atRiskProjects: number;
    completionRate: number;
  };
  riskAssessments: Array<{
    projectId: string;
    title: string;
    owner: string;
    status: string;
    deadline: string;
    progress: number;
    riskScore: number;
    riskLevel: string;
    daysUntilDeadline: number;
    daysSinceUpdate: number;
    remainingHours: number;
    signals: string[];
    missingData: string[];
    note?: string;
  }>;
  teamWorkload: Array<{
    name: string;
    weeklyCapacityHours: number;
    activeWorkloadHours: number;
    utilizationPct: number;
    capacityStatus: string;
    skills: string[];
    skillsVerified: boolean;
    overdueProjectsCount: number;
  }>;
  rebalanceCandidates: Array<{
    projectId: string;
    from: string;
    to: string;
    hoursMoved: number;
    skillMatch: boolean;
    requiresManagerVerification: boolean;
  }>;
  operationalPatterns?: Array<{ title: string; detail: string; evidence: string }>;
}

function compactPatterns(
  intelligence: OperationalIntelligenceReport | undefined,
  language: Language
) {
  if (!intelligence) return undefined;
  return intelligence.proactiveInsights.map((p) => ({
    title: language === "ar" ? p.titleAr : p.titleEn,
    detail: language === "ar" ? p.detailAr : p.detailEn,
    evidence: language === "ar" ? p.evidenceAr : p.evidenceEn,
  }));
}

export function buildPerformanceContext(
  projects: Project[],
  employees: Employee[],
  metrics: OperationalMetrics,
  workloads: EmployeeWorkloadSummary[],
  language: Language,
  intelligence?: OperationalIntelligenceReport
): CompactPerformanceContext {
  const todayISO = getTodayISO();
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const delayedProjects = projects
    .filter((p) => {
      if (p.status === "completed") {
        const doneDate = p.completedDate ?? p.lastUpdated;
        return doneDate > p.deadline;
      }
      return p.deadline < todayISO;
    })
    .map((p) => {
      const emp = empMap.get(p.assignedEmployeeId);
      const rawNote = language === "ar" ? p.notesAr || p.notes : p.notes;
      return {
        id: p.id,
        title: language === "ar" ? p.titleAr || p.title : p.title,
        serviceType: p.serviceType,
        owner: emp
          ? language === "ar"
            ? emp.nameAr
            : emp.name
          : language === "ar"
            ? "غير مسند"
            : "Unassigned",
        status: p.status,
        deadline: p.deadline,
        completedDate: p.completedDate,
        progress: p.progress,
        note: truncateNote(rawNote, 120) || undefined,
      };
    });

  return {
    currentDate: todayISO,
    metrics,
    teamUtilization: workloads.map((w) => ({
      name: language === "ar" ? w.employee.nameAr : w.employee.name,
      utilizationPct: w.utilizationPct,
      capacityStatus: w.capacityStatus,
      overdueProjectsCount: w.overdueProjectsCount,
    })),
    delayedProjects,
    operationalPatterns: compactPatterns(intelligence, language),
  };
}

export function buildDailyBriefContext(
  employees: Employee[],
  metrics: OperationalMetrics,
  risks: ProjectRiskAssessment[],
  workloads: EmployeeWorkloadSummary[],
  language: Language,
  intelligence?: OperationalIntelligenceReport
): CompactDailyBriefContext {
  const empMap = new Map(employees.map((e) => [e.id, e]));

  return {
    currentDate: getTodayISO(),
    metrics: {
      totalOrders: metrics.totalOrders,
      activeProjects: metrics.activeProjects,
      completedProjects: metrics.completedProjects,
      overdueProjects: metrics.overdueProjects,
      atRiskProjects: metrics.atRiskProjects,
      completionRate: metrics.completionRate,
      onTimeCompletionRate: metrics.onTimeCompletionRate,
    },
    priorityProjects: risks.slice(0, 8).map((r) => {
      const emp = empMap.get(r.project.assignedEmployeeId);
      const rawNote = language === "ar" ? r.project.notesAr || r.project.notes : r.project.notes;
      return {
        id: r.project.id,
        title: language === "ar" ? r.project.titleAr || r.project.title : r.project.title,
        client:
          language === "ar"
            ? r.project.clientNameAr || r.project.clientName
            : r.project.clientName,
        owner: emp
          ? language === "ar"
            ? emp.nameAr
            : emp.name
          : language === "ar"
            ? "غير مسند"
            : "Unassigned",
        status: r.project.status,
        deadline: r.project.deadline,
        progress: r.project.progress,
        remainingHours: r.remainingWorkloadHours,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        daysUntilDeadline: r.daysUntilDeadline,
        signals: r.signals.slice(0, 3).map((s) => (language === "ar" ? s.detailAr : s.detailEn)),
        note: truncateNote(rawNote, 100) || undefined,
      };
    }),
    teamWorkload: workloads.map((w) => ({
      name: language === "ar" ? w.employee.nameAr : w.employee.name,
      utilizationPct: w.utilizationPct,
      capacityStatus: w.capacityStatus,
      activeProjectsCount: w.activeProjectsCount,
      overdueProjectsCount: w.overdueProjectsCount,
    })),
    operationalPatterns: compactPatterns(intelligence, language),
  };
}

export function buildAnalystContext(
  employees: Employee[],
  metrics: OperationalMetrics,
  risks: ProjectRiskAssessment[],
  workloads: EmployeeWorkloadSummary[],
  rebalanceCandidates: RebalanceSuggestion[],
  language: Language,
  intelligence?: OperationalIntelligenceReport
): CompactAnalystContext {
  const empMap = new Map(employees.map((e) => [e.id, e]));

  return {
    currentDate: getTodayISO(),
    metrics: {
      totalOrders: metrics.totalOrders,
      activeProjects: metrics.activeProjects,
      overdueProjects: metrics.overdueProjects,
      atRiskProjects: metrics.atRiskProjects,
      completionRate: metrics.completionRate,
    },
    riskAssessments: risks.map((r) => {
      const emp = empMap.get(r.project.assignedEmployeeId);
      const rawNote = language === "ar" ? r.project.notesAr || r.project.notes : r.project.notes;
      return {
        projectId: r.project.id,
        title: language === "ar" ? r.project.titleAr || r.project.title : r.project.title,
        owner: emp
          ? language === "ar"
            ? emp.nameAr
            : emp.name
          : language === "ar"
            ? "غير مسند"
            : "Unassigned",
        status: r.project.status,
        deadline: r.project.deadline,
        progress: r.project.progress,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        daysUntilDeadline: r.daysUntilDeadline,
        daysSinceUpdate: r.daysSinceUpdate,
        remainingHours: r.remainingWorkloadHours,
        signals: r.signals.map((s) => (language === "ar" ? s.detailAr : s.detailEn)),
        missingData: language === "ar" ? r.missingDataAr : r.missingDataEn,
        note: truncateNote(rawNote, 100) || undefined,
      };
    }),
    teamWorkload: workloads.map((w) => ({
      name: language === "ar" ? w.employee.nameAr : w.employee.name,
      weeklyCapacityHours: w.employee.weeklyCapacityHours,
      activeWorkloadHours: w.activeWorkloadHours,
      utilizationPct: w.utilizationPct,
      capacityStatus: w.capacityStatus,
      skills: w.employee.skills,
      skillsVerified: w.employee.skillsVerified,
      overdueProjectsCount: w.overdueProjectsCount,
    })),
    rebalanceCandidates: rebalanceCandidates.map((r) => ({
      projectId: r.projectId,
      from: language === "ar" ? r.fromEmployeeNameAr : r.fromEmployeeName,
      to: language === "ar" ? r.toEmployeeNameAr : r.toEmployeeName,
      hoursMoved: r.hoursMoved,
      skillMatch: r.skillMatch,
      requiresManagerVerification: r.requiresManagerVerification,
    })),
    operationalPatterns: compactPatterns(intelligence, language),
  };
}
