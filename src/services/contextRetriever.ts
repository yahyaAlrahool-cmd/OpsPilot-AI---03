import {
  Employee,
  EmployeeWorkloadSummary,
  Language,
  OperationalIntelligenceReport,
  OperationalMetrics,
  Project,
  ProjectRiskAssessment,
  RebalanceSuggestion,
} from "../types.js";
import { calcRemainingHours, getTodayISO, METRIC_FORMULAS } from "../utils/analytics.js";

export type ChatIntent =
  | "greeting"
  | "workload"
  | "risk_overdue"
  | "performance"
  | "projects_lookup"
  | "complex_analysis";

export interface WorkspaceSnapshot {
  projects: Project[];
  employees: Employee[];
  metrics: OperationalMetrics;
  risks: ProjectRiskAssessment[];
  workloads: EmployeeWorkloadSummary[];
  rebalanceSuggestions: RebalanceSuggestion[];
  intelligence?: OperationalIntelligenceReport;
  signature: string;
}

export interface TargetedContextResult {
  intent: ChatIntent;
  context: Record<string, unknown> | null;
  contextPrepMs: number;
  contextBytes: number;
  cacheHit: boolean;
}

const OPERATIONAL_KEYWORD_RE =
  /\b(project|projects|order|orders|risk|risks|overdue|late|delay|delayed|delays|blocker|blockers|workload|overload|overloaded|capacity|utilization|hours|team|employee|employees|staff|rebalance|reassign|completion|on-time|on time|metric|metrics|kpi|performance|trend|trends|deadline|deadlines|status|client|clients|priority|prioritize|focus|brief|summary|analysis|analyze|audit|follow-up|followup|draft|op-\d+)\b|(مشاريع|مشروع|طلب|طلبات|خطر|مخاطر|متأخر|متأخرة|تأخير|عوائق|عبء|أعباء|ضغط|طاقة|سعة|إشغال|ساعات|فريق|موظف|توزيع|إنجاز|أداء|مؤشر|مؤشرات|موعد|مواعيد|حالة|عميل|عملاء|أولوية|أولويات|تركيز|ملخص|تحليل|متابعة)/i;

const GREETING_RE =
  /^\s*(hello|hi|hey|good morning|good afternoon|good evening|greetings|howdy|yo|thanks|thank you|can you respond|are you there|can you hear me|test|ping|مرحبا|أهلا|اهلا|السلام عليكم|صباح الخير|مساء الخير|كيف حالك|شكرا|شكراً|هل تستطيع الرد|هل أنت هنا|تجربة)[\s!?.،؟]*$/i;

const COMPLEX_RE =
  /\b(complete operational analysis|full operational|executive summary|summary of today|overall operations|comprehensive|all bottlenecks|full review|everything|entire workspace|whole workspace|full workspace)\b|(تحليل تشغيلي كامل|تحليل كامل|ملخص شامل|ملخص لعمليات اليوم|الوضع العام|نظرة شاملة|مساحة العمل بالكامل)/i;

const WORKLOAD_RE =
  /\b(overload|overloaded|workload|capacity|utilization|busy|available|bandwidth|rebalance|reassign|allocation|hours|who is working|team load|tariq|nadia|omar|lina|kareem|layla|rami)\b|(ضغط|عبء|أعباء|طاقة|سعة|إشغال|مزدحم|متاح|إعادة توزيع|إسناد|ساعات|طارق|نادية|عمر|لينا|كريم|ليلى|رامي)/i;

const RISK_OVERDUE_RE =
  /\b(risk|risks|at-risk|at risk|overdue|late|delay|delayed|delays|blocker|blockers|bottleneck|bottlenecks|urgent|priority|priorities|prioritize|deadline|deadlines|focus today|this week|highest risk|follow-up|followup|follow up|stalled|on hold|trace impact|affected projects|why does this matter|op-\d+)\b|(خطر|مخاطرة|مخاطر|متأخر|متأخرة|تأخير|عائق|عوائق|اختناق|عاجل|أولوية|أولويات|موعد|مواعيد|تركيز|هذا الأسبوع|متابعة|معلق|تتبع الأثر|المشاريع المتأثرة)/i;

const PERFORMANCE_RE =
  /\b(on-time|on time|completion rate|avg completion|average completion|performance|kpi|kpis|trend|trends|category|categories|improving|worse|getting worse|delivery rate|historical|monthly)\b|(في الوقت المحدد|معدل الإنجاز|متوسط مدة|الأداء|مؤشر|مؤشرات|اتجاه|اتجاهات|فئة|تحسين|يتحسن|يتراجع|شهري)/i;

const PROJECTS_LOOKUP_RE =
  /\b(list projects|all projects|which clients|client|clients|show orders|status of|how many orders|total orders|budget)\b|(قائمة المشاريع|كل المشاريع|العملاء|حالة المشروع|حالة المشاريع|ما هي المشاريع|إجمالي الطلبات|الميزانية)/i;

export function classifyChatIntent(
  latestUserMessage: string,
  previousUserMessages: string[] = []
): ChatIntent {
  const text = latestUserMessage.trim();
  if (!text) return "greeting";

  // 1. Strict fast-path for greetings & connectivity checks with no operational terms
  if (!OPERATIONAL_KEYWORD_RE.test(text) && (GREETING_RE.test(text) || text.length <= 24 && /^(hi|hello|hey|ok|okay|yes|no|مرحبا|أهلا)/i.test(text))) {
    return "greeting";
  }

  // 2. Explicit complex/executive review requests or multi-domain questions
  if (COMPLEX_RE.test(text)) {
    return "complex_analysis";
  }

  const hitsWorkload = WORKLOAD_RE.test(text);
  const hitsRisk = RISK_OVERDUE_RE.test(text);
  const hitsPerf = PERFORMANCE_RE.test(text);
  const hitsLookup = PROJECTS_LOOKUP_RE.test(text);

  const domainHits = [hitsWorkload, hitsRisk, hitsPerf].filter(Boolean).length;
  if (domainHits >= 2) {
    return "complex_analysis";
  }

  if (hitsWorkload) return "workload";
  if (hitsRisk) return "risk_overdue";
  if (hitsPerf) return "performance";
  if (hitsLookup) return "projects_lookup";

  // 3. Follow-up turn without explicit domain keywords: inherit last operational user intent
  for (let i = previousUserMessages.length - 1; i >= 0; i--) {
    const prev = previousUserMessages[i];
    if (OPERATIONAL_KEYWORD_RE.test(prev)) {
      const inherited = classifyChatIntent(prev, []);
      if (inherited !== "greeting") return inherited;
    }
  }

  // Default safe minimal operational summary
  return "complex_analysis";
}

// Memoized cache keyed by intent + language + workspace signature
const CONTEXT_CACHE = new Map<string, { context: Record<string, unknown>; bytes: number }>();
const MAX_CACHE_ENTRIES = 40;

function cacheSet(key: string, value: { context: Record<string, unknown>; bytes: number }) {
  if (CONTEXT_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = CONTEXT_CACHE.keys().next().value;
    if (oldestKey) CONTEXT_CACHE.delete(oldestKey);
  }
  CONTEXT_CACHE.set(key, value);
}

export function clearContextCache() {
  CONTEXT_CACHE.clear();
}

export function buildTargetedChatContext(
  intent: ChatIntent,
  workspace: WorkspaceSnapshot,
  language: Language
): TargetedContextResult {
  const t0 = performance.now();

  if (intent === "greeting") {
    return {
      intent,
      context: null,
      contextPrepMs: +(performance.now() - t0).toFixed(2),
      contextBytes: 0,
      cacheHit: false,
    };
  }

  const cacheKey = `${intent}::${language}::${workspace.signature}`;
  const cached = CONTEXT_CACHE.get(cacheKey);
  if (cached) {
    return {
      intent,
      context: cached.context,
      contextPrepMs: +(performance.now() - t0).toFixed(2),
      contextBytes: cached.bytes,
      cacheHit: true,
    };
  }

  const todayISO = getTodayISO();
  const formulas = METRIC_FORMULAS[language];
  const empMap = new Map(workspace.employees.map((e) => [e.id, e]));
  const ownerLabel = (empId: string) => {
    const e = empMap.get(empId);
    return e ? (language === "ar" ? e.nameAr : e.name) : (language === "ar" ? "غير مسند" : "Unassigned");
  };

  let context: Record<string, unknown>;

  if (intent === "workload") {
    context = {
      currentDate: todayISO,
      formulas: {
        utilizationPct: formulas.utilizationPct,
        remainingWorkloadHours: formulas.remainingWorkloadHours,
      },
      teamWorkload: workspace.workloads.map((w) => ({
        id: w.employee.id,
        name: language === "ar" ? w.employee.nameAr : w.employee.name,
        role: language === "ar" ? w.employee.roleAr : w.employee.role,
        department: language === "ar" ? w.employee.departmentAr ?? w.employee.department : w.employee.department,
        weeklyCapacityHours: w.employee.weeklyCapacityHours,
        activeWorkloadHours: w.activeWorkloadHours,
        utilizationPct: w.utilizationPct,
        capacityStatus: w.capacityStatus,
        activeProjectsCount: w.activeProjectsCount,
        overdueProjectsCount: w.overdueProjectsCount,
        skills: w.employee.skills,
        skillsVerified: w.employee.skillsVerified,
        activeProjects: w.assignedProjects
          .filter((p) => p.status !== "completed")
          .map((p) => ({
            id: p.id,
            title: language === "ar" ? p.titleAr || p.title : p.title,
            deadline: p.deadline,
            status: p.status,
            progress: p.progress,
            remainingHours: calcRemainingHours(p),
          })),
      })),
      rebalanceCandidates: workspace.rebalanceSuggestions.map((r) => ({
        projectId: r.projectId,
        from: language === "ar" ? r.fromEmployeeNameAr : r.fromEmployeeName,
        to: language === "ar" ? r.toEmployeeNameAr : r.toEmployeeName,
        hoursMoved: r.hoursMoved,
        skillMatch: r.skillMatch,
        requiresManagerVerification: r.requiresManagerVerification,
      })),
      capacityNarrative: workspace.intelligence
        ? language === "ar"
          ? workspace.intelligence.capacityRebalanceNarrativeAr
          : workspace.intelligence.capacityRebalanceNarrativeEn
        : undefined,
    };
  } else if (intent === "risk_overdue") {
    context = {
      currentDate: todayISO,
      formulas: {
        overdueProjects: formulas.overdueProjects,
        atRiskProjects: formulas.atRiskProjects,
      },
      summaryCounts: {
        activeProjects: workspace.metrics.activeProjects,
        overdueProjects: workspace.metrics.overdueProjects,
        atRiskProjects: workspace.metrics.atRiskProjects,
        deadlineCollisionCount7d: workspace.intelligence?.deadlineCollisionCount7d,
        overdueTotalHours: workspace.intelligence?.overdueTotalHours,
      },
      operationalPatterns: workspace.intelligence?.proactiveInsights.map((p) => ({
        title: language === "ar" ? p.titleAr : p.titleEn,
        detail: language === "ar" ? p.detailAr : p.detailEn,
        evidence: language === "ar" ? p.evidenceAr : p.evidenceEn,
      })),
      activeRisks: workspace.risks.map((r) => ({
        id: r.project.id,
        title: language === "ar" ? r.project.titleAr || r.project.title : r.project.title,
        client: language === "ar" ? r.project.clientNameAr || r.project.clientName : r.project.clientName,
        owner: ownerLabel(r.project.assignedEmployeeId),
        status: r.project.status,
        priority: r.project.priority,
        progress: r.project.progress,
        deadline: r.project.deadline,
        daysUntilDeadline: r.daysUntilDeadline,
        daysSinceUpdate: r.daysSinceUpdate,
        remainingHours: r.remainingWorkloadHours,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        signals: r.signals.map((s) => (language === "ar" ? s.detailAr : s.detailEn)),
        notes:
          (language === "ar" ? r.project.notesAr || r.project.notes : r.project.notes) ||
          (language === "ar" ? "[لا توجد ملاحظات مسجلة]" : "[No notes recorded]"),
      })),
    };
  } else if (intent === "performance") {
    const completedLate = workspace.projects
      .filter((p) => p.status === "completed")
      .map((p) => ({
        id: p.id,
        title: language === "ar" ? p.titleAr || p.title : p.title,
        serviceType: p.serviceType,
        deadline: p.deadline,
        completedDate: p.completedDate ?? p.lastUpdated,
        notes: language === "ar" ? p.notesAr || p.notes : p.notes,
      }));
    const activeOverdue = workspace.projects
      .filter((p) => p.status !== "completed" && p.deadline < todayISO)
      .map((p) => ({
        id: p.id,
        title: language === "ar" ? p.titleAr || p.title : p.title,
        deadline: p.deadline,
        progress: p.progress,
        notes:
          (language === "ar" ? p.notesAr || p.notes : p.notes) ||
          (language === "ar" ? "[لا توجد ملاحظات مسجلة]" : "[No notes recorded]"),
      }));

    context = {
      currentDate: todayISO,
      formulas: {
        completionRate: formulas.completionRate,
        onTimeCompletionRate: formulas.onTimeCompletionRate,
        totalDelayedProjects: formulas.totalDelayedProjects,
      },
      metrics: workspace.metrics,
      completedProjectsRecord: completedLate,
      activeOverdueProjects: activeOverdue,
    };
  } else if (intent === "projects_lookup") {
    context = {
      currentDate: todayISO,
      counts: {
        totalOrders: workspace.metrics.totalOrders,
        activeProjects: workspace.metrics.activeProjects,
        completedProjects: workspace.metrics.completedProjects,
        overdueProjects: workspace.metrics.overdueProjects,
        totalPortfolioBudgetUSD: workspace.metrics.totalPortfolioBudget,
        activePortfolioBudgetUSD: workspace.metrics.activePortfolioBudget,
        statusCounts: workspace.metrics.statusCounts,
      },
      projects: workspace.projects.map((p) => ({
        id: p.id,
        title: language === "ar" ? p.titleAr || p.title : p.title,
        client: language === "ar" ? p.clientNameAr || p.clientName : p.clientName,
        serviceType: p.serviceType,
        owner: ownerLabel(p.assignedEmployeeId),
        status: p.status,
        priority: p.priority,
        progress: p.progress,
        deadline: p.deadline,
        budgetUSD: p.budget ?? 0,
        remainingHours: calcRemainingHours(p),
      })),
    };
  } else {
    // complex_analysis: compact full workspace snapshot (~45% smaller than verbose payload, zero missing facts)
    const riskMap = new Map(workspace.risks.map((r) => [r.project.id, r]));
    context = {
      currentDate: todayISO,
      formulas: {
        completionRate: formulas.completionRate,
        onTimeCompletionRate: formulas.onTimeCompletionRate,
        utilizationPct: formulas.utilizationPct,
        overdueProjects: formulas.overdueProjects,
        atRiskProjects: formulas.atRiskProjects,
        totalDelayedProjects: formulas.totalDelayedProjects,
      },
      metrics: {
        totalOrders: workspace.metrics.totalOrders,
        activeProjects: workspace.metrics.activeProjects,
        completedProjects: workspace.metrics.completedProjects,
        completedOnTimeCount: workspace.metrics.completedOnTimeCount,
        completedLateCount: workspace.metrics.completedLateCount,
        overdueProjects: workspace.metrics.overdueProjects,
        totalDelayedProjects: workspace.metrics.totalDelayedProjects,
        atRiskProjects: workspace.metrics.atRiskProjects,
        completionRate: workspace.metrics.completionRate,
        onTimeCompletionRate: workspace.metrics.onTimeCompletionRate,
        avgCompletionDays: workspace.metrics.avgCompletionDays,
        totalPortfolioBudgetUSD: workspace.metrics.totalPortfolioBudget,
        activePortfolioBudgetUSD: workspace.metrics.activePortfolioBudget,
        statusCounts: workspace.metrics.statusCounts,
        categoryCounts: workspace.metrics.categoryCounts,
      },
      teamWorkload: workspace.workloads.map((w) => ({
        id: w.employee.id,
        name: language === "ar" ? w.employee.nameAr : w.employee.name,
        department: language === "ar" ? w.employee.departmentAr ?? w.employee.department : w.employee.department,
        weeklyCapacityHours: w.employee.weeklyCapacityHours,
        activeWorkloadHours: w.activeWorkloadHours,
        utilizationPct: w.utilizationPct,
        capacityStatus: w.capacityStatus,
        activeProjectsCount: w.activeProjectsCount,
        overdueProjectsCount: w.overdueProjectsCount,
        skillsVerified: w.employee.skillsVerified,
      })),
      projects: workspace.projects.map((p) => {
        const r = riskMap.get(p.id);
        return {
          id: p.id,
          title: language === "ar" ? p.titleAr || p.title : p.title,
          client: language === "ar" ? p.clientNameAr || p.clientName : p.clientName,
          serviceType: p.serviceType,
          owner: ownerLabel(p.assignedEmployeeId),
          status: p.status,
          priority: p.priority,
          progress: p.progress,
          deadline: p.deadline,
          completedDate: p.completedDate,
          budgetUSD: p.budget ?? 0,
          remainingHours: calcRemainingHours(p),
          riskScore: r?.riskScore,
          riskLevel: r?.riskLevel,
          notes:
            (language === "ar" ? p.notesAr || p.notes : p.notes) ||
            (language === "ar" ? "[لا توجد ملاحظات مسجلة]" : "[No notes recorded]"),
        };
      }),
      rebalanceCandidates: workspace.rebalanceSuggestions.map((r) => ({
        projectId: r.projectId,
        from: language === "ar" ? r.fromEmployeeNameAr : r.fromEmployeeName,
        to: language === "ar" ? r.toEmployeeNameAr : r.toEmployeeName,
        hoursMoved: r.hoursMoved,
        requiresManagerVerification: r.requiresManagerVerification,
      })),
      operationalPatterns: workspace.intelligence?.proactiveInsights.map((p) => ({
        title: language === "ar" ? p.titleAr : p.titleEn,
        detail: language === "ar" ? p.detailAr : p.detailEn,
        evidence: language === "ar" ? p.evidenceAr : p.evidenceEn,
      })),
    };
  }

  const serialized = JSON.stringify(context);
  const bytes = new TextEncoder().encode(serialized).length;
  cacheSet(cacheKey, { context, bytes });

  return {
    intent,
    context,
    contextPrepMs: +(performance.now() - t0).toFixed(2),
    contextBytes: bytes,
    cacheHit: false,
  };
}
