import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Link2Off,
  Loader2,
  Network,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  Square,
  User,
  X,
} from "lucide-react";
import {
  Employee,
  EmployeeWorkloadSummary,
  Language,
  NavSection,
  NodeImpactReport,
  OperationalIntelligenceReport,
  OperationalMetrics,
  OpsGraphData,
  OpsGraphEdge,
  OpsGraphNode,
  Project,
  ProjectRiskAssessment,
  RebalanceSuggestion,
} from "../types";
import { getCopy } from "../i18n/translations";
import { EpistemicTag, RiskLevelLabel } from "./StatusIndicator";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { computeWhatIfScenario } from "../utils/opsGraph";
import { extractProjectBlocker } from "../utils/analytics";
import { classifyChatIntent } from "../services/contextRetriever";
import { resolveAIError, streamOpsPilotChat } from "../services/aiService";

export type OpsGraphPanelTab = "overview" | "relationships" | "impact" | "ai" | "actions";

type ImpactFilterMode = "all" | "critical_high" | "overdue" | "blocked";

interface OpsGraphPanelProps {
  language: Language;
  graph: OpsGraphData;
  selectedNode: OpsGraphNode | null;
  impactReport: NodeImpactReport | null;
  traceActive: boolean;
  activeTab: OpsGraphPanelTab;
  onTabChange: (tab: OpsGraphPanelTab) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleTraceImpact: () => void;
  onActivateTrace?: () => void;
  onInspectProject: (project: Project) => void;
  onNavigate: (section: NavSection) => void;
  onCloseMobile?: () => void;
  projects: Project[];
  employees: Employee[];
  metrics: OperationalMetrics;
  workloads: EmployeeWorkloadSummary[];
  risks: ProjectRiskAssessment[];
  rebalanceSuggestions: RebalanceSuggestion[];
  intelligence: OperationalIntelligenceReport;
  projectsSignature: string;
}

export const OpsGraphPanel = React.memo(function OpsGraphPanel({
  language,
  graph,
  selectedNode,
  impactReport,
  traceActive,
  activeTab,
  onTabChange,
  onSelectNode,
  onToggleTraceImpact,
  onActivateTrace,
  onInspectProject,
  onNavigate,
  onCloseMobile,
  projects,
  employees,
  metrics,
  workloads,
  risks,
  rebalanceSuggestions,
  intelligence,
  projectsSignature,
}: OpsGraphPanelProps) {
  const t = getCopy(language);
  const og = t.opsgraph;

  // Interactive Impact Analysis filter
  const [impactFilter, setImpactFilter] = useState<ImpactFilterMode>("all");

  // Isolated What-If simulation state (never mutates live projects)
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== "completed"),
    [projects]
  );

  const defaultSimProjectId = useMemo(() => {
    if (selectedNode?.projectId) return selectedNode.projectId;
    if (selectedNode?.employeeId) {
      const empProj = activeProjects.find((p) => p.assignedEmployeeId === selectedNode.employeeId);
      if (empProj) return empProj.id;
    }
    return rebalanceSuggestions[0]?.projectId ?? activeProjects[0]?.id ?? "";
  }, [selectedNode, activeProjects, rebalanceSuggestions]);

  const [simProjectId, setSimProjectId] = useState<string>(defaultSimProjectId);
  const [simToEmployeeId, setSimToEmployeeId] = useState<string>("");

  const resolveDefaultTargetEmployee = (projId: string): string => {
    const suggestion = rebalanceSuggestions.find((r) => r.projectId === projId);
    if (suggestion) return suggestion.toEmployeeId;
    const proj = activeProjects.find((p) => p.id === projId);
    const avail = workloads
      .filter((w) => w.employee.id !== proj?.assignedEmployeeId)
      .sort((a, b) => a.utilizationPct - b.utilizationPct)[0];
    return avail?.employee.id ?? "";
  };

  const handleSimProjectChange = (nextProjectId: string) => {
    setSimProjectId(nextProjectId);
    const nextProj = activeProjects.find((p) => p.id === nextProjectId);
    if (!simToEmployeeId || simToEmployeeId === nextProj?.assignedEmployeeId) {
      setSimToEmployeeId(resolveDefaultTargetEmployee(nextProjectId));
    }
  };

  useEffect(() => {
    setSimProjectId(defaultSimProjectId);
    setSimToEmployeeId(resolveDefaultTargetEmployee(defaultSimProjectId));
  }, [defaultSimProjectId, activeProjects, workloads, rebalanceSuggestions]);

  const scenarioResult = useMemo(() => {
    if (!simProjectId || !simToEmployeeId) return null;
    return computeWhatIfScenario(projects, employees, simProjectId, simToEmployeeId);
  }, [projects, employees, simProjectId, simToEmployeeId]);

  // Grounded OpsPilot AI Investigation state (reuses streamOpsPilotChat + AbortController guards)
  const [aiContent, setAiContent] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiStage, setAiStage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPromptTitle, setAiPromptTitle] = useState<string>("");
  const [lastPromptId, setLastPromptId] = useState<string>("investigate");

  const mountedRef = useRef(true);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      aiAbortRef.current?.abort();
    };
  }, []);

  // Reset AI pane output smoothly when switching to another node or language (never auto-fires API calls)
  useEffect(() => {
    aiAbortRef.current?.abort();
    aiInFlightRef.current = false;
    setAiLoading(false);
    setAiStage(null);
    setAiError(null);
    setAiContent("");
    setAiPromptTitle("");
    setImpactFilter("all");
  }, [selectedNode?.id, language]);

  const handleStopAi = () => {
    aiAbortRef.current?.abort();
    aiInFlightRef.current = false;
    setAiLoading(false);
    setAiStage(null);
  };

  const runEntityInvestigation = async (promptId: string, promptLabel: string) => {
    if (!selectedNode) return;

    // Cancel any existing stream cleanly before starting a fresh investigation
    if (aiInFlightRef.current) {
      aiAbortRef.current?.abort();
      aiInFlightRef.current = false;
    }

    if (promptId === "trace" || promptId === "investigate") {
      if (onActivateTrace) {
        onActivateTrace();
      } else if (!traceActive) {
        onToggleTraceImpact();
      }
    }

    aiInFlightRef.current = true;
    const controller = new AbortController();
    aiAbortRef.current = controller;

    const entityLabel = language === "ar" ? selectedNode.labelAr : selectedNode.labelEn;
    const entityType = og.nodeSingular[selectedNode.type];

    const queryMapEn: Record<string, string> = {
      investigate: `Conduct a full operational intelligence investigation on ${entityType} "${entityLabel}" (${selectedNode.id}) and its connected graph relationships.`,
      explain: `Investigate and explain the operational risk for ${entityType} "${entityLabel}" (${selectedNode.id}) and its connected dependencies.`,
      why: `Investigate why ${entityType} "${entityLabel}" (${selectedNode.id}) matters operationally right now across connected projects and team capacity.`,
      bottleneck: `Investigate what is causing the bottleneck around ${entityType} "${entityLabel}" (${selectedNode.id}), citing blockers, utilization, and visibility gaps.`,
      affected: `Investigate all affected deliverables, customers, and downstream impacts connected to ${entityType} "${entityLabel}" (${selectedNode.id}).`,
      prioritize: `Investigate what operations should prioritize regarding ${entityType} "${entityLabel}" (${selectedNode.id}) and why.`,
      trace: `Trace and investigate the causal impact path across connected entities for ${entityType} "${entityLabel}" (${selectedNode.id}).`,
    };
    const queryMapAr: Record<string, string> = {
      investigate: `أجرِ تحقيقاً تشغيلياً شاملاً للكيان ${entityType} "${entityLabel}" (${selectedNode.id}) وعلاقاته المتصلة في الخريطة.`,
      explain: `حقق في المخاطر التشغيلية المرتبطة بـ ${entityType} "${entityLabel}" (${selectedNode.id}) واعتمادياته المتصلة.`,
      why: `حقق في سبب الأهمية التشغيلية الحالية للكيان ${entityType} "${entityLabel}" (${selectedNode.id}) عبر المشاريع وسعة الفريق.`,
      bottleneck: `حقق في أسباب الاختناق حول ${entityType} "${entityLabel}" (${selectedNode.id}) مع ذكر العوائق والإشغال وفجوات البيانات.`,
      affected: `حقق في جميع المشاريع والعملاء والآثار اللاحقة المرتبطة بـ ${entityType} "${entityLabel}" (${selectedNode.id}).`,
      prioritize: `حقق في أولويات التدخل التشغيلي المطلوبة بخصوص ${entityType} "${entityLabel}" (${selectedNode.id}) ولماذا.`,
      trace: `تتبع وحقق في مسار الأثر السببي عبر الكيانات المرتبطة بـ ${entityType} "${entityLabel}" (${selectedNode.id}).`,
    };

    const promptText =
      (language === "ar" ? queryMapAr[promptId] : queryMapEn[promptId]) ?? promptLabel;

    const intent =
      selectedNode.type === "employee" && (promptId === "investigate" || promptId === "bottleneck")
        ? "workload"
        : promptId === "investigate"
        ? "risk_overdue"
        : classifyChatIntent(promptText, []);

    setLastPromptId(promptId);
    setAiPromptTitle(promptLabel);
    setAiLoading(true);
    setAiStage(t.ask.stages[intent]);
    setAiError(null);
    setAiContent("");

    let settled = false;

    try {
      await streamOpsPilotChat(
        language,
        [{ role: "user", content: promptText }],
        intent,
        {
          focusNodeId: selectedNode.id,
          signal: controller.signal,
          onMeta: () => {
            if (settled || !mountedRef.current || controller.signal.aborted) return;
            setAiStage(t.ask.stages.preparing);
          },
          onChunk: (fullText) => {
            if (settled || !mountedRef.current || controller.signal.aborted) return;
            setAiStage(null);
            setAiContent(fullText);
          },
        }
      );
      settled = true;
    } catch (err) {
      settled = true;
      if (!mountedRef.current) return;
      const { kind, message } = resolveAIError(err, language);
      if (kind !== "canceled") {
        setAiError(message);
      }
    } finally {
      settled = true;
      aiInFlightRef.current = false;
      if (aiAbortRef.current === controller) aiAbortRef.current = null;
      if (mountedRef.current) {
        setAiLoading(false);
        setAiStage(null);
      }
    }
  };

  const handleInvestigateClick = () => {
    if (!selectedNode) return;
    onTabChange("ai");
    void runEntityInvestigation("investigate", og.actions.investigateEntity);
  };

  // Resolve exact grounded records for selected node (safe when null)
  const selectedProject = selectedNode?.projectId
    ? projects.find((p) => p.id === selectedNode.projectId)
    : undefined;
  const selectedRisk = selectedProject
    ? risks.find((r) => r.project.id === selectedProject.id)
    : undefined;
  const selectedEmployee = selectedNode?.employeeId
    ? employees.find((e) => e.id === selectedNode.employeeId)
    : selectedProject
    ? employees.find((e) => e.id === selectedProject.assignedEmployeeId)
    : undefined;
  const selectedOwnerLoad = selectedEmployee
    ? workloads.find((w) => w.employee.id === selectedEmployee.id)
    : undefined;
  const selectedBlocker = selectedProject ? extractProjectBlocker(selectedProject) : null;

  // Connected edges + neighbors annotated with relationship kind & label
  const connectedRelations = useMemo(() => {
    if (!selectedNode) return [];
    const items: Array<{ edge: OpsGraphEdge; neighbor: OpsGraphNode }> = [];
    for (const edge of graph.edges) {
      if (edge.source !== selectedNode.id && edge.target !== selectedNode.id) continue;
      const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
      const neighbor = graph.nodeMap.get(otherId);
      if (neighbor) items.push({ edge, neighbor });
    }
    return items;
  }, [graph.edges, graph.nodeMap, selectedNode]);

  // Shared 7-day overloaded-owner dependencies touching this entity
  const relevantDependencies = useMemo(() => {
    const scopeProjectIds = new Set(
      (impactReport?.affectedProjects ?? []).map((ap) => ap.project.id)
    );
    if (selectedProject) scopeProjectIds.add(selectedProject.id);
    if (scopeProjectIds.size === 0) return [];

    return graph.edges
      .filter(
        (e) =>
          e.kind === "related_project" &&
          (scopeProjectIds.has(e.source) || scopeProjectIds.has(e.target))
      )
      .map((e) => ({
        id: e.id,
        peerId: scopeProjectIds.has(e.source) ? e.target : e.source,
        label: language === "ar" ? e.labelAr : e.labelEn,
      }));
  }, [graph.edges, impactReport, selectedProject, language]);

  // Filtered impacted deliverables for Interactive Impact Analysis tab
  const filteredAffectedProjects = useMemo(() => {
    const all = impactReport?.affectedProjects ?? [];
    if (impactFilter === "critical_high") {
      return all.filter((ap) => ap.riskLevel === "critical" || ap.riskLevel === "high");
    }
    if (impactFilter === "overdue") {
      return all.filter((ap) => ap.daysUntilDeadline < 0);
    }
    if (impactFilter === "blocked") {
      return all.filter((ap) => ap.hasRecordedBlocker);
    }
    return all;
  }, [impactReport, impactFilter]);

  // Impacted Customers summary derived strictly from affectedProjects
  const impactedCustomers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; maxRisk: number }>();
    for (const ap of impactReport?.affectedProjects ?? []) {
      const custName =
        language === "ar"
          ? ap.project.clientNameAr || ap.project.clientName
          : ap.project.clientName;
      const cur = map.get(ap.project.clientName) ?? {
        id: `cust:${ap.project.clientName}`,
        name: custName,
        count: 0,
        maxRisk: 0,
      };
      cur.count += 1;
      cur.maxRisk = Math.max(cur.maxRisk, ap.riskScore);
      map.set(ap.project.clientName, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.maxRisk - a.maxRisk || b.count - a.count);
  }, [impactReport, language]);

  if (!selectedNode) {
    return (
      <aside className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E293B] rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[340px]">
        <Network className="w-8 h-8 text-blue-600 dark:text-blue-400 mb-3" />
        <p className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
          {og.title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
          {og.subtitle}
        </p>
      </aside>
    );
  }

  const relatedPatterns = intelligence.proactiveInsights.filter((ins) => {
    const scopeText = `${ins.evidenceEn} ${ins.detailEn}`.toLowerCase();
    if (selectedProject && scopeText.includes(selectedProject.id.toLowerCase())) return true;
    if (selectedEmployee && scopeText.includes(selectedEmployee.name.toLowerCase())) return true;
    if (selectedNode.type === "deadline" && ins.kind === "deadline_collision") return true;
    if (selectedNode.type === "blocker" && ins.kind === "blockers") return true;
    if (selectedNode.type === "risk" && ins.kind === "concentration") return true;
    return false;
  });

  // Grounded Action Cards for Actions Tab
  const actionCards = (() => {
    const cards: Array<{
      id: string;
      priority: string;
      priorityLevel: "critical" | "high" | "medium" | "low";
      action: string;
      reason: string;
      affected: Array<{ id: string; label: string }>;
      expectedImpact: string;
    }> = [];

    if (selectedRisk && selectedProject) {
      const matchingRebalance = rebalanceSuggestions.find(
        (r) => r.projectId === selectedProject.id
      );
      cards.push({
        id: `act-${selectedProject.id}`,
        priority: t.riskLevels[selectedRisk.riskLevel],
        priorityLevel: selectedRisk.riskLevel,
        action:
          language === "ar"
            ? selectedRisk.recommendedActionAr
            : selectedRisk.recommendedActionEn,
        reason:
          language === "ar" ? selectedRisk.observationAr : selectedRisk.observationEn,
        affected: [
          { id: selectedProject.id, label: selectedProject.id },
          ...(selectedEmployee
            ? [
                {
                  id: `emp:${selectedEmployee.id}`,
                  label: language === "ar" ? selectedEmployee.nameAr : selectedEmployee.name,
                },
              ]
            : []),
        ],
        expectedImpact:
          language === "ar" ? selectedRisk.impactAr : selectedRisk.impactEn,
      });

      if (matchingRebalance) {
        cards.push({
          id: `reb-${matchingRebalance.projectId}`,
          priority: t.riskLevels.high,
          priorityLevel: "high",
          action:
            language === "ar"
              ? `إعادة إسناد ${matchingRebalance.projectId} إلى ${matchingRebalance.toEmployeeNameAr}`
              : `Reassign ${matchingRebalance.projectId} to ${matchingRebalance.toEmployeeName}`,
          reason:
            language === "ar" ? matchingRebalance.reasonAr : matchingRebalance.reasonEn,
          affected: [
            { id: matchingRebalance.projectId, label: matchingRebalance.projectId },
            {
              id: `emp:${matchingRebalance.fromEmployeeId}`,
              label:
                language === "ar"
                  ? matchingRebalance.fromEmployeeNameAr
                  : matchingRebalance.fromEmployeeName,
            },
          ],
          expectedImpact:
            language === "ar"
              ? `نقل ${matchingRebalance.hoursMoved} ساعة عمل متبقية لتخفيف الضغط`
              : `Shifts ${matchingRebalance.hoursMoved}h of remaining workload to reduce overload`,
        });
      }
    } else if (impactReport && impactReport.affectedProjects.length > 0) {
      for (const ap of impactReport.affectedProjects.slice(0, 3)) {
        const r = risks.find((rk) => rk.project.id === ap.project.id);
        if (!r) continue;
        cards.push({
          id: `act-imp-${ap.project.id}`,
          priority: t.riskLevels[r.riskLevel],
          priorityLevel: r.riskLevel,
          action: language === "ar" ? r.recommendedActionAr : r.recommendedActionEn,
          reason: language === "ar" ? r.observationAr : r.observationEn,
          affected: [{ id: ap.project.id, label: ap.project.id }],
          expectedImpact: language === "ar" ? r.impactAr : r.impactEn,
        });
      }
    }

    return cards;
  })();

  const tabs: Array<{ id: OpsGraphPanelTab; label: string }> = [
    { id: "overview", label: og.tabs.overview },
    { id: "relationships", label: og.tabs.relationships },
    { id: "impact", label: og.tabs.impact },
    { id: "ai", label: og.tabs.ai },
    { id: "actions", label: og.tabs.actions },
  ];

  const formatDeadlineText = (days: number) => {
    if (days < 0) return `${Math.abs(days)} ${og.labels.daysOverdue}`;
    if (days === 0) return og.labels.dueToday;
    return `${days} ${og.labels.daysRemaining}`;
  };

  const derivedEntityRiskLevel =
    selectedRisk?.riskLevel ??
    (selectedNode.severity === "critical" ||
    selectedNode.severity === "high" ||
    selectedNode.severity === "medium" ||
    selectedNode.severity === "low"
      ? selectedNode.severity
      : undefined);

  return (
    <aside className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E293B] rounded-xl flex flex-col overflow-hidden h-full">
      {/* Panel Header */}
      <div className="p-4 border-b border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#0B1324] space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-cyan-700 dark:text-cyan-400">
                {og.nodeSingular[selectedNode.type]}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">{selectedNode.id}</span>
            </div>
            <h2 className="text-base font-bold text-[#0F294A] dark:text-slate-100 mt-0.5 truncate">
              {selectedProject
                ? `${selectedProject.id} · ${
                    language === "ar"
                      ? selectedProject.titleAr || selectedProject.title
                      : selectedProject.title
                  }`
                : language === "ar"
                ? selectedNode.labelAr
                : selectedNode.labelEn}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {derivedEntityRiskLevel && (
              <RiskLevelLabel
                level={derivedEntityRiskLevel}
                label={t.riskLevels[derivedEntityRiskLevel]}
              />
            )}
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-[#131E33] cursor-pointer"
                aria-label={og.actions.closePanel}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Prominent Command Action Bar: Investigate, Trace Impact & Inspect Record */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleInvestigateClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ScanSearch className="w-3.5 h-3.5" />
            <span>{og.actions.investigate}</span>
          </button>

          <button
            type="button"
            onClick={onToggleTraceImpact}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              traceActive
                ? "bg-cyan-50 dark:bg-cyan-950/60 border-cyan-500/70 text-cyan-800 dark:text-cyan-300"
                : "bg-white dark:bg-[#131E33] border-slate-200 dark:border-[#1E293B] text-slate-700 dark:text-slate-200 hover:border-cyan-500/70"
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
            <span>{traceActive ? og.actions.clearTrace : og.actions.traceImpact}</span>
          </button>

          {selectedProject && (
            <button
              type="button"
              onClick={() => onInspectProject(selectedProject)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#131E33] border border-slate-200 dark:border-[#1E293B] hover:border-blue-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{og.actions.inspectProject}</span>
            </button>
          )}
        </div>

        {/* 5 Tabs */}
        <div
          role="tablist"
          aria-label={og.title}
          className="grid grid-cols-5 gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#070D19] border border-slate-200 dark:border-[#1E293B]"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => onTabChange(tab.id)}
                className={`px-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors truncate cursor-pointer ${
                  active
                    ? "bg-white dark:bg-[#131E33] text-[#0F294A] dark:text-slate-100 border border-slate-200/90 dark:border-blue-500/40"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: DETAILED INVESTIGATION OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {selectedProject && selectedRisk ? (
              <>
                {/* Calculated Risk Score & Signal Breakdown */}
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#131E33]">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {og.labels.riskScore}
                    </span>
                    <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono-num text-[#0F294A] dark:text-slate-100">
                      {selectedRisk.riskScore}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>
                    <span
                      className={`text-xs font-semibold ${
                        selectedRisk.riskLevel === "critical"
                          ? "text-red-700 dark:text-red-400"
                          : selectedRisk.riskLevel === "high"
                          ? "text-orange-700 dark:text-orange-400"
                          : "text-blue-700 dark:text-blue-400"
                      }`}
                    >
                      — {t.riskLevels[selectedRisk.riskLevel]}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedRisk.riskLevel === "critical"
                          ? "bg-red-600"
                          : selectedRisk.riskLevel === "high"
                          ? "bg-orange-500"
                          : "bg-blue-600"
                      }`}
                      style={{ width: `${selectedRisk.riskScore}%` }}
                    />
                  </div>

                  {selectedRisk.signals.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-[#1E293B] space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        {og.labels.riskFactors}
                      </div>
                      {selectedRisk.signals.map((sig, idx) => (
                        <div
                          key={`${sig.code}-${idx}`}
                          className="flex items-start justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300"
                        >
                          <span className="leading-snug">
                            {language === "ar" ? sig.detailAr : sig.detailEn}
                          </span>
                          <span className="font-mono-num font-semibold text-orange-700 dark:text-orange-300 shrink-0">
                            +{sig.points}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirmed Related Entities & Deadlines */}
                <div className="space-y-2">
                  <EpistemicTag kind="confirmed" label={t.epistemic.confirmedData} />
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        selectedEmployee && onSelectNode(`emp:${selectedEmployee.id}`)
                      }
                      className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] text-start hover:border-cyan-500/70 cursor-pointer"
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {og.labels.owner}
                      </div>
                      <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100 mt-0.5 truncate">
                        {selectedEmployee
                          ? language === "ar"
                            ? selectedEmployee.nameAr
                            : selectedEmployee.name
                          : "—"}
                      </div>
                    </button>

                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324]">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {og.labels.utilization}
                      </div>
                      <div
                        className={`text-xs font-bold font-mono-num mt-0.5 ${
                          (selectedOwnerLoad?.utilizationPct ?? 0) >= 105
                            ? "text-red-700 dark:text-red-400"
                            : "text-[#0F294A] dark:text-slate-100"
                        }`}
                      >
                        {selectedOwnerLoad ? `${selectedOwnerLoad.utilizationPct}%` : "—"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectNode(`cust:${selectedProject.clientName}`)}
                      className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] text-start hover:border-cyan-500/70 cursor-pointer"
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {og.labels.customer}
                      </div>
                      <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100 mt-0.5 truncate">
                        {language === "ar"
                          ? selectedProject.clientNameAr || selectedProject.clientName
                          : selectedProject.clientName}
                      </div>
                    </button>

                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324]">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {og.labels.deadline} ·{" "}
                        <span className="font-mono-num">{selectedProject.deadline}</span>
                      </div>
                      <div
                        className={`text-xs font-semibold font-mono-num mt-0.5 ${
                          selectedRisk.daysUntilDeadline < 0
                            ? "text-red-700 dark:text-red-400"
                            : selectedRisk.daysUntilDeadline <= 5
                            ? "text-orange-700 dark:text-orange-400"
                            : "text-[#0F294A] dark:text-slate-100"
                        }`}
                      >
                        {formatDeadlineText(selectedRisk.daysUntilDeadline)}
                      </div>
                    </div>
                  </div>

                  {/* Progress & Remaining Workload Strip */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] text-[11px] text-slate-600 dark:text-slate-300 font-mono-num">
                    <span>
                      {og.labels.progressLabel}: {selectedProject.progress}%
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {selectedRisk.remainingWorkloadHours}
                      {og.labels.hoursRemaining}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{t.statuses[selectedProject.status]}</span>
                  </div>
                </div>

                {/* Recorded Blockers */}
                <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {og.labels.primaryBlocker}
                    </span>
                    {selectedBlocker?.hasRecordedBlocker && (
                      <button
                        type="button"
                        onClick={() => {
                          const blkNodeId = `blk:${selectedProject.id}`;
                          if (graph.nodeMap.has(blkNodeId)) onSelectNode(blkNodeId);
                        }}
                        className="text-[11px] font-medium text-cyan-700 dark:text-cyan-400 hover:underline cursor-pointer"
                      >
                        {og.nodeSingular.blocker}
                      </button>
                    )}
                  </div>
                  <p
                    className={`text-xs leading-relaxed ${
                      selectedBlocker?.hasRecordedBlocker
                        ? "text-slate-800 dark:text-slate-200"
                        : "text-orange-700 dark:text-orange-300 font-medium"
                    }`}
                  >
                    {selectedBlocker?.hasRecordedBlocker
                      ? language === "ar"
                        ? selectedBlocker.ar
                        : selectedBlocker.en
                      : og.labels.visibilityGap}
                  </p>
                </div>

                {/* Relevant Dependencies */}
                <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {og.labels.relevantDependencies}
                    </span>
                    <span className="text-[11px] font-mono-num text-cyan-700 dark:text-cyan-400">
                      {connectedRelations.length} {og.labels.edgesCount}
                    </span>
                  </div>
                  {relevantDependencies.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {og.labels.noDependenciesRecorded}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {relevantDependencies.map((dep) => (
                        <button
                          key={dep.id}
                          type="button"
                          onClick={() => onSelectNode(dep.peerId)}
                          className="w-full text-start text-xs text-cyan-800 dark:text-cyan-300 hover:underline flex items-center gap-1.5 cursor-pointer"
                        >
                          <GitBranch className="w-3 h-3 shrink-0" />
                          <span className="font-mono-num font-semibold">{dep.peerId}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{dep.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Operational Assessment + Impact shortcut */}
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#131E33] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0F294A] dark:text-slate-100">
                      {og.labels.whyCritical}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTabChange("impact")}
                      className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {og.labels.openImpactAnalysis}
                    </button>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {impactReport
                      ? language === "ar"
                        ? impactReport.summaryAr
                        : impactReport.summaryEn
                      : language === "ar"
                      ? selectedRisk.observationAr
                      : selectedRisk.observationEn}
                  </p>
                  <div className="pt-2 border-t border-slate-200 dark:border-[#1E293B] space-y-1">
                    <EpistemicTag kind="recommendation" label={t.epistemic.aiRecommendation} />
                    <p className="text-xs text-[#0F294A] dark:text-blue-200 leading-relaxed">
                      {language === "ar"
                        ? selectedRisk.recommendedActionAr
                        : selectedRisk.recommendedActionEn}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              /* Non-project entity Overview (Employee, Customer, Blocker, Deadline, Risk) */
              <div className="space-y-4">
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#131E33] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
                    <button
                      type="button"
                      onClick={() => onTabChange("impact")}
                      className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {og.labels.openImpactAnalysis}
                    </button>
                  </div>
                  <div className="text-sm font-semibold text-[#0F294A] dark:text-slate-100">
                    {language === "ar" ? selectedNode.subtitleAr : selectedNode.subtitleEn}
                  </div>
                  {impactReport && (
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {language === "ar" ? impactReport.summaryAr : impactReport.summaryEn}
                    </p>
                  )}
                </div>

                {selectedEmployee && selectedOwnerLoad && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324]">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {og.labels.utilization}
                        </div>
                        <div
                          className={`text-sm font-bold font-mono-num mt-0.5 ${
                            selectedOwnerLoad.capacityStatus === "overloaded"
                              ? "text-red-700 dark:text-red-400"
                              : "text-[#0F294A] dark:text-slate-100"
                          }`}
                        >
                          {selectedOwnerLoad.utilizationPct}%
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324]">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t.workload.activeHours}
                        </div>
                        <div className="text-sm font-bold font-mono-num text-[#0F294A] dark:text-slate-100 mt-0.5">
                          {selectedOwnerLoad.activeWorkloadHours}h /{" "}
                          {selectedEmployee.weeklyCapacityHours}h
                        </div>
                      </div>
                    </div>
                    {!selectedEmployee.skillsVerified && (
                      <div className="px-3 py-2 rounded-lg border border-orange-300/70 dark:border-orange-800/70 bg-orange-50/50 dark:bg-orange-950/25 text-[11px] font-medium text-orange-800 dark:text-orange-300">
                        {og.labels.unverifiedSkill}
                      </div>
                    )}
                  </div>
                )}

                {/* Relevant Dependencies */}
                <div className="p-3 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {og.labels.relevantDependencies}
                    </span>
                    <span className="text-[11px] font-mono-num text-cyan-700 dark:text-cyan-400">
                      {connectedRelations.length} {og.labels.edgesCount}
                    </span>
                  </div>
                  {relevantDependencies.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {og.labels.noDependenciesRecorded}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {relevantDependencies.map((dep) => (
                        <button
                          key={dep.id}
                          type="button"
                          onClick={() => onSelectNode(dep.peerId)}
                          className="w-full text-start text-xs text-cyan-800 dark:text-cyan-300 hover:underline flex items-center gap-1.5 cursor-pointer"
                        >
                          <GitBranch className="w-3 h-3 shrink-0" />
                          <span className="font-mono-num font-semibold">{dep.peerId}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{dep.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {impactReport && impactReport.affectedProjects.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                        {og.labels.affectedProjects}
                      </span>
                      <EpistemicTag kind="confirmed" label={t.epistemic.confirmedData} />
                    </div>
                    <div className="space-y-1.5">
                      {impactReport.affectedProjects.map((ap) => (
                        <button
                          key={ap.project.id}
                          type="button"
                          onClick={() => onSelectNode(ap.project.id)}
                          className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] hover:border-cyan-500/70 text-start flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#0F294A] dark:text-slate-100 truncate">
                              {ap.project.id} ·{" "}
                              {language === "ar"
                                ? ap.project.titleAr || ap.project.title
                                : ap.project.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                              {ap.project.deadline} · {formatDeadlineText(ap.daysUntilDeadline)} ·{" "}
                              {ap.remainingHours}
                              {og.labels.hoursRemaining}
                            </div>
                            <div
                              className={`text-[11px] mt-0.5 truncate ${
                                ap.hasRecordedBlocker
                                  ? "text-slate-600 dark:text-slate-300"
                                  : "text-orange-700 dark:text-orange-300"
                              }`}
                            >
                              {language === "ar" ? ap.blockerAr : ap.blockerEn}
                            </div>
                          </div>
                          <RiskLevelLabel
                            level={ap.riskLevel}
                            label={`${ap.riskScore}`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RELATIONSHIPS (Visual Branched Relationship Tree with Edge Roles) */}
        {activeTab === "relationships" && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100 mb-2">
                {og.labels.connectedEntities}
              </div>

              {/* Visual Root Node */}
              <div className="p-2.5 rounded-lg border border-blue-500/60 bg-blue-50/70 dark:bg-[#131E33] text-xs font-bold text-[#0F294A] dark:text-slate-100 flex items-center justify-between">
                <span className="truncate">
                  {language === "ar" ? selectedNode.labelAr : selectedNode.labelEn}
                </span>
                <span className="text-[11px] font-mono-num text-cyan-700 dark:text-cyan-400 shrink-0">
                  {connectedRelations.length} {og.labels.edgesCount}
                </span>
              </div>

              {/* Visual Tree Branches */}
              <div className="ms-3 ps-3.5 border-s border-cyan-500/40 dark:border-cyan-500/35 mt-2 space-y-2">
                {connectedRelations.map(({ edge, neighbor: nbr }) => {
                  const isMissing = nbr.hasVisibilityGap;
                  const NbrIcon =
                    nbr.type === "employee"
                      ? User
                      : nbr.type === "customer"
                      ? Building2
                      : nbr.type === "blocker"
                      ? Link2Off
                      : nbr.type === "deadline"
                      ? CalendarClock
                      : nbr.type === "risk"
                      ? AlertTriangle
                      : FolderKanban;

                  return (
                    <div key={`${edge.id}-${nbr.id}`} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -start-3.5 top-4 w-3 h-px bg-cyan-500/50 dark:bg-cyan-500/40"
                      />
                      <button
                        type="button"
                        onClick={() => onSelectNode(nbr.id)}
                        className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] hover:border-cyan-500/70 text-start transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <NbrIcon className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                            <span className="text-xs font-semibold text-[#0F294A] dark:text-slate-100 truncate">
                              {language === "ar" ? nbr.labelAr : nbr.labelEn}
                            </span>
                          </div>
                          <span className="text-[10px] text-cyan-700 dark:text-cyan-400 font-medium shrink-0">
                            {language === "ar" ? edge.labelAr : edge.labelEn}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 font-mono-num truncate">
                          {og.nodeSingular[nbr.type]} ·{" "}
                          {language === "ar" ? nbr.subtitleAr : nbr.subtitleEn}
                        </div>
                        {isMissing && (
                          <div className="text-[11px] text-orange-700 dark:text-orange-300 mt-1">
                            {og.labels.visibilityGap}
                          </div>
                        )}
                      </button>
                    </div>
                  );
                })}

                {/* Explicit visibility-gap branch for projects missing blocker notes */}
                {selectedProject && selectedBlocker && !selectedBlocker.hasRecordedBlocker && (
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -start-3.5 top-4 w-3 h-px bg-cyan-500/50 dark:bg-cyan-500/40"
                    />
                    <div className="p-2.5 rounded-lg border border-orange-300/70 dark:border-orange-800/70 bg-orange-50/50 dark:bg-orange-950/25 text-xs">
                      <div className="font-semibold text-orange-800 dark:text-orange-300">
                        {og.labels.primaryBlocker}
                      </div>
                      <div className="text-[11px] text-orange-700 dark:text-orange-200 mt-0.5">
                        {og.labels.visibilityGap}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Related Operational Patterns */}
            <div className="pt-2 border-t border-slate-200 dark:border-[#1E293B] space-y-2">
              <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                {og.labels.operationalPatterns}
              </div>
              {relatedPatterns.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {og.labels.noRecordedPatterns}
                </p>
              ) : (
                relatedPatterns.map((pat) => (
                  <div
                    key={pat.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#131E33] space-y-1"
                  >
                    <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                      {language === "ar" ? pat.titleAr : pat.titleEn}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {language === "ar" ? pat.detailAr : pat.detailEn}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: INTERACTIVE IMPACT ANALYSIS + ISOLATED WHAT-IF SCENARIO */}
        {activeTab === "impact" && (
          <div className="space-y-4">
            {impactReport && (
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#131E33] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#0F294A] dark:text-slate-100">
                    {og.labels.operationalImpact}
                  </span>
                  <EpistemicTag kind="calculated" label={t.epistemic.calculatedMetric} />
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {language === "ar" ? impactReport.summaryAr : impactReport.summaryEn}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded bg-white dark:bg-[#0B1324] border border-slate-200 dark:border-[#1E293B]">
                    <div className="text-sm font-bold font-mono-num text-[#0F294A] dark:text-slate-100">
                      {impactReport.affectedProjects.length}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {og.nodeTypes.project}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-white dark:bg-[#0B1324] border border-slate-200 dark:border-[#1E293B]">
                    <div className="text-sm font-bold font-mono-num text-red-700 dark:text-red-400">
                      {impactReport.highOrCriticalCount}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {t.riskLevels.critical}/{t.riskLevels.high}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-white dark:bg-[#0B1324] border border-slate-200 dark:border-[#1E293B]">
                    <div className="text-sm font-bold font-mono-num text-[#0F294A] dark:text-slate-100">
                      {impactReport.totalRemainingHours}h
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {t.workload.activeHours}
                    </div>
                  </div>
                </div>

                {/* Interactive Impacted Deliverables Filter & Traversal */}
                {impactReport.affectedProjects.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-[#1E293B] space-y-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { id: "all", label: og.labels.allImpacted },
                          { id: "critical_high", label: og.labels.criticalHighOnly },
                          { id: "overdue", label: og.labels.overdueFilter },
                          { id: "blocked", label: og.labels.blockedFilter },
                        ] as const
                      ).map((flt) => (
                        <button
                          key={flt.id}
                          type="button"
                          onClick={() => setImpactFilter(flt.id)}
                          className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                            impactFilter === flt.id
                              ? "bg-blue-600 text-white"
                              : "bg-white dark:bg-[#0B1324] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#1E293B] hover:border-blue-500/60"
                          }`}
                        >
                          {flt.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1.5 max-h-[190px] overflow-y-auto pe-0.5">
                      {filteredAffectedProjects.map((ap) => (
                        <div
                          key={ap.project.id}
                          className="p-2 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectNode(ap.project.id)}
                            className="min-w-0 flex-1 text-start cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            <div className="text-xs font-bold text-[#0F294A] dark:text-slate-100 truncate">
                              {ap.project.id} ·{" "}
                              {language === "ar"
                                ? ap.project.titleAr || ap.project.title
                                : ap.project.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num truncate">
                              {language === "ar" ? ap.ownerNameAr : ap.ownerName} ·{" "}
                              {formatDeadlineText(ap.daysUntilDeadline)} · {ap.remainingHours}h
                            </div>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <RiskLevelLabel level={ap.riskLevel} label={`${ap.riskScore}`} />
                            <button
                              type="button"
                              onClick={() => onInspectProject(ap.project)}
                              title={og.actions.inspectProject}
                              aria-label={og.actions.inspectProject}
                              className="p-1 rounded border border-slate-200 dark:border-[#1E293B] text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Impacted Customers */}
                {impactedCustomers.length > 0 && selectedNode.type !== "customer" && (
                  <div className="pt-2 border-t border-slate-200 dark:border-[#1E293B] space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {og.labels.affectedCustomers}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {impactedCustomers.map((cust) => (
                        <button
                          key={cust.id}
                          type="button"
                          onClick={() => {
                            if (graph.nodeMap.has(cust.id)) onSelectNode(cust.id);
                          }}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] text-[11px] font-medium text-[#0F294A] dark:text-slate-200 hover:border-cyan-500/70 cursor-pointer"
                        >
                          {cust.name} ·{" "}
                          <span className="font-mono-num text-cyan-700 dark:text-cyan-400">
                            {cust.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* What-If Scenario Simulation (Isolated, Never Mutates Live Projects) */}
            <div className="p-3.5 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-white dark:bg-[#0B1324] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-[#0F294A] dark:text-slate-100">
                  {og.labels.whatIfTitle}
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {og.labels.scenarioBadge}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {og.labels.scenarioHint}
              </p>

              <div className="grid grid-cols-1 gap-2">
                <label className="block text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-medium block mb-1">{og.labels.selectProjectToMove}</span>
                  <select
                    value={simProjectId}
                    onChange={(e) => handleSimProjectChange(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#0F172A] text-xs text-slate-900 dark:text-slate-100"
                  >
                    {activeProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} — {language === "ar" ? p.titleAr || p.title : p.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-medium block mb-1">{og.labels.selectTargetOwner}</span>
                  <select
                    value={simToEmployeeId}
                    onChange={(e) => setSimToEmployeeId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#0F172A] text-xs text-slate-900 dark:text-slate-100"
                  >
                    {workloads
                      .filter(
                        (w) =>
                          w.employee.id !==
                          activeProjects.find((p) => p.id === simProjectId)?.assignedEmployeeId
                      )
                      .map((w) => (
                        <option key={w.employee.id} value={w.employee.id}>
                          {language === "ar" ? w.employee.nameAr : w.employee.name} (
                          {w.utilizationPct}%)
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              {scenarioResult && (
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-[#1E293B]">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#0F172A]">
                      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {og.labels.currentState}
                      </div>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                        {language === "ar"
                          ? scenarioResult.fromEmployeeNameAr
                          : scenarioResult.fromEmployeeName}
                        :{" "}
                        <span className="font-mono-num text-red-700 dark:text-red-400">
                          {scenarioResult.before.fromUtilizationPct}%
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 font-mono-num mt-0.5">
                        {og.labels.riskScore}: {scenarioResult.before.projectRiskScore}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/40 dark:bg-emerald-950/25">
                      <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                        {og.labels.simulatedState}
                      </div>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 mt-1">
                        {language === "ar"
                          ? scenarioResult.fromEmployeeNameAr
                          : scenarioResult.fromEmployeeName}
                        :{" "}
                        <span className="font-mono-num text-emerald-700 dark:text-emerald-300">
                          {scenarioResult.after.fromUtilizationPct}%
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-700 dark:text-slate-300 font-mono-num mt-0.5">
                        {og.labels.riskScore}: {scenarioResult.after.projectRiskScore} (
                        {language === "ar"
                          ? scenarioResult.toEmployeeNameAr
                          : scenarioResult.toEmployeeName}
                        : {scenarioResult.after.toUtilizationPct}%)
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={
                        scenarioResult.skillMatch
                          ? "text-emerald-700 dark:text-emerald-300 font-medium"
                          : "text-orange-700 dark:text-orange-300 font-medium"
                      }
                    >
                      {scenarioResult.skillMatch
                        ? og.labels.verifiedSkill
                        : og.labels.unverifiedSkill}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSimProjectId(defaultSimProjectId);
                        setSimToEmployeeId(resolveDefaultTargetEmployee(defaultSimProjectId));
                      }}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{og.labels.resetScenario}</span>
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    {og.labels.noMutationNote}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: AI INVESTIGATION WORKSPACE (6-Section Grounded Entity & Graph Analysis) */}
        {activeTab === "ai" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100">
                {og.labels.askPromptLabel}
              </div>
              <EpistemicTag kind="prediction" label={t.epistemic.aiSynthesis} />
            </div>

            {/* Primary Investigate Entity Trigger + Grounded Scope Summary */}
            <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-[#131E33] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#0F294A] dark:text-slate-100">
                  {og.labels.investigationContextLabel}
                </span>
                <span className="text-[11px] font-mono-num text-cyan-700 dark:text-cyan-400">
                  {connectedRelations.length} {og.labels.edgesCount} ·{" "}
                  {impactReport?.affectedProjects.length ?? 0} {og.nodeTypes.project}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                {og.labels.investigateNote}
              </p>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() =>
                  runEntityInvestigation("investigate", og.actions.investigateEntity)
                }
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-55 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <ScanSearch className="w-3.5 h-3.5" />
                <span>{og.actions.investigateEntity}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {og.aiPrompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={aiLoading}
                  onClick={() => runEntityInvestigation(p.id, p.label)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#0B1324] hover:border-cyan-500/70 text-[11px] font-medium text-[#0F294A] dark:text-slate-200 text-start disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {aiLoading && (
              <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/60 dark:bg-blue-950/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-blue-800 dark:text-blue-200">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>{aiStage ?? t.ask.thinking}</span>
                </div>
                <button
                  type="button"
                  onClick={handleStopAi}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-white dark:bg-[#0F172A] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#1E293B] cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  <span>{og.labels.stopAi}</span>
                </button>
              </div>
            )}

            {aiError && (
              <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-300 space-y-2">
                <p>{aiError}</p>
                <button
                  type="button"
                  onClick={() =>
                    runEntityInvestigation(lastPromptId, aiPromptTitle || og.actions.investigateEntity)
                  }
                  className="px-2.5 py-1 rounded bg-white dark:bg-[#0F172A] border border-red-200 dark:border-red-800 text-xs font-semibold cursor-pointer"
                >
                  {og.labels.retryAi}
                </button>
              </div>
            )}

            {aiContent && (
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] space-y-2">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-[#1E293B]">
                  <span className="text-[11px] font-semibold text-[#0F294A] dark:text-slate-200 flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{aiPromptTitle || og.actions.investigateEntity}</span>
                  </span>
                  <EpistemicTag kind="recommendation" label={t.epistemic.aiRecommendation} />
                </div>
                <MarkdownRenderer
                  content={aiContent}
                  dir={language === "ar" ? "rtl" : "ltr"}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB 5: ACTIONS */}
        {activeTab === "actions" && (
          <div className="space-y-3">
            {actionCards.length === 0 ? (
              <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#131E33] text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{t.dashboard.alerts.noAlerts}</span>
              </div>
            ) : (
              actionCards.map((card) => (
                <div
                  key={card.id}
                  className="p-3.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50/70 dark:bg-[#131E33] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <EpistemicTag kind="recommendation" label={t.epistemic.aiRecommendation} />
                    <RiskLevelLabel
                      level={card.priorityLevel}
                      label={`${og.labels.priorityLabel}: ${card.priority}`}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {og.labels.recommendedAction}
                    </div>
                    <p className="text-xs font-semibold text-[#0F294A] dark:text-slate-100 mt-0.5 leading-relaxed">
                      {card.action}
                    </p>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {og.labels.reasonLabel}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                      {card.reason}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {og.labels.affectedEntitiesLabel}:
                    </span>
                    {card.affected.map((aff) => (
                      <button
                        key={aff.id}
                        type="button"
                        onClick={() => onSelectNode(aff.id)}
                        className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-400 hover:underline cursor-pointer"
                      >
                        {aff.label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-[#1E293B]">
                    <span className="font-medium">{og.labels.expectedImpactLabel}: </span>
                    {card.expectedImpact}
                  </div>
                </div>
              ))
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => onNavigate("workload")}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] hover:border-blue-500 text-xs font-medium text-[#0F294A] dark:text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>{og.actions.openWorkload}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate("analyst")}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0B1324] hover:border-blue-500 text-xs font-medium text-[#0F294A] dark:text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{og.actions.openAnalyst}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});
