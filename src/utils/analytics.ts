import {
  AttentionItem,
  Employee,
  EmployeeWorkloadSummary,
  MonthlyTrendPoint,
  OperationalIntelligenceReport,
  OperationalMetrics,
  ProactiveInsight,
  Project,
  ProjectRiskAssessment,
  ProjectStatus,
  RebalanceSuggestion,
  RiskLevel,
  RiskSignal,
  ServiceType,
} from "../types.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function diffDays(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`).getTime();
  const to = new Date(`${toISO}T00:00:00Z`).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

export function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export const METRIC_FORMULAS = {
  en: {
    completionRate: "Completed Projects / Total Orders * 100",
    onTimeCompletionRate:
      "Completed Projects finished on or before deadline / Total Completed Projects * 100 (excludes active projects)",
    utilizationPct: "Employee Active Remaining Hours / Weekly Capacity Hours * 100",
    remainingWorkloadHours: "Estimated Workload * ((100 - Progress %) / 100) for non-completed projects; 0 when completed",
    activeProjects: "Total Orders - Completed Projects (includes New, In Progress, Under Review, On Hold)",
    overdueProjects: "Active non-completed projects where deadline < today",
    atRiskProjects: "Active non-completed projects with deterministic riskScore >= 50 (all overdue projects score >= 50)",
    totalDelayedProjects: "Active Overdue Projects + Completed-Late Projects",
  },
  ar: {
    completionRate: "(المشاريع المكتملة ÷ إجمالي الطلبات) × 100",
    onTimeCompletionRate:
      "(المشاريع المكتملة في الموعد أو قبله ÷ إجمالي المشاريع المكتملة) × 100 (يستثني المشاريع النشطة)",
    utilizationPct: "(الساعات النشطة المتبقية للموظف ÷ السعة الأسبوعية) × 100",
    remainingWorkloadHours: "عبء العمل المقدر × ((100 - نسبة الإنجاز) ÷ 100) للمشاريع غير المكتملة؛ و0 عند الاكتمال",
    activeProjects: "إجمالي الطلبات - المشاريع المكتملة (جديد، قيد التنفيذ، قيد المراجعة، معلق)",
    overdueProjects: "المشاريع النشطة غير المكتملة التي تجاوز موعدها النهائي تاريخ اليوم",
    atRiskProjects: "المشاريع النشطة التي تبلغ درجة مخاطرها 50 فأكثر (جميع المشاريع المتأخرة >= 50)",
    totalDelayedProjects: "المشاريع النشطة المتأخرة + المشاريع المكتملة بعد الموعد",
  },
} as const;

export function calcRemainingHours(project: Project): number {
  if (project.status === "completed" || project.progress >= 100) return 0;
  const pctLeft = Math.max(0, 100 - project.progress) / 100;
  return Math.round(project.estimatedWorkload * pctLeft);
}

export function computeTeamWorkload(
  projects: Project[],
  employees: Employee[],
  todayISO = getTodayISO()
): EmployeeWorkloadSummary[] {
  return employees.map((employee) => {
    const assigned = projects.filter((p) => p.assignedEmployeeId === employee.id);
    const active = assigned.filter((p) => p.status !== "completed");
    const completed = assigned.filter((p) => p.status === "completed");
    const overdue = active.filter((p) => diffDays(todayISO, p.deadline) < 0);

    const activeHours = active.reduce((sum, p) => sum + calcRemainingHours(p), 0);

    const utilizationPct =
      employee.weeklyCapacityHours > 0
        ? Math.round((activeHours / employee.weeklyCapacityHours) * 100)
        : 0;

    let capacityStatus: "overloaded" | "optimal" | "available" = "optimal";
    if (utilizationPct >= 105 || active.length >= 4) {
      capacityStatus = "overloaded";
    } else if (utilizationPct <= 65 && active.length <= 2) {
      capacityStatus = "available";
    }

    return {
      employee,
      assignedProjects: assigned,
      activeProjectsCount: active.length,
      completedProjectsCount: completed.length,
      overdueProjectsCount: overdue.length,
      activeWorkloadHours: activeHours,
      utilizationPct,
      capacityStatus,
    };
  });
}

export function assessProjectRisks(
  projects: Project[],
  employees: Employee[],
  todayISO = getTodayISO()
): ProjectRiskAssessment[] {
  const workloadMap = new Map(
    computeTeamWorkload(projects, employees, todayISO).map((w) => [w.employee.id, w])
  );
  const employeeMap = new Map(employees.map((e) => [e.id, e]));

  const assessments: ProjectRiskAssessment[] = [];

  for (const project of projects) {
    if (project.status === "completed") continue;

    const owner = employeeMap.get(project.assignedEmployeeId);
    const ownerWorkload = workloadMap.get(project.assignedEmployeeId);
    const daysUntilDeadline = diffDays(todayISO, project.deadline);
    const daysSinceUpdate = Math.max(0, diffDays(project.lastUpdated, todayISO));
    const remainingWorkloadHours = calcRemainingHours(project);
    const signals: RiskSignal[] = [];
    const missingDataEn: string[] = [];
    const missingDataAr: string[] = [];

    if (!project.notes.trim() && !project.notesAr.trim()) {
      missingDataEn.push("No execution notes or blocker details recorded");
      missingDataAr.push("لا توجد ملاحظات تنفيذ أو تفاصيل عوائق مسجلة");
    }
    if (!owner) {
      missingDataEn.push("Assigned employee record not found");
      missingDataAr.push("سجل الموظف المسؤول غير موجود");
    } else if (!owner.skillsVerified) {
      missingDataEn.push(`${owner.name}'s skills are unverified`);
      missingDataAr.push(`مهارات ${owner.nameAr} غير مؤكدة`);
    }

    if (daysUntilDeadline < 0) {
      const daysLate = Math.abs(daysUntilDeadline);
      // Every overdue project receives at least 50 base points so Overdue <= At-Risk is strictly consistent.
      signals.push({
        code: "overdue",
        detailEn: `Overdue by ${daysLate} day(s) with ${project.progress}% progress (${remainingWorkloadHours}h remaining)`,
        detailAr: `متأخر بمقدار ${daysLate} يوم بنسبة إنجاز ${project.progress}% (متبقي ${remainingWorkloadHours} ساعة)`,
        points: Math.min(62, 50 + daysLate * 2),
      });
    } else if (daysUntilDeadline <= 5 && project.progress < 70) {
      signals.push({
        code: "deadline_lag",
        detailEn: `Due in ${daysUntilDeadline} day(s) at ${project.progress}% progress (${remainingWorkloadHours}h remaining)`,
        detailAr: `الموعد النهائي خلال ${daysUntilDeadline} يوم بنسبة إنجاز ${project.progress}% (متبقي ${remainingWorkloadHours} ساعة)`,
        points: 35 + Math.max(0, 5 - daysUntilDeadline) * 4,
      });
    } else if (daysUntilDeadline <= 10 && project.progress < 35) {
      signals.push({
        code: "deadline_lag",
        detailEn: `Only ${project.progress}% complete with ${daysUntilDeadline} days left`,
        detailAr: `الإنجاز ${project.progress}% فقط مع بقاء ${daysUntilDeadline} يوماً`,
        points: 24,
      });
    }

    if (daysSinceUpdate >= 5) {
      signals.push({
        code: "stale_update",
        detailEn: `No status update logged for ${daysSinceUpdate} days (last updated ${project.lastUpdated})`,
        detailAr: `لم يتم تسجيل أي تحديث منذ ${daysSinceUpdate} يوماً (آخر تحديث ${project.lastUpdated})`,
        points: Math.min(20, 10 + (daysSinceUpdate - 4) * 2),
      });
    }

    if (!project.notes.trim() && !project.notesAr.trim()) {
      signals.push({
        code: "missing_notes",
        detailEn: "Missing project scope notes / blocker visibility",
        detailAr: "ملاحظات النطاق أو تفاصيل العوائق غير مسجلة",
        points: 14,
      });
    }

    if (project.status === "on_hold" && daysUntilDeadline <= 10) {
      signals.push({
        code: "on_hold_near_deadline",
        detailEn: `On Hold while deadline is ${daysUntilDeadline < 0 ? "already passed" : `in ${daysUntilDeadline} day(s)`}`,
        detailAr: `المشروع معلق بينما الموعد النهائي ${daysUntilDeadline < 0 ? "قد فات" : `خلال ${daysUntilDeadline} يوم`}`,
        points: 20,
      });
    }

    if (ownerWorkload && ownerWorkload.capacityStatus === "overloaded") {
      signals.push({
        code: "overloaded_owner",
        detailEn: `Owner ${owner?.name ?? ""} is at ${ownerWorkload.utilizationPct}% capacity (${ownerWorkload.activeProjectsCount} active projects)`,
        detailAr: `المسؤول ${owner?.nameAr ?? ""} عند ${ownerWorkload.utilizationPct}% من طاقته (${ownerWorkload.activeProjectsCount} مشاريع نشطة)`,
        points: 16,
      });
    }

    if (remainingWorkloadHours >= 18 && daysUntilDeadline <= 7) {
      signals.push({
        code: "excessive_workload",
        detailEn: `Heavy remaining workload (${remainingWorkloadHours}h remaining of ${project.estimatedWorkload}h) within 7-day window`,
        detailAr: `عبء عمل متبقٍ مرتفع (${remainingWorkloadHours} ساعة من أصل ${project.estimatedWorkload} ساعة) ضمن نافذة ٧ أيام`,
        points: 12,
      });
    }

    const priorityBonus =
      project.priority === "critical" ? 8 : project.priority === "high" ? 4 : 0;
    const rawScore =
      signals.reduce((s, item) => s + item.points, 0) + (signals.length > 0 ? priorityBonus : 0);
    const riskScore = Math.min(100, Math.max(0, rawScore));

    // Strict score-to-label mapping
    let riskLevel: RiskLevel = "low";
    if (riskScore >= 75) riskLevel = "critical";
    else if (riskScore >= 50) riskLevel = "high";
    else if (riskScore >= 25) riskLevel = "medium";

    const primarySignal = signals[0];
    const observationEn = primarySignal
      ? primarySignal.detailEn
      : "Execution is tracking within expected timeline and workload bounds.";
    const observationAr = primarySignal
      ? primarySignal.detailAr
      : "التنفيذ يسير ضمن الجدول الزمني وحدود عبء العمل المتوقعة.";

    const evidenceEn = [
      `Status: ${project.status.replace("_", " ")}`,
      `Progress: ${project.progress}%`,
      `Remaining: ${remainingWorkloadHours}h/${project.estimatedWorkload}h`,
      `Deadline: ${project.deadline}`,
      `Owner load: ${ownerWorkload ? `${ownerWorkload.utilizationPct}%` : "Unassigned"}`,
    ].join(" · ");

    const evidenceAr = [
      `الحالة: ${project.status}`,
      `التقدم: ${project.progress}%`,
      `المتبقي: ${remainingWorkloadHours}س/${project.estimatedWorkload}س`,
      `الموعد: ${project.deadline}`,
      `ضغط المسؤول: ${ownerWorkload ? `${ownerWorkload.utilizationPct}%` : "غير محدد"}`,
    ].join(" · ");

    let impactEn = "Minimal operational exposure under current trajectory.";
    let impactAr = "تعرض تشغيلي محدود وفق المسار الحالي.";
    let recommendedActionEn = "Continue standard weekly progress check-in.";
    let recommendedActionAr = "الاستمرار في المتابعة الأسبوعية المعتادة.";

    if (daysUntilDeadline < 0) {
      impactEn = `Direct delivery delay on ${project.clientName} (${Math.abs(daysUntilDeadline)} day(s) past deadline); ${remainingWorkloadHours}h of work still open.`;
      impactAr = `تأخر مباشر في تسليم ${project.clientName} (متجاوز للموعد بـ ${Math.abs(daysUntilDeadline)} يوم) مع بقاء ${remainingWorkloadHours} ساعة عمل.`;
      recommendedActionEn = `Escalate ${project.id} today: review recorded blockers${!project.notes.trim() ? " (notes currently missing — clarify status first)" : ""} and send client timeline update.`;
      recommendedActionAr = `تصعيد ${project.id} اليوم: مراجعة العوائق${!project.notesAr.trim() ? " (الملاحظات مفقودة حالياً — استوضح الحالة أولاً)" : ""} وإرسال تحديث زمني للعميل.`;
    } else if (riskLevel === "critical" || riskLevel === "high") {
      impactEn = `High risk of missing ${project.deadline} deadline with ${remainingWorkloadHours}h remaining.`;
      impactAr = `خطر مرتفع لتجاوز موعد ${project.deadline} مع بقاء ${remainingWorkloadHours} ساعة عمل.`;
      recommendedActionEn =
        ownerWorkload?.capacityStatus === "overloaded"
          ? `Review ${project.id} blockers and consider shifting secondary tasks off ${owner?.name ?? "assignee"} (${ownerWorkload.utilizationPct}% load).`
          : `Conduct a focused milestone check on ${project.id} before ${project.deadline}.`;
      recommendedActionAr =
        ownerWorkload?.capacityStatus === "overloaded"
          ? `مراجعة عوائق ${project.id} والنظر في تخفيف المهام الثانوية عن ${owner?.nameAr ?? "المسؤول"} (${ownerWorkload.utilizationPct}% إشغال).`
          : `إجراء مراجعة مركزة لمعالم ${project.id} قبل ${project.deadline}.`;
    } else if (signals.some((s) => s.code === "missing_notes")) {
      impactEn = "Missing execution notes reduce visibility into blockers and handoff criteria.";
      impactAr = "نقص ملاحظات التنفيذ يقلل وضوح العوائق ومعايير التسليم.";
      recommendedActionEn = `Add clear scope deliverables and current blocker status to ${project.id}.`;
      recommendedActionAr = `إضافة تفاصيل المخرجات وحالة العوائق الحالية إلى ${project.id}.`;
    }

    assessments.push({
      project,
      owner,
      riskScore,
      riskLevel,
      daysUntilDeadline,
      daysSinceUpdate,
      remainingWorkloadHours,
      signals,
      missingDataEn,
      missingDataAr,
      observationEn,
      observationAr,
      evidenceEn,
      evidenceAr,
      impactEn,
      impactAr,
      recommendedActionEn,
      recommendedActionAr,
    });
  }

  return assessments.sort((a, b) => b.riskScore - a.riskScore);
}

export function generateRebalanceSuggestions(
  projects: Project[],
  employees: Employee[],
  todayISO = getTodayISO()
): RebalanceSuggestion[] {
  const workloads = computeTeamWorkload(projects, employees, todayISO);
  const overloaded = workloads.filter((w) => w.capacityStatus === "overloaded");
  const available = workloads
    .filter((w) => w.capacityStatus === "available" || w.utilizationPct < 75)
    .sort((a, b) => a.utilizationPct - b.utilizationPct);

  const suggestions: RebalanceSuggestion[] = [];

  for (const source of overloaded) {
    const candidates = source.assignedProjects
      .filter(
        (p) =>
          p.status !== "completed" &&
          (p.status === "new" || p.status === "on_hold" || p.progress < 50)
      )
      .sort((a, b) => a.progress - b.progress);

    for (const proj of candidates) {
      if (suggestions.length >= 4) break;
      const skillMatchTarget = available.find(
        (t) =>
          t.employee.id !== source.employee.id &&
          t.employee.skills.includes(proj.serviceType)
      );
      const fallbackTarget = available.find((t) => t.employee.id !== source.employee.id);
      const chosen = skillMatchTarget ?? fallbackTarget;

      if (!chosen) continue;

      const hasVerifiedSkill =
        chosen.employee.skillsVerified && chosen.employee.skills.includes(proj.serviceType);

      const hoursMoved = calcRemainingHours(proj);

      suggestions.push({
        projectId: proj.id,
        projectTitle: proj.title,
        projectTitleAr: proj.titleAr,
        fromEmployeeId: source.employee.id,
        fromEmployeeName: source.employee.name,
        fromEmployeeNameAr: source.employee.nameAr,
        toEmployeeId: chosen.employee.id,
        toEmployeeName: chosen.employee.name,
        toEmployeeNameAr: chosen.employee.nameAr,
        hoursMoved,
        skillMatch: hasVerifiedSkill,
        requiresManagerVerification: !hasVerifiedSkill,
        reasonEn: hasVerifiedSkill
          ? `${source.employee.name} is at ${source.utilizationPct}% capacity; ${chosen.employee.name} is at ${chosen.utilizationPct}% with verified ${proj.serviceType.replace("_", " ")} skill.`
          : `${source.employee.name} is at ${source.utilizationPct}% capacity and ${chosen.employee.name} has capacity (${chosen.utilizationPct}%), but skills for ${proj.serviceType.replace("_", " ")} are unverified — manager verification required before reassignment.`,
        reasonAr: hasVerifiedSkill
          ? `${source.employee.nameAr} عند ${source.utilizationPct}% من الطاقة؛ ${chosen.employee.nameAr} عند ${chosen.utilizationPct}% ويمتلك المهارة المؤكدة المطلوبة.`
          : `${source.employee.nameAr} عند ${source.utilizationPct}% من الطاقة و${chosen.employee.nameAr} لديه سعة متاحة (${chosen.utilizationPct}%)، لكن المهارة المطلوبة غير مؤكدة — يتطلب تحقق المدير قبل إعادة التوزيع.`,
      });
    }
  }

  return suggestions;
}

export function computeOperationalMetrics(
  projects: Project[],
  employees: Employee[],
  todayISO = getTodayISO()
): OperationalMetrics {
  const statusCounts: Record<ProjectStatus, number> = {
    new: 0,
    in_progress: 0,
    under_review: 0,
    completed: 0,
    on_hold: 0,
  };

  const categoryCounts: Record<
    ServiceType,
    { total: number; delayed: number; completed: number }
  > = {
    research_reports: { total: 0, delayed: 0, completed: 0 },
    presentations: { total: 0, delayed: 0, completed: 0 },
    graphic_design: { total: 0, delayed: 0, completed: 0 },
    website_development: { total: 0, delayed: 0, completed: 0 },
    business_services: { total: 0, delayed: 0, completed: 0 },
  };

  let overdueProjects = 0;
  let completedOnTimeCount = 0;
  let completedLateCount = 0;
  let completionDaysSum = 0;
  let completionDaysCount = 0;
  let totalPortfolioBudget = 0;
  let activePortfolioBudget = 0;

  for (const p of projects) {
    statusCounts[p.status] += 1;
    categoryCounts[p.serviceType].total += 1;
    const budget = typeof p.budget === "number" && Number.isFinite(p.budget) ? p.budget : 0;
    totalPortfolioBudget += budget;
    if (p.status !== "completed") {
      activePortfolioBudget += budget;
    }

    if (p.status === "completed") {
      categoryCounts[p.serviceType].completed += 1;
      const doneDate = p.completedDate ?? p.lastUpdated;
      const lateDays = diffDays(p.deadline, doneDate);
      if (lateDays <= 0) {
        completedOnTimeCount += 1;
      } else {
        completedLateCount += 1;
        categoryCounts[p.serviceType].delayed += 1;
      }
      const duration = Math.max(1, diffDays(p.startDate, doneDate));
      completionDaysSum += duration;
      completionDaysCount += 1;
    } else if (diffDays(todayISO, p.deadline) < 0) {
      overdueProjects += 1;
      categoryCounts[p.serviceType].delayed += 1;
    }
  }

  const risks = assessProjectRisks(projects, employees, todayISO);
  const atRiskProjects = risks.filter(
    (r) => r.riskLevel === "high" || r.riskLevel === "critical"
  ).length;

  const totalOrders = projects.length;
  const completedProjects = statusCounts.completed;
  const activeProjects = totalOrders - completedProjects;
  const totalDelayedProjects = overdueProjects + completedLateCount;
  const completionRate = totalOrders > 0 ? Math.round((completedProjects / totalOrders) * 100) : 0;
  const onTimeCompletionRate =
    completedProjects > 0 ? Math.round((completedOnTimeCount / completedProjects) * 100) : 0;
  const avgCompletionDays =
    completionDaysCount > 0 ? Math.round(completionDaysSum / completionDaysCount) : 0;

  // Build 6-month series ending at current month
  const refDate = new Date(`${todayISO}T00:00:00Z`);
  const monthlyTrends: MonthlyTrendPoint[] = [];
  const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const arMonths = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const labelEn = enMonths[d.getUTCMonth()];
    const labelAr = arMonths[d.getUTCMonth()];

    const monthCompleted = projects.filter((p) => {
      if (p.status !== "completed") return false;
      const done = p.completedDate ?? p.lastUpdated;
      return done.startsWith(key);
    });

    const onTimeCount = monthCompleted.filter(
      (p) => diffDays(p.deadline, p.completedDate ?? p.lastUpdated) <= 0
    ).length;

    const delayedInMonth = projects.filter((p) => {
      if (p.status === "completed") {
        const done = p.completedDate ?? p.lastUpdated;
        return done.startsWith(key) && diffDays(p.deadline, done) > 0;
      }
      return p.deadline.startsWith(key) && diffDays(todayISO, p.deadline) < 0;
    }).length;

    const totalHours = projects
      .filter((p) => p.startDate.startsWith(key) || (p.completedDate ?? "").startsWith(key))
      .reduce((s, p) => s + p.estimatedWorkload, 0);

    monthlyTrends.push({
      monthKey: key,
      labelEn,
      labelAr,
      completedCount: monthCompleted.length,
      onTimeCount,
      delayedCount: delayedInMonth,
      totalHours,
    });
  }

  return {
    totalOrders,
    activeProjects,
    completedProjects,
    completedOnTimeCount,
    completedLateCount,
    overdueProjects,
    totalDelayedProjects,
    atRiskProjects,
    completionRate,
    onTimeCompletionRate,
    avgCompletionDays,
    totalPortfolioBudget,
    activePortfolioBudget,
    statusCounts,
    categoryCounts,
    monthlyTrends,
  };
}

export function extractProjectBlocker(project: Project): {
  hasRecordedBlocker: boolean;
  en: string;
  ar: string;
} {
  const noteEn = project.notes.trim();
  const noteAr = project.notesAr.trim();
  if (!noteEn && !noteAr) {
    return {
      hasRecordedBlocker: false,
      en: "No blocker or execution note recorded (visibility gap)",
      ar: "لا توجد ملاحظات تنفيذ أو عوائق مسجلة (نقص في الرؤية)",
    };
  }
  return {
    hasRecordedBlocker: true,
    en: noteEn || noteAr,
    ar: noteAr || noteEn,
  };
}

export function computeOperationalIntelligence(
  projects: Project[],
  employees: Employee[],
  metrics: OperationalMetrics,
  workloads: EmployeeWorkloadSummary[],
  risks: ProjectRiskAssessment[],
  todayISO = getTodayISO()
): OperationalIntelligenceReport {
  const workloadMap = new Map(workloads.map((w) => [w.employee.id, w]));

  const attentionCandidates: AttentionItem[] = risks
    .filter((r) => r.riskScore >= 25 || r.daysUntilDeadline <= 4)
    .map((r) => {
      const ownerWorkload = r.owner ? workloadMap.get(r.owner.id) : undefined;
      const ownerUtil = ownerWorkload?.utilizationPct ?? 0;

      // Priority = holistic Risk × Urgency × Impact proxy (strictly derived from workspace fields)
      const urgencyScore =
        r.daysUntilDeadline < 0
          ? Math.min(100, 82 + Math.abs(r.daysUntilDeadline) * 3)
          : Math.max(10, 80 - r.daysUntilDeadline * 7);

      const priorityWeight =
        r.project.priority === "critical"
          ? 28
          : r.project.priority === "high"
          ? 20
          : r.project.priority === "medium"
          ? 12
          : 6;
      const workloadImpact = Math.min(45, r.remainingWorkloadHours * 1.4);
      const overloadImpact = ownerWorkload?.capacityStatus === "overloaded" ? 27 : 0;
      const impactScore = Math.min(100, priorityWeight + workloadImpact + overloadImpact);

      const priorityRankScore = Math.round(
        r.riskScore * 0.45 + urgencyScore * 0.35 + impactScore * 0.2
      );

      const blocker = extractProjectBlocker(r.project);
      const ownerName = r.owner?.name ?? "Unassigned";
      const ownerNameAr = r.owner?.nameAr ?? "غير محدد";

      let whyItMattersEn = r.impactEn;
      let whyItMattersAr = r.impactAr;

      if (r.daysUntilDeadline < 0 && ownerWorkload?.capacityStatus === "overloaded") {
        whyItMattersEn = `${Math.abs(r.daysUntilDeadline)}d overdue with ${r.remainingWorkloadHours}h remaining while ${ownerName} is at ${ownerUtil}% load — compounding downstream delivery slippage.`;
        whyItMattersAr = `متأخر ${Math.abs(r.daysUntilDeadline)} يوم مع بقاء ${r.remainingWorkloadHours} ساعة عمل بينما ${ownerNameAr} عند ضغط ${ownerUtil}% — مما يضاعف خطر تفاقم التأخير.`;
      } else if (ownerWorkload?.capacityStatus === "overloaded") {
        whyItMattersEn = `${r.remainingWorkloadHours}h due by ${r.project.deadline} while owner ${ownerName} operates at ${ownerUtil}% capacity (${ownerWorkload.activeProjectsCount} active items).`;
        whyItMattersAr = `يتطلب ${r.remainingWorkloadHours} ساعة قبل ${r.project.deadline} بينما يعمل ${ownerNameAr} بطاقة ${ownerUtil}% (${ownerWorkload.activeProjectsCount} مشاريع نشطة).`;
      }

      return {
        projectId: r.project.id,
        project: r.project,
        ownerName,
        ownerNameAr,
        ownerUtilizationPct: ownerUtil,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        priorityRankScore,
        daysUntilDeadline: r.daysUntilDeadline,
        remainingWorkloadHours: r.remainingWorkloadHours,
        blockerEn: blocker.en,
        blockerAr: blocker.ar,
        hasRecordedBlocker: blocker.hasRecordedBlocker,
        whyItMattersEn,
        whyItMattersAr,
        recommendedActionEn: r.recommendedActionEn,
        recommendedActionAr: r.recommendedActionAr,
      };
    })
    .sort((a, b) => b.priorityRankScore - a.priorityRankScore || b.riskScore - a.riskScore);

  const immediateAttention = attentionCandidates.slice(0, 5);

  const activeProjects = projects.filter((p) => p.status !== "completed");
  const overdueRisks = risks.filter((r) => r.daysUntilDeadline < 0);
  const overdueTotalHours = overdueRisks.reduce((s, r) => s + r.remainingWorkloadHours, 0);
  const window7dRisks = risks.filter((r) => r.daysUntilDeadline <= 7);
  const unrecordedNotesCount = activeProjects.filter(
    (p) => !p.notes.trim() && !p.notesAr.trim()
  ).length;

  const overloaded = workloads
    .filter((w) => w.capacityStatus === "overloaded")
    .sort((a, b) => b.utilizationPct - a.utilizationPct);
  const available = workloads
    .filter((w) => w.capacityStatus === "available" || w.utilizationPct < 75)
    .sort((a, b) => a.utilizationPct - b.utilizationPct);

  const overloadedOwnersSummaryEn =
    overloaded.length > 0
      ? overloaded
          .map(
            (w) =>
              `${w.employee.name} (${w.utilizationPct}%, ${w.activeWorkloadHours}h across ${w.activeProjectsCount} active projects)`
          )
          .join("; ")
      : "No team members currently exceed capacity thresholds.";

  const overloadedOwnersSummaryAr =
    overloaded.length > 0
      ? overloaded
          .map(
            (w) =>
              `${w.employee.nameAr} (${w.utilizationPct}%، ${w.activeWorkloadHours} ساعة عبر ${w.activeProjectsCount} مشاريع نشطة)`
          )
          .join("؛ ")
      : "لا يوجد أعضاء فريق يتجاوزون حدود السعة حالياً.";

  const capacityRebalanceNarrativeEn =
    overloaded.length > 0 && available.length > 0
      ? `${overloaded[0].employee.name} is at ${overloaded[0].utilizationPct}% utilization with ${overloaded[0].overdueProjectsCount} overdue project(s), while ${available
          .slice(0, 2)
          .map((a) => `${a.employee.name} (${a.utilizationPct}%)`)
          .join(" and ")} have open bandwidth.`
      : overloaded.length > 0
      ? `${overloaded[0].employee.name} is at ${overloaded[0].utilizationPct}% capacity with no under-utilized teammate below 75% to absorb load without reprioritizing deadlines.`
      : "Team capacity is distributed within optimal bounds across active deliverables.";

  const capacityRebalanceNarrativeAr =
    overloaded.length > 0 && available.length > 0
      ? `${overloaded[0].employee.nameAr} عند نسبة إشغال ${overloaded[0].utilizationPct}% مع ${overloaded[0].overdueProjectsCount} مشروع متأخر، بينما يتوفر هامش استيعاب لدى ${available
          .slice(0, 2)
          .map((a) => `${a.employee.nameAr} (${a.utilizationPct}%)`)
          .join(" و")}.`
      : overloaded.length > 0
      ? `${overloaded[0].employee.nameAr} عند ${overloaded[0].utilizationPct}% من الطاقة ولا يوجد عضو أقل من 75% لاستيعاب العبء دون إعادة جدولة المواعيد.`
      : "توزيع طاقة الفريق متوازن ضمن الحدود المثلى عبر المشاريع النشطة.";

  const proactiveInsights: ProactiveInsight[] = [];

  // 1. Risk Concentration by Owner
  const highRisksByOwner = new Map<string, ProjectRiskAssessment[]>();
  for (const r of risks) {
    if (r.riskLevel === "critical" || r.riskLevel === "high") {
      const id = r.project.assignedEmployeeId;
      const list = highRisksByOwner.get(id) ?? [];
      list.push(r);
      highRisksByOwner.set(id, list);
    }
  }
  const topRiskOwnerEntry = [...highRisksByOwner.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0];
  if (topRiskOwnerEntry && topRiskOwnerEntry[1].length >= 2) {
    const ownerEmp = employees.find((e) => e.id === topRiskOwnerEntry[0]);
    const ownerLoad = workloadMap.get(topRiskOwnerEntry[0]);
    const list = topRiskOwnerEntry[1];
    const ids = list.map((x) => x.project.id).join(", ");
    proactiveInsights.push({
      id: "insight-risk-concentration",
      kind: "concentration",
      severity: "critical",
      titleEn: "Risk Concentration on Single Owner",
      titleAr: "تركّز المخاطر لدى مسؤول واحد",
      detailEn: `${ownerEmp?.name ?? topRiskOwnerEntry[0]} holds ${list.length} of ${metrics.atRiskProjects} high/critical risk projects while running at ${ownerLoad?.utilizationPct ?? 0}% capacity.`,
      detailAr: `يحمل ${ownerEmp?.nameAr ?? topRiskOwnerEntry[0]} ${list.length} من أصل ${metrics.atRiskProjects} مشاريع مرتفعة/حرجة المخاطر مع نسبة إشغال ${ownerLoad?.utilizationPct ?? 0}%.`,
      evidenceEn: `Projects: ${ids} · ${ownerLoad?.activeWorkloadHours ?? 0}h / ${ownerEmp?.weeklyCapacityHours ?? 0}h weekly cap`,
      evidenceAr: `المشاريع: ${ids} · ${ownerLoad?.activeWorkloadHours ?? 0}س / ${ownerEmp?.weeklyCapacityHours ?? 0}س طاقة أسبوعية`,
    });
  }

  // 2. 7-Day Deadline Collision Window
  if (window7dRisks.length >= 3) {
    const windowHours = window7dRisks.reduce((s, r) => s + r.remainingWorkloadHours, 0);
    const ids = window7dRisks.slice(0, 5).map((r) => r.project.id).join(", ");
    proactiveInsights.push({
      id: "insight-deadline-collision",
      kind: "deadline_collision",
      severity: overdueRisks.length > 0 ? "critical" : "warning",
      titleEn: "7-Day Deadline Collision Window",
      titleAr: "تزاحم المواعيد النهائية خلال ٧ أيام",
      detailEn: `${window7dRisks.length} active projects (${overdueRisks.length} already overdue) compete for ${windowHours}h of remaining work inside the next 7 days.`,
      detailAr: `${window7dRisks.length} مشاريع نشطة (${overdueRisks.length} متأخرة بالفعل) تتزاحم على ${windowHours} ساعة عمل متبقية خلال ٧ أيام.`,
      evidenceEn: `Scope window <= ${addDaysQuick(todayISO, 7)}: ${ids}`,
      evidenceAr: `النافذة الزمنية حتى ${addDaysQuick(todayISO, 7)}: ${ids}`,
    });
  }

  // 3. Capacity Imbalance / Rebalance Headroom
  if (overloaded.length > 0) {
    proactiveInsights.push({
      id: "insight-capacity-imbalance",
      kind: "capacity",
      severity: "warning",
      titleEn: "Capacity Bottleneck & Absorbable Headroom",
      titleAr: "اختناق السعة وهامش إعادة التوزيع",
      detailEn: capacityRebalanceNarrativeEn,
      detailAr: capacityRebalanceNarrativeAr,
      evidenceEn: `Overloaded: ${overloaded.length} · Available: ${available.length}`,
      evidenceAr: `ضغط زائد: ${overloaded.length} · سعة متاحة: ${available.length}`,
    });
  }

  // 4. Recurring External Blockers & Visibility Gaps
  const awaitingExternal = activeProjects.filter((p) =>
    /(awaiting|waiting|pending|stalled|confirm|sign-off|feedback|credentials)/i.test(p.notes)
  );
  if (awaitingExternal.length > 0 || unrecordedNotesCount > 0) {
    const extIds = awaitingExternal.map((p) => p.id).join(", ");
    proactiveInsights.push({
      id: "insight-blockers-visibility",
      kind: "blockers",
      severity: unrecordedNotesCount >= 2 ? "warning" : "info",
      titleEn: "Dependency Blockers & Note Visibility",
      titleAr: "عوائق الاعتمادية وفجوات التوثيق",
      detailEn: `${awaitingExternal.length} active project(s) cite pending client/external inputs in recorded notes; ${unrecordedNotesCount} active project(s) have no execution notes logged.`,
      detailAr: `${awaitingExternal.length} مشاريع نشطة تشير إلى انتظار مدخلات عميل/خارجية في الملاحظات؛ و${unrecordedNotesCount} مشاريع بدون ملاحظات تنفيذ مسجلة.`,
      evidenceEn: extIds ? `Recorded waits: ${extIds}` : `${unrecordedNotesCount} missing notes`,
      evidenceAr: extIds ? `بانتظار مدخلات: ${extIds}` : `${unrecordedNotesCount} بدون ملاحظات`,
    });
  }

  return {
    immediateAttention,
    proactiveInsights: proactiveInsights.slice(0, 4),
    overloadedOwnersSummaryEn,
    overloadedOwnersSummaryAr,
    capacityRebalanceNarrativeEn,
    capacityRebalanceNarrativeAr,
    deadlineCollisionCount7d: window7dRisks.length,
    overdueTotalHours,
    unrecordedNotesCount,
  };
}

function addDaysQuick(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

