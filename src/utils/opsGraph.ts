import {
  Employee,
  EmployeeWorkloadSummary,
  GraphEntityInvestigationContext,
  Language,
  NodeImpactReport,
  OperationalIntelligenceReport,
  OpsGraphData,
  OpsGraphEdge,
  OpsGraphFilters,
  OpsGraphNode,
  Project,
  ProjectRiskAssessment,
  WhatIfScenarioResult,
} from "../types.js";
import {
  assessProjectRisks,
  calcRemainingHours,
  computeTeamWorkload,
  diffDays,
  extractProjectBlocker,
  getTodayISO,
} from "./analytics.js";

export const DEFAULT_OPSGRAPH_FILTERS: OpsGraphFilters = {
  types: {
    project: true,
    employee: true,
    customer: true,
    blocker: true,
    deadline: true,
    risk: true,
  },
  showDependencies: true,
  criticalOnly: false,
  overdueOnly: false,
  highUtilizationOnly: false,
  upcomingDeadlinesOnly: false,
  dateRange: "all",
  collapsedSecondary: false,
};

const BLOCKER_SIGNAL_RE =
  /(awaiting|waiting|pending|stalled|blocked|sign-off|confirm|revised|feedback|credentials|hold|delay|بانتظار|متوقف|معلق|اعتماد|تأكيد|ملاحظات|تعديل)/i;

function truncateText(text: string, max = 32): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function summarizeBlockerShort(project: Project): {
  isRealBlocker: boolean;
  shortEn: string;
  shortAr: string;
  fullEn: string;
  fullAr: string;
} {
  const rawEn = project.notes.trim();
  const rawAr = project.notesAr.trim();

  if (!rawEn && !rawAr) {
    return {
      isRealBlocker: false,
      shortEn: "",
      shortAr: "",
      fullEn: "Visibility gap — no recorded data available.",
      fullAr: "فجوة في الرؤية — لا توجد بيانات مسجلة.",
    };
  }

  const combined = `${rawEn} ${rawAr}`;
  const isReal = BLOCKER_SIGNAL_RE.test(combined) || project.status === "on_hold";
  if (!isReal) {
    return {
      isRealBlocker: false,
      shortEn: "",
      shortAr: "",
      fullEn: rawEn || rawAr,
      fullAr: rawAr || rawEn,
    };
  }

  // Extract concise factual blocker label without inventing new details
  if (/staging credentials/i.test(rawEn)) {
    return {
      isRealBlocker: true,
      shortEn: "Staging credentials",
      shortAr: "بيانات بيئة الاختبار",
      fullEn: rawEn,
      fullAr: rawAr || rawEn,
    };
  }
  if (/tax rule confirmation/i.test(rawEn)) {
    return {
      isRealBlocker: true,
      shortEn: "Tax rule confirmation",
      shortAr: "تأكيد قواعد الضريبة",
      fullEn: rawEn,
      fullAr: rawAr || rawEn,
    };
  }
  if (/executive review pending sign-off/i.test(rawEn)) {
    return {
      isRealBlocker: true,
      shortEn: "Executive sign-off pending",
      shortAr: "بانتظار الاعتماد التنفيذي",
      fullEn: rawEn,
      fullAr: rawAr || rawEn,
    };
  }
  if (/14 data visualization charts/i.test(rawEn)) {
    return {
      isRealBlocker: true,
      shortEn: "14 charts pending build",
      shortAr: "١٤ لوحة بيانية قيد الإنشاء",
      fullEn: rawEn,
      fullAr: rawAr || rawEn,
    };
  }
  if (/print vendor feedback/i.test(rawEn)) {
    return {
      isRealBlocker: true,
      shortEn: "Print vendor revision",
      shortAr: "تعديل بناءً على المطبعة",
      fullEn: rawEn,
      fullAr: rawAr || rawEn,
    };
  }
  if (/cfo final number verification/i.test(rawEn)) {
    return {
      isRealBlocker: true,
      shortEn: "CFO number verification",
      shortAr: "تحقق المدير المالي",
      fullEn: rawEn,
      fullAr: rawAr || rawEn,
    };
  }

  return {
    isRealBlocker: true,
    shortEn: truncateText(rawEn || rawAr, 30),
    shortAr: truncateText(rawAr || rawEn, 30),
    fullEn: rawEn || rawAr,
    fullAr: rawAr || rawEn,
  };
}

function getDeadlineWindowBucket(
  daysUntil: number,
  status: Project["status"]
): "overdue" | "due_soon" | "upcoming" | "completed" {
  if (status === "completed") return "completed";
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 7) return "due_soon";
  return "upcoming";
}

export function buildOpsGraphData(
  projects: Project[],
  employees: Employee[],
  workloads: EmployeeWorkloadSummary[],
  risks: ProjectRiskAssessment[],
  _intelligence: OperationalIntelligenceReport,
  filters: OpsGraphFilters,
  expandedNodeIds: Set<string>,
  todayISO = getTodayISO()
): OpsGraphData {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const workloadMap = new Map(workloads.map((w) => [w.employee.id, w]));
  const riskMap = new Map(risks.map((r) => [r.project.id, r]));

  // 1. Filter grounded active projects according to user filters
  const activeProjects = projects.filter((p) => p.status !== "completed");

  const filteredProjects = activeProjects.filter((p) => {
    const assessment = riskMap.get(p.id);
    const daysUntil = assessment?.daysUntilDeadline ?? diffDays(todayISO, p.deadline);
    const ownerLoad = workloadMap.get(p.assignedEmployeeId);

    if (filters.dateRange === "7d" && daysUntil > 7) return false;
    if (filters.dateRange === "14d" && daysUntil > 14) return false;
    if (filters.dateRange === "30d" && daysUntil > 30) return false;

    if (filters.criticalOnly && assessment?.riskLevel !== "critical") return false;
    if (filters.overdueOnly && daysUntil >= 0) return false;
    if (filters.highUtilizationOnly && ownerLoad?.capacityStatus !== "overloaded") return false;
    if (filters.upcomingDeadlinesOnly && (daysUntil < 0 || daysUntil > 7)) return false;

    if (filters.collapsedSecondary) {
      const isExpandedProject =
        expandedNodeIds.has(p.id) || expandedNodeIds.has(`emp:${p.assignedEmployeeId}`);
      const isHighAttention =
        (assessment?.riskScore ?? 0) >= 50 ||
        daysUntil <= 4 ||
        ownerLoad?.capacityStatus === "overloaded";
      if (!isHighAttention && !isExpandedProject) return false;
    }

    return true;
  });

  // Sort projects so critical/overdue projects occupy prime center coordinates
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    const rA = riskMap.get(a.id)?.riskScore ?? 0;
    const rB = riskMap.get(b.id)?.riskScore ?? 0;
    if (rB !== rA) return rB - rA;
    return a.deadline.localeCompare(b.deadline);
  });

  const nodes: OpsGraphNode[] = [];
  const edges: OpsGraphEdge[] = [];
  const missingDataSummaryEn: string[] = [];
  const missingDataSummaryAr: string[] = [];

  // Track visible groups
  const visibleEmpIds = new Set<string>();
  const customerProjectsMap = new Map<string, { projects: Project[]; nameAr: string }>();
  const blockerGroups = new Map<
    string,
    {
      id: string;
      shortEn: string;
      shortAr: string;
      fullEn: string;
      fullAr: string;
      projects: Project[];
      maxSeverity: OpsGraphNode["severity"];
    }
  >();
  const deadlineGroups = new Map<
    "overdue" | "due_soon" | "upcoming",
    { projects: Project[]; minDays: number; maxDays: number }
  >();
  const riskGroups = new Map<"critical" | "high" | "medium" | "low", Project[]>();

  for (const p of sortedProjects) {
    const assessment = riskMap.get(p.id);
    const daysUntil = assessment?.daysUntilDeadline ?? diffDays(todayISO, p.deadline);

    if (empMap.has(p.assignedEmployeeId)) {
      visibleEmpIds.add(p.assignedEmployeeId);
    }

    const custEntry = customerProjectsMap.get(p.clientName) ?? {
      projects: [],
      nameAr: p.clientNameAr || p.clientName,
    };
    custEntry.projects.push(p);
    customerProjectsMap.set(p.clientName, custEntry);

    const blocker = summarizeBlockerShort(p);
    if (blocker.isRealBlocker) {
      const bKey = `blk:${p.id}`;
      const sev: OpsGraphNode["severity"] =
        assessment?.riskLevel === "critical"
          ? "critical"
          : assessment?.riskLevel === "high"
          ? "high"
          : "medium";
      blockerGroups.set(bKey, {
        id: bKey,
        shortEn: blocker.shortEn,
        shortAr: blocker.shortAr,
        fullEn: blocker.fullEn,
        fullAr: blocker.fullAr,
        projects: [p],
        maxSeverity: sev,
      });
    } else if (!p.notes.trim() && !p.notesAr.trim()) {
      missingDataSummaryEn.push(`${p.id}: no blocker or execution note recorded`);
      missingDataSummaryAr.push(`${p.id}: لا توجد ملاحظات تنفيذ أو عوائق مسجلة`);
    }

    const dlBucket = getDeadlineWindowBucket(daysUntil, p.status);
    if (dlBucket !== "completed") {
      const dlEntry = deadlineGroups.get(dlBucket) ?? {
        projects: [],
        minDays: daysUntil,
        maxDays: daysUntil,
      };
      dlEntry.projects.push(p);
      dlEntry.minDays = Math.min(dlEntry.minDays, daysUntil);
      dlEntry.maxDays = Math.max(dlEntry.maxDays, daysUntil);
      deadlineGroups.set(dlBucket, dlEntry);
    }

    const rLevel = assessment?.riskLevel ?? "low";
    const rList = riskGroups.get(rLevel) ?? [];
    rList.push(p);
    riskGroups.set(rLevel, rList);
  }

  // Also include overloaded employees matching highUtilizationOnly even if filtering
  const visibleEmployees = employees.filter((e) => {
    const load = workloadMap.get(e.id);
    if (filters.highUtilizationOnly && load?.capacityStatus !== "overloaded") {
      return false;
    }
    return visibleEmpIds.has(e.id);
  });

  // 2. Deterministic Column Coordinates (Causal flow: Employees -> Projects -> Blockers/Customers -> Deadlines/Risks)
  // Dynamic vertical pitch prevents node overlap regardless of project count
  const totalRows = Math.max(
    sortedProjects.length,
    visibleEmployees.length,
    customerProjectsMap.size,
    blockerGroups.size + deadlineGroups.size + riskGroups.size,
    4
  );
  const canvasHeight = Math.max(660, totalRows * 86 + 80);

  const distributeY = (index: number, count: number, padTop = 76, padBottom = 76): number => {
    if (count <= 1) return Math.round(canvasHeight / 2);
    const usable = canvasHeight - padTop - padBottom;
    return Math.round(padTop + (index / (count - 1)) * usable);
  };

  // Column 1: Employees (x = 125)
  if (filters.types.employee) {
    const sortedEmps = [...visibleEmployees].sort((a, b) => {
      const uA = workloadMap.get(a.id)?.utilizationPct ?? 0;
      const uB = workloadMap.get(b.id)?.utilizationPct ?? 0;
      return uB - uA;
    });

    sortedEmps.forEach((emp, idx) => {
      const load = workloadMap.get(emp.id);
      const util = load?.utilizationPct ?? 0;
      const activeCount = load?.activeProjectsCount ?? 0;
      const sev: OpsGraphNode["severity"] =
        load?.capacityStatus === "overloaded"
          ? "critical"
          : util >= 85
          ? "high"
          : load?.capacityStatus === "available"
          ? "low"
          : "info";

      nodes.push({
        id: `emp:${emp.id}`,
        type: "employee",
        labelEn: emp.name,
        labelAr: emp.nameAr,
        subtitleEn: `${util}% utilization · ${activeCount} active`,
        subtitleAr: `${util}% إشغال · ${activeCount} نشطة`,
        severity: sev,
        x: 135,
        y: distributeY(idx, sortedEmps.length, 95, 95),
        employeeId: emp.id,
        utilizationPct: util,
        affectedCount: activeCount,
        priorityRank: load?.capacityStatus === "overloaded" ? util : Math.round(util * 0.5),
        searchTokens: `${emp.id} ${emp.name} ${emp.nameAr} ${emp.role} ${emp.roleAr} ${util}% ${load?.capacityStatus ?? ""}`.toLowerCase(),
      });
    });
  }

  // Column 2: Projects (x = 410, or gently staggered 390/445 if dense)
  if (filters.types.project) {
    sortedProjects.forEach((p, idx) => {
      const assessment = riskMap.get(p.id);
      const riskScore = assessment?.riskScore ?? 0;
      const riskLevel = assessment?.riskLevel ?? "low";
      const daysUntil = assessment?.daysUntilDeadline ?? diffDays(todayISO, p.deadline);
      const blocker = summarizeBlockerShort(p);
      const hasGap = !p.notes.trim() && !p.notesAr.trim();

      const deadlineSubEn =
        daysUntil < 0
          ? `${Math.abs(daysUntil)}d overdue`
          : daysUntil === 0
          ? "Due today"
          : `${daysUntil}d left`;
      const deadlineSubAr =
        daysUntil < 0
          ? `متأخر ${Math.abs(daysUntil)} يوم`
          : daysUntil === 0
          ? "يستحق اليوم"
          : `متبقي ${daysUntil} يوم`;

      const xOffset = sortedProjects.length > 7 && idx % 2 === 1 ? 45 : 0;

      nodes.push({
        id: p.id,
        type: "project",
        labelEn: p.id,
        labelAr: p.id,
        subtitleEn: `${truncateText(p.title, 26)} · Risk ${riskScore} · ${deadlineSubEn}`,
        subtitleAr: `${truncateText(p.titleAr || p.title, 24)} · خطر ${riskScore} · ${deadlineSubAr}`,
        severity: riskLevel,
        x: 410 + xOffset,
        y: distributeY(idx, sortedProjects.length, 76, 76),
        projectId: p.id,
        employeeId: p.assignedEmployeeId,
        customerName: p.clientName,
        riskScore,
        riskLevel,
        daysDelta: daysUntil,
        deadlineState: daysUntil < 0 ? "overdue" : daysUntil <= 7 ? "due_soon" : "upcoming",
        hasVisibilityGap: hasGap,
        priorityRank: riskScore + (daysUntil < 0 ? 15 : 0),
        signalCount: assessment?.signals.length ?? 0,
        searchTokens: `${p.id} ${p.title} ${p.titleAr} ${p.clientName} ${p.clientNameAr} ${p.status} ${p.priority} ${riskLevel} risk ${blocker.fullEn} ${blocker.fullAr}`.toLowerCase(),
      });
    });
  }

  // Column 3: Blockers (top half) & Customers (bottom half or interleaved cleanly) -> x = 710
  const col3Items: Array<{ kind: "blocker" | "customer"; key: string }> = [];
  if (filters.types.blocker) {
    for (const key of blockerGroups.keys()) {
      col3Items.push({ kind: "blocker", key });
    }
  }
  if (filters.types.customer) {
    for (const key of customerProjectsMap.keys()) {
      col3Items.push({ kind: "customer", key });
    }
  }

  col3Items.forEach((item, idx) => {
    const y = distributeY(idx, col3Items.length, 76, 76);
    if (item.kind === "blocker") {
      const blk = blockerGroups.get(item.key)!;
      nodes.push({
        id: blk.id,
        type: "blocker",
        labelEn: blk.shortEn,
        labelAr: blk.shortAr,
        subtitleEn: `${blk.projects.length} affected project · Blocker`,
        subtitleAr: `${blk.projects.length} مشروع متأثر · عائق`,
        severity: blk.maxSeverity,
        x: 715,
        y,
        affectedCount: blk.projects.length,
        projectId: blk.projects[0]?.id,
        searchTokens: `blocker ${blk.shortEn} ${blk.shortAr} ${blk.fullEn} ${blk.fullAr} ${blk.projects.map((p) => p.id).join(" ")}`.toLowerCase(),
      });
    } else {
      const cust = customerProjectsMap.get(item.key)!;
      const maxRisk = cust.projects.reduce(
        (m, p) => Math.max(m, riskMap.get(p.id)?.riskScore ?? 0),
        0
      );
      const sev: OpsGraphNode["severity"] =
        maxRisk >= 75 ? "critical" : maxRisk >= 50 ? "high" : "info";

      nodes.push({
        id: `cust:${item.key}`,
        type: "customer",
        labelEn: item.key,
        labelAr: cust.nameAr,
        subtitleEn: `${cust.projects.length} project${cust.projects.length > 1 ? "s" : ""}`,
        subtitleAr: `${cust.projects.length} ${cust.projects.length > 1 ? "مشاريع" : "مشروع"}`,
        severity: sev,
        x: 715,
        y,
        customerName: item.key,
        affectedCount: cust.projects.length,
        searchTokens: `customer client ${item.key} ${cust.nameAr} ${cust.projects.map((p) => p.id).join(" ")}`.toLowerCase(),
      });
    }
  });

  // Column 4: Deadlines (top) & Risk Concentration Nodes (bottom) -> x = 1005
  const col4Items: Array<
    | { kind: "deadline"; bucket: "overdue" | "due_soon" | "upcoming" }
    | { kind: "risk"; level: "critical" | "high" | "medium" | "low" }
  > = [];

  if (filters.types.deadline) {
    (["overdue", "due_soon", "upcoming"] as const).forEach((b) => {
      if (deadlineGroups.has(b)) col4Items.push({ kind: "deadline", bucket: b });
    });
  }
  if (filters.types.risk) {
    (["critical", "high", "medium", "low"] as const).forEach((lvl) => {
      if (riskGroups.has(lvl)) col4Items.push({ kind: "risk", level: lvl });
    });
  }

  col4Items.forEach((item, idx) => {
    const y = distributeY(idx, col4Items.length, 95, 95);
    if (item.kind === "deadline") {
      const dl = deadlineGroups.get(item.bucket)!;
      const count = dl.projects.length;
      if (item.bucket === "overdue") {
        const maxLate = Math.abs(dl.minDays);
        const minLate = Math.abs(dl.maxDays);
        const rangeEn = minLate === maxLate ? `${maxLate}d overdue` : `${minLate}–${maxLate}d overdue`;
        const rangeAr = minLate === maxLate ? `متأخر ${maxLate} يوم` : `متأخر ${minLate}–${maxLate} أيام`;
        nodes.push({
          id: "dl:overdue",
          type: "deadline",
          labelEn: "Overdue Deadlines",
          labelAr: "مواعيد متأخرة",
          subtitleEn: `${count} projects · ${rangeEn}`,
          subtitleAr: `${count} مشاريع · ${rangeAr}`,
          severity: "critical",
          x: 1005,
          y,
          affectedCount: count,
          daysDelta: dl.minDays,
          deadlineState: "overdue",
          searchTokens: `overdue deadline late ${dl.projects.map((p) => p.id).join(" ")}`.toLowerCase(),
        });
      } else if (item.bucket === "due_soon") {
        nodes.push({
          id: "dl:due_soon",
          type: "deadline",
          labelEn: "7-Day Deadline Window",
          labelAr: "نافذة مواعيد ٧ أيام",
          subtitleEn: `${count} projects · ${dl.minDays}–${dl.maxDays}d left`,
          subtitleAr: `${count} مشاريع · متبقي ${dl.minDays}–${dl.maxDays} يوم`,
          severity: "high",
          x: 1005,
          y,
          affectedCount: count,
          daysDelta: dl.minDays,
          deadlineState: "due_soon",
          searchTokens: `deadline 7 day upcoming collision ${dl.projects.map((p) => p.id).join(" ")}`.toLowerCase(),
        });
      } else {
        nodes.push({
          id: "dl:upcoming",
          type: "deadline",
          labelEn: "Upcoming Deadlines",
          labelAr: "مواعيد قادمة",
          subtitleEn: `${count} projects · ${dl.minDays}–${dl.maxDays}d left`,
          subtitleAr: `${count} مشاريع · متبقي ${dl.minDays}–${dl.maxDays} يوم`,
          severity: "info",
          x: 1005,
          y,
          affectedCount: count,
          daysDelta: dl.minDays,
          deadlineState: "upcoming",
          searchTokens: `upcoming deadline ${dl.projects.map((p) => p.id).join(" ")}`.toLowerCase(),
        });
      }
    } else {
      const rList = riskGroups.get(item.level)!;
      const levelTitles: Record<"critical" | "high" | "medium" | "low", { en: string; ar: string }> = {
        critical: { en: "Critical Risk Cluster", ar: "تركّز المخاطر الحرجة" },
        high: { en: "High Risk Cluster", ar: "تركّز المخاطر المرتفعة" },
        medium: { en: "Moderate Risk Cluster", ar: "مخاطر متوسطة" },
        low: { en: "Low Risk Deliverables", ar: "مشاريع منخفضة المخاطر" },
      };
      const avgScore = Math.round(
        rList.reduce((sum, p) => sum + (riskMap.get(p.id)?.riskScore ?? 0), 0) / rList.length
      );
      nodes.push({
        id: `risk:${item.level}`,
        type: "risk",
        labelEn: levelTitles[item.level].en,
        labelAr: levelTitles[item.level].ar,
        subtitleEn: `${rList.length} project${rList.length > 1 ? "s" : ""} · Avg score ${avgScore}`,
        subtitleAr: `${rList.length} ${rList.length > 1 ? "مشاريع" : "مشروع"} · متوسط ${avgScore}`,
        severity: item.level,
        x: 1005,
        y,
        riskLevel: item.level,
        riskScore: avgScore,
        affectedCount: rList.length,
        searchTokens: `${item.level} risk cluster ${rList.map((p) => p.id).join(" ")}`.toLowerCase(),
      });
    }
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 3. Grounded Edges (only draw connections supported by workspace records & visible endpoints)
  const addEdge = (edge: OpsGraphEdge) => {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      edges.push(edge);
    }
  };

  for (const p of sortedProjects) {
    const assessment = riskMap.get(p.id);
    const riskLevel = assessment?.riskLevel ?? "low";
    const daysUntil = assessment?.daysUntilDeadline ?? diffDays(todayISO, p.deadline);
    const ownerLoad = workloadMap.get(p.assignedEmployeeId);

    // Owner -> Project
    addEdge({
      id: `e:owns:${p.assignedEmployeeId}:${p.id}`,
      source: `emp:${p.assignedEmployeeId}`,
      target: p.id,
      kind: "owns",
      labelEn:
        ownerLoad?.capacityStatus === "overloaded"
          ? `Owner (${ownerLoad.utilizationPct}% load)`
          : "Assigned owner",
      labelAr:
        ownerLoad?.capacityStatus === "overloaded"
          ? `المسؤول (${ownerLoad.utilizationPct}% إشغال)`
          : "المسؤول المسند",
      severity: ownerLoad?.capacityStatus === "overloaded" ? "critical" : riskLevel,
    });

    // Project -> Customer
    addEdge({
      id: `e:client:${p.id}:${p.clientName}`,
      source: p.id,
      target: `cust:${p.clientName}`,
      kind: "client_of",
      labelEn: "Client deliverable",
      labelAr: "تسليم للعميل",
      severity: riskLevel === "critical" ? "critical" : "info",
    });

    // Project -> Blocker (only real recorded blockers)
    const blkId = `blk:${p.id}`;
    if (nodeMap.has(blkId)) {
      addEdge({
        id: `e:blk:${p.id}`,
        source: p.id,
        target: blkId,
        kind: "blocked_by",
        labelEn: "Blocked / waiting",
        labelAr: "عائق / بانتظار",
        severity: riskLevel === "critical" ? "critical" : "high",
      });
    }

    // Project -> Deadline window
    const dlBucket = getDeadlineWindowBucket(daysUntil, p.status);
    if (dlBucket !== "completed") {
      addEdge({
        id: `e:dl:${p.id}:${dlBucket}`,
        source: p.id,
        target: `dl:${dlBucket}`,
        kind: "deadline_window",
        labelEn: daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : `${daysUntil}d remaining`,
        labelAr: daysUntil < 0 ? `متأخر ${Math.abs(daysUntil)} يوم` : `متبقي ${daysUntil} يوم`,
        severity: dlBucket === "overdue" ? "critical" : dlBucket === "due_soon" ? "high" : "info",
      });
    }

    // Project -> Risk cluster
    addEdge({
      id: `e:risk:${p.id}:${riskLevel}`,
      source: p.id,
      target: `risk:${riskLevel}`,
      kind: "risk_exposure",
      labelEn: `Risk ${assessment?.riskScore ?? 0}`,
      labelAr: `مخاطرة ${assessment?.riskScore ?? 0}`,
      severity: riskLevel,
    });
  }

  // Project -> Related Project (strictly factual shared overloaded-owner collision in <=7d window)
  if (filters.showDependencies && filters.types.project) {
    for (let i = 0; i < sortedProjects.length; i++) {
      for (let j = i + 1; j < sortedProjects.length; j++) {
        const a = sortedProjects[i];
        const b = sortedProjects[j];
        if (a.assignedEmployeeId !== b.assignedEmployeeId) continue;

        const ownerLoad = workloadMap.get(a.assignedEmployeeId);
        const dA = riskMap.get(a.id)?.daysUntilDeadline ?? diffDays(todayISO, a.deadline);
        const dB = riskMap.get(b.id)?.daysUntilDeadline ?? diffDays(todayISO, b.deadline);

        if (ownerLoad?.capacityStatus === "overloaded" && dA <= 7 && dB <= 7) {
          addEdge({
            id: `e:rel:${a.id}:${b.id}`,
            source: a.id,
            target: b.id,
            kind: "related_project",
            labelEn: `Shared overloaded owner (${ownerLoad.employee.name}) in 7d window`,
            labelAr: `مسؤول مشترك تحت ضغط (${ownerLoad.employee.nameAr}) ضمن ٧ أيام`,
            severity: "high",
          });
        }
      }
    }
  }

  const adjacency = new Map<string, Set<string>>();
  for (const n of nodes) adjacency.set(n.id, new Set());
  for (const e of edges) {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  }

  return {
    nodes,
    edges,
    nodeMap,
    adjacency,
    missingDataSummaryEn,
    missingDataSummaryAr,
  };
}

export function computeNodeImpact(
  node: OpsGraphNode,
  graph: OpsGraphData,
  projects: Project[],
  employees: Employee[],
  workloads: EmployeeWorkloadSummary[],
  risks: ProjectRiskAssessment[],
  todayISO = getTodayISO()
): NodeImpactReport {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const workloadMap = new Map(workloads.map((w) => [w.employee.id, w]));
  const riskMap = new Map(risks.map((r) => [r.project.id, r]));

  let matchedProjects: Project[] = [];

  if (node.type === "project" && node.projectId) {
    const p = projects.find((x) => x.id === node.projectId);
    if (p) matchedProjects = [p];
  } else if (node.type === "employee" && node.employeeId) {
    matchedProjects = projects.filter(
      (p) => p.status !== "completed" && p.assignedEmployeeId === node.employeeId
    );
  } else if (node.type === "customer" && node.customerName) {
    matchedProjects = projects.filter(
      (p) => p.status !== "completed" && p.clientName === node.customerName
    );
  } else if (node.type === "blocker" && node.projectId) {
    const p = projects.find((x) => x.id === node.projectId);
    if (p) matchedProjects = [p];
  } else if (node.type === "deadline") {
    matchedProjects = projects.filter((p) => {
      if (p.status === "completed") return false;
      const d = riskMap.get(p.id)?.daysUntilDeadline ?? diffDays(todayISO, p.deadline);
      if (node.id === "dl:overdue") return d < 0;
      if (node.id === "dl:due_soon") return d >= 0 && d <= 7;
      return d > 7;
    });
  } else if (node.type === "risk" && node.riskLevel) {
    matchedProjects = risks
      .filter((r) => r.riskLevel === node.riskLevel)
      .map((r) => r.project);
  }

  const affectedProjects = matchedProjects
    .map((p) => {
      const r = riskMap.get(p.id);
      const owner = empMap.get(p.assignedEmployeeId);
      const blk = extractProjectBlocker(p);
      return {
        project: p,
        riskScore: r?.riskScore ?? 0,
        riskLevel: r?.riskLevel ?? "low",
        daysUntilDeadline: r?.daysUntilDeadline ?? diffDays(todayISO, p.deadline),
        remainingHours: r?.remainingWorkloadHours ?? calcRemainingHours(p),
        ownerName: owner?.name ?? "Unassigned",
        ownerNameAr: owner?.nameAr ?? "غير محدد",
        blockerEn: blk.hasRecordedBlocker ? blk.en : "Visibility gap — no recorded data available.",
        blockerAr: blk.hasRecordedBlocker ? blk.ar : "فجوة في الرؤية — لا توجد بيانات مسجلة.",
        hasRecordedBlocker: blk.hasRecordedBlocker,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || a.daysUntilDeadline - b.daysUntilDeadline);

  const totalRemainingHours = affectedProjects.reduce((s, x) => s + x.remainingHours, 0);
  const highOrCriticalCount = affectedProjects.filter(
    (x) => x.riskLevel === "critical" || x.riskLevel === "high"
  ).length;
  const overdueCount = affectedProjects.filter((x) => x.daysUntilDeadline < 0).length;

  // Build full causal subgraph path around the selected entity and all its in-scope projects
  const tracedNodeIds = new Set<string>([node.id]);
  const tracedEdgeIds = new Set<string>();

  const projectIdsInScope = new Set(affectedProjects.map((a) => a.project.id));
  for (const e of graph.edges) {
    const directTouch = e.source === node.id || e.target === node.id;
    const projectChainTouch =
      node.type === "project"
        ? directTouch
        : projectIdsInScope.has(e.source) ||
          (e.kind === "owns" && projectIdsInScope.has(e.target)) ||
          (e.kind === "related_project" &&
            (projectIdsInScope.has(e.source) || projectIdsInScope.has(e.target)));

    if (directTouch || projectChainTouch) {
      tracedEdgeIds.add(e.id);
      tracedNodeIds.add(e.source);
      tracedNodeIds.add(e.target);
    }
  }

  let summaryEn = `${affectedProjects.length} active project(s) connected (${totalRemainingHours}h remaining).`;
  let summaryAr = `${affectedProjects.length} مشروع نشط مرتبط (${totalRemainingHours} ساعة متبقية).`;

  if (node.type === "employee" && node.employeeId) {
    const load = workloadMap.get(node.employeeId);
    const emp = empMap.get(node.employeeId);
    if (load && load.capacityStatus === "overloaded") {
      summaryEn = `Capacity concentration on ${emp?.name ?? node.labelEn} (${load.utilizationPct}% utilization, ${load.activeWorkloadHours}h / ${emp?.weeklyCapacityHours ?? 0}h cap) impacts ${highOrCriticalCount} high/critical risk project(s) and ${overdueCount} overdue deliverable(s).`;
      summaryAr = `تركّز الضغط على ${emp?.nameAr ?? node.labelAr} (${load.utilizationPct}% إشغال، ${load.activeWorkloadHours}س / ${emp?.weeklyCapacityHours ?? 0}س) يؤثر على ${highOrCriticalCount} مشروعاً عالي/حرج المخاطر و${overdueCount} مشروعاً متأخراً.`;
    } else if (load) {
      summaryEn = `${emp?.name ?? node.labelEn} is at ${load.utilizationPct}% utilization (${load.activeWorkloadHours}h / ${emp?.weeklyCapacityHours ?? 0}h cap) across ${affectedProjects.length} active project(s).`;
      summaryAr = `يعمل ${emp?.nameAr ?? node.labelAr} بنسبة إشغال ${load.utilizationPct}% (${load.activeWorkloadHours}س / ${emp?.weeklyCapacityHours ?? 0}س) عبر ${affectedProjects.length} مشروعاً نشطاً.`;
    }
  } else if (node.type === "project" && affectedProjects[0]) {
    const item = affectedProjects[0];
    const ownerLoad = workloadMap.get(item.project.assignedEmployeeId);
    const partsEn: string[] = [];
    const partsAr: string[] = [];
    if (item.daysUntilDeadline < 0) {
      partsEn.push(`${Math.abs(item.daysUntilDeadline)} day(s) overdue`);
      partsAr.push(`متأخر ${Math.abs(item.daysUntilDeadline)} يوم`);
    } else if (item.daysUntilDeadline <= 7) {
      partsEn.push(`due in ${item.daysUntilDeadline} day(s)`);
      partsAr.push(`يستحق خلال ${item.daysUntilDeadline} يوم`);
    }
    if (item.hasRecordedBlocker) {
      partsEn.push(`blocker recorded (${truncateText(item.blockerEn, 44)})`);
      partsAr.push(`عائق مسجل (${truncateText(item.blockerAr, 44)})`);
    } else {
      partsEn.push("no execution notes recorded (visibility gap)");
      partsAr.push("فجوة رؤية (لا توجد ملاحظات مسجلة)");
    }
    if (ownerLoad?.capacityStatus === "overloaded") {
      partsEn.push(`owner at ${ownerLoad.utilizationPct}% utilization`);
      partsAr.push(`المسؤول عند ضغط ${ownerLoad.utilizationPct}%`);
    }
    summaryEn = `${item.project.id} carries risk score ${item.riskScore} (${item.riskLevel}): ${partsEn.join("; ")}.`;
    summaryAr = `يحمل المشروع ${item.project.id} درجة مخاطرة ${item.riskScore}: ${partsAr.join("؛ ")}.`;
  } else if (node.type === "customer") {
    const recordedBlockersCount = affectedProjects.filter((p) => p.hasRecordedBlocker).length;
    summaryEn = `${node.labelEn} has ${affectedProjects.length} active deliverable(s) (${totalRemainingHours}h remaining): ${highOrCriticalCount} high/critical risk, ${overdueCount} overdue, ${recordedBlockersCount} with recorded execution/blocker notes.`;
    summaryAr = `لدى العميل ${node.labelAr} ${affectedProjects.length} تسليمات نشطة (${totalRemainingHours} ساعة متبقية): ${highOrCriticalCount} عالية/حرجة المخاطر، ${overdueCount} متأخرة، و${recordedBlockersCount} بملاحظات تنفيذ/عوائق مسجلة.`;
  } else if (node.type === "blocker") {
    const first = affectedProjects[0];
    summaryEn = `Unresolved blocker on ${first?.project.id ?? ""} (${first?.ownerName ?? ""}) exposes ${totalRemainingHours}h of remaining work${first && first.daysUntilDeadline < 0 ? ` (${Math.abs(first.daysUntilDeadline)}d overdue)` : ""}.`;
    summaryAr = `العائق غير المحلول في ${first?.project.id ?? ""} (${first?.ownerNameAr ?? ""}) يعرّض ${totalRemainingHours} ساعة عمل متبقية للخطر${first && first.daysUntilDeadline < 0 ? ` (متأخر ${Math.abs(first.daysUntilDeadline)} يوم)` : ""}.`;
  } else if (node.type === "deadline") {
    summaryEn = `${affectedProjects.length} active project(s) fall in this deadline window with ${totalRemainingHours}h remaining (${highOrCriticalCount} high/critical risk).`;
    summaryAr = `${affectedProjects.length} مشاريع نشطة تقع ضمن هذه النافذة الزمنية بإجمالي ${totalRemainingHours} ساعة متبقية (${highOrCriticalCount} عالية/حرجة المخاطر).`;
  } else if (node.type === "risk") {
    summaryEn = `${affectedProjects.length} project(s) carry ${node.riskLevel ?? ""} risk exposure, representing ${totalRemainingHours}h of active scope.`;
    summaryAr = `${affectedProjects.length} مشاريع تقع ضمن هذا المستوى من المخاطر بإجمالي ${totalRemainingHours} ساعة عمل نشطة.`;
  }

  return {
    nodeId: node.id,
    affectedProjects,
    totalRemainingHours,
    highOrCriticalCount,
    overdueCount,
    summaryEn,
    summaryAr,
    tracedNodeIds,
    tracedEdgeIds,
  };
}

export function computeWhatIfScenario(
  projects: Project[],
  employees: Employee[],
  projectId: string,
  toEmployeeId: string,
  todayISO = getTodayISO()
): WhatIfScenarioResult | null {
  const targetProject = projects.find((p) => p.id === projectId && p.status !== "completed");
  if (!targetProject) return null;

  const fromEmployee = employees.find((e) => e.id === targetProject.assignedEmployeeId);
  const toEmployee = employees.find((e) => e.id === toEmployeeId);
  if (!fromEmployee || !toEmployee || fromEmployee.id === toEmployee.id) return null;

  const beforeWorkloads = computeTeamWorkload(projects, employees, todayISO);
  const beforeRisks = assessProjectRisks(projects, employees, todayISO);

  const simulatedProjects = projects.map((p) =>
    p.id === projectId ? { ...p, assignedEmployeeId: toEmployeeId } : p
  );
  const afterWorkloads = computeTeamWorkload(simulatedProjects, employees, todayISO);
  const afterRisks = assessProjectRisks(simulatedProjects, employees, todayISO);

  const bFromLoad = beforeWorkloads.find((w) => w.employee.id === fromEmployee.id);
  const bToLoad = beforeWorkloads.find((w) => w.employee.id === toEmployee.id);
  const aFromLoad = afterWorkloads.find((w) => w.employee.id === fromEmployee.id);
  const aToLoad = afterWorkloads.find((w) => w.employee.id === toEmployee.id);

  const bProjRisk = beforeRisks.find((r) => r.project.id === projectId);
  const aProjRisk = afterRisks.find((r) => r.project.id === projectId);

  const bFromHighRiskCount = beforeRisks.filter(
    (r) =>
      r.project.assignedEmployeeId === fromEmployee.id &&
      (r.riskLevel === "critical" || r.riskLevel === "high")
  ).length;

  const aFromHighRiskCount = afterRisks.filter(
    (r) =>
      r.project.assignedEmployeeId === fromEmployee.id &&
      (r.riskLevel === "critical" || r.riskLevel === "high")
  ).length;

  const affectedProjectIds = projects
    .filter(
      (p) =>
        p.status !== "completed" &&
        (p.assignedEmployeeId === fromEmployee.id || p.assignedEmployeeId === toEmployee.id)
    )
    .map((p) => p.id);

  return {
    projectId: targetProject.id,
    projectTitle: targetProject.title,
    projectTitleAr: targetProject.titleAr,
    fromEmployeeId: fromEmployee.id,
    fromEmployeeName: fromEmployee.name,
    fromEmployeeNameAr: fromEmployee.nameAr,
    toEmployeeId: toEmployee.id,
    toEmployeeName: toEmployee.name,
    toEmployeeNameAr: toEmployee.nameAr,
    hoursMoved: calcRemainingHours(targetProject),
    skillMatch: toEmployee.skillsVerified && toEmployee.skills.includes(targetProject.serviceType),
    before: {
      fromUtilizationPct: bFromLoad?.utilizationPct ?? 0,
      toUtilizationPct: bToLoad?.utilizationPct ?? 0,
      projectRiskScore: bProjRisk?.riskScore ?? 0,
      projectRiskLevel: bProjRisk?.riskLevel ?? "low",
      fromHighRiskCount: bFromHighRiskCount,
    },
    after: {
      fromUtilizationPct: aFromLoad?.utilizationPct ?? 0,
      toUtilizationPct: aToLoad?.utilizationPct ?? 0,
      projectRiskScore: aProjRisk?.riskScore ?? 0,
      projectRiskLevel: aProjRisk?.riskLevel ?? "low",
      fromHighRiskCount: aFromHighRiskCount,
    },
    affectedProjectIds,
  };
}

export function getPrioritizedGraphEntities(graph: OpsGraphData, limit = 5): OpsGraphNode[] {
  const sevWeight: Record<OpsGraphNode["severity"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  };
  const typeWeight: Record<OpsGraphNode["type"], number> = {
    project: 4,
    employee: 3,
    blocker: 2,
    customer: 1,
    deadline: 0,
    risk: 0,
  };

  return graph.nodes
    .filter(
      (n) =>
        (n.type === "project" || n.type === "employee" || n.type === "blocker" || n.type === "customer") &&
        (n.severity === "critical" || n.severity === "high")
    )
    .sort((a, b) => {
      const sDiff = sevWeight[b.severity] - sevWeight[a.severity];
      if (sDiff !== 0) return sDiff;
      const rDiff = (b.priorityRank ?? b.riskScore ?? b.utilizationPct ?? 0) - (a.priorityRank ?? a.riskScore ?? a.utilizationPct ?? 0);
      if (rDiff !== 0) return rDiff;
      return typeWeight[b.type] - typeWeight[a.type];
    })
    .slice(0, limit);
}

export function buildGraphEntityContext(params: {
  node: OpsGraphNode;
  graph: OpsGraphData;
  impactReport: NodeImpactReport | null;
  projects: Project[];
  employees: Employee[];
  workloads: EmployeeWorkloadSummary[];
  risks: ProjectRiskAssessment[];
  language: Language;
  investigationMode: boolean;
}): GraphEntityInvestigationContext {
  const {
    node,
    graph,
    impactReport,
    projects,
    employees,
    workloads,
    risks,
    language,
    investigationMode,
  } = params;

  const isAr = language === "ar";
  const label = isAr ? node.labelAr : node.labelEn;
  const summary = isAr ? node.subtitleAr : node.subtitleEn;

  const project = node.projectId ? projects.find((p) => p.id === node.projectId) : undefined;
  const risk = project ? risks.find((r) => r.project.id === project.id) : undefined;
  const employee = node.employeeId
    ? employees.find((e) => e.id === node.employeeId)
    : project
    ? employees.find((e) => e.id === project.assignedEmployeeId)
    : undefined;
  const ownerLoad = employee ? workloads.find((w) => w.employee.id === employee.id) : undefined;

  const confirmedEntityData: Record<string, unknown> = {
    nodeId: node.id,
    nodeType: node.type,
    severity: node.severity,
  };

  const visibilityGaps: string[] = [];

  if (project && risk) {
    const blocker = extractProjectBlocker(project);
    confirmedEntityData.project = {
      id: project.id,
      title: isAr ? project.titleAr || project.title : project.title,
      client: isAr ? project.clientNameAr || project.clientName : project.clientName,
      serviceType: project.serviceType,
      status: project.status,
      priority: project.priority,
      progressPct: project.progress,
      startDate: project.startDate,
      deadline: project.deadline,
      lastUpdated: project.lastUpdated,
      estimatedWorkloadHours: project.estimatedWorkload,
      remainingHours: risk.remainingWorkloadHours,
      daysUntilDeadline: risk.daysUntilDeadline,
      daysSinceUpdate: risk.daysSinceUpdate,
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      riskSignals: risk.signals.map((s) => `${isAr ? s.detailAr : s.detailEn} (+${s.points})`),
      recordedNotes: blocker.hasRecordedBlocker
        ? isAr
          ? blocker.ar
          : blocker.en
        : isAr
        ? "[لا توجد ملاحظات مسجلة]"
        : "[No execution notes recorded]",
      hasRecordedBlocker: blocker.hasRecordedBlocker,
    };
    const missing = isAr ? risk.missingDataAr : risk.missingDataEn;
    visibilityGaps.push(...missing);
  }

  if (employee && ownerLoad) {
    confirmedEntityData.employee = {
      id: employee.id,
      name: isAr ? employee.nameAr : employee.name,
      role: isAr ? employee.roleAr : employee.role,
      weeklyCapacityHours: employee.weeklyCapacityHours,
      activeWorkloadHours: ownerLoad.activeWorkloadHours,
      utilizationPct: ownerLoad.utilizationPct,
      capacityStatus: ownerLoad.capacityStatus,
      activeProjectsCount: ownerLoad.activeProjectsCount,
      overdueProjectsCount: ownerLoad.overdueProjectsCount,
      skills: employee.skills,
      skillsVerified: employee.skillsVerified,
    };
    if (!employee.skillsVerified) {
      visibilityGaps.push(
        isAr
          ? `مهارات ${employee.nameAr} غير مؤكدة إدارياً (يتطلب تحقق المدير قبل إعادة الإسناد).`
          : `${employee.name}'s skills are unverified (requires manager verification before reassignment).`
      );
    }
  }

  if (node.type === "customer" && node.customerName) {
    confirmedEntityData.customer = {
      name: label,
      activeProjectsCount: impactReport?.affectedProjects.length ?? 0,
      overdueCount: impactReport?.overdueCount ?? 0,
      totalRemainingHours: impactReport?.totalRemainingHours ?? 0,
    };
  }

  const connectedRelationships = graph.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const other = graph.nodeMap.get(otherId);
      return {
        edgeKind: e.kind,
        relationshipLabel: isAr ? e.labelAr : e.labelEn,
        targetNodeId: otherId,
        targetType: other?.type ?? "project",
        targetLabel: other ? (isAr ? other.labelAr : other.labelEn) : otherId,
        targetSeverity: other?.severity ?? "info",
      };
    });

  const dependencies = graph.edges
    .filter(
      (e) =>
        e.kind === "related_project" &&
        (e.source === node.id ||
          e.target === node.id ||
          impactReport?.affectedProjects.some((ap) => ap.project.id === e.source || ap.project.id === e.target))
    )
    .map((e) => `${e.source} ↔ ${e.target}: ${isAr ? e.labelAr : e.labelEn}`);

  const affectedProjects = (impactReport?.affectedProjects ?? []).map((ap) => {
    if (!ap.hasRecordedBlocker && node.type !== "project") {
      visibilityGaps.push(
        isAr
          ? `${ap.project.id}: لا توجد ملاحظات تنفيذ أو عوائق مسجلة.`
          : `${ap.project.id}: No execution notes or blocker recorded.`
      );
    }
    return {
      id: ap.project.id,
      title: isAr ? ap.project.titleAr || ap.project.title : ap.project.title,
      client: isAr ? ap.project.clientNameAr || ap.project.clientName : ap.project.clientName,
      owner: isAr ? ap.ownerNameAr : ap.ownerName,
      deadline: ap.project.deadline,
      daysUntilDeadline: ap.daysUntilDeadline,
      progress: ap.project.progress,
      remainingHours: ap.remainingHours,
      riskScore: ap.riskScore,
      riskLevel: ap.riskLevel,
      hasRecordedBlocker: ap.hasRecordedBlocker,
      blocker: isAr ? ap.blockerAr : ap.blockerEn,
    };
  });

  return {
    investigationMode,
    nodeId: node.id,
    nodeType: node.type,
    label,
    summary,
    severity: node.severity,
    confirmedEntityData,
    connectedRelationships,
    impactSummary: impactReport ? (isAr ? impactReport.summaryAr : impactReport.summaryEn) : undefined,
    impactMetrics: {
      affectedProjectsCount: impactReport?.affectedProjects.length ?? 0,
      highOrCriticalCount: impactReport?.highOrCriticalCount ?? 0,
      overdueCount: impactReport?.overdueCount ?? 0,
      totalRemainingHours: impactReport?.totalRemainingHours ?? 0,
    },
    affectedProjects,
    dependencies: Array.from(new Set(dependencies)),
    visibilityGaps: Array.from(new Set(visibilityGaps)),
  };
}
