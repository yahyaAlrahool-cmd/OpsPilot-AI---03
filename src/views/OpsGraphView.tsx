import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Flame,
  Filter,
  Maximize,
  Minimize,
  Monitor,
  Moon,
  Network,
  PanelRightOpen,
  Radar,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import {
  Employee,
  EmployeeWorkloadSummary,
  Language,
  NavSection,
  OperationalIntelligenceReport,
  OperationalMetrics,
  OpsGraphDateRange,
  OpsGraphFilters,
  OpsGraphNodeType,
  Project,
  ProjectRiskAssessment,
  RebalanceSuggestion,
  ThemeMode,
} from "../types";
import { getCopy } from "../i18n/translations";
import {
  buildOpsGraphData,
  computeNodeImpact,
  DEFAULT_OPSGRAPH_FILTERS,
  getPrioritizedGraphEntities,
} from "../utils/opsGraph";
import { OpsGraphCanvas } from "../components/OpsGraphCanvas";
import { OpsGraphPanel, OpsGraphPanelTab } from "../components/OpsGraphPanel";

interface OpsGraphViewProps {
  language: Language;
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  projects: Project[];
  employees: Employee[];
  metrics: OperationalMetrics;
  workloads: EmployeeWorkloadSummary[];
  risks: ProjectRiskAssessment[];
  rebalanceSuggestions: RebalanceSuggestion[];
  intelligence: OperationalIntelligenceReport;
  projectsSignature: string;
  onInspectProject: (project: Project) => void;
  onNavigate: (section: NavSection) => void;
}

export const OpsGraphView = React.memo(function OpsGraphView({
  language,
  themeMode,
  onSetThemeMode,
  projects,
  employees,
  metrics,
  workloads,
  risks,
  rebalanceSuggestions,
  intelligence,
  projectsSignature,
  onInspectProject,
  onNavigate,
}: OpsGraphViewProps) {
  const t = getCopy(language);
  const og = t.opsgraph;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [filters, setFilters] = useState<OpsGraphFilters>(DEFAULT_OPSGRAPH_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => intelligence.immediateAttention[0]?.projectId ?? projects[0]?.id ?? null
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [neighborFocusId, setNeighborFocusId] = useState<string | null>(null);
  const [traceActive, setTraceActive] = useState(false);
  const [activeTab, setActiveTab] = useState<OpsGraphPanelTab>("overview");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [focusRequestTick, setFocusRequestTick] = useState(0);
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);

  // Fullscreen state (native Fullscreen API with seamless CSS fallback if blocked in iFrame)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchFocused(false);
        if (isFullscreen && !document.fullscreenElement) {
          setIsFullscreen(false);
        }
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKeyDown);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [isFullscreen]);

  const handleToggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (rootRef.current?.requestFullscreen) {
          await rootRef.current.requestFullscreen();
        }
      } catch {
        // CSS fixed fullscreen fallback stays active cleanly inside iFrames
      }
    } else {
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch {
        // ignore
      }
    }
  };

  // Build grounded graph data (memoized against projects, employees, filters, expanded nodes)
  const fullGraph = useMemo(
    () =>
      buildOpsGraphData(
        projects,
        employees,
        workloads,
        risks,
        intelligence,
        filters,
        expandedNodeIds
      ),
    [projects, employees, workloads, risks, intelligence, filters, expandedNodeIds]
  );

  // Optional neighbor-only collapse around a focused node
  const visibleGraph = useMemo(() => {
    if (!neighborFocusId || !fullGraph.nodeMap.has(neighborFocusId)) {
      return fullGraph;
    }
    const keepIds = new Set<string>([neighborFocusId]);
    const nbrs = fullGraph.adjacency.get(neighborFocusId);
    if (nbrs) {
      for (const n of nbrs) keepIds.add(n);
    }
    const nodes = fullGraph.nodes.filter((n) => keepIds.has(n.id));
    const edges = fullGraph.edges.filter(
      (e) => keepIds.has(e.source) && keepIds.has(e.target)
    );
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();
    for (const n of nodes) adjacency.set(n.id, new Set());
    for (const e of edges) {
      adjacency.get(e.source)?.add(e.target);
      adjacency.get(e.target)?.add(e.source);
    }
    return {
      ...fullGraph,
      nodes,
      edges,
      nodeMap,
      adjacency,
    };
  }, [fullGraph, neighborFocusId]);

  // Ensure selectedNodeId stays valid under dynamic filters
  useEffect(() => {
    if (selectedNodeId && !visibleGraph.nodeMap.has(selectedNodeId)) {
      setSelectedNodeId(visibleGraph.nodes[0]?.id ?? null);
      setTraceActive(false);
    } else if (!selectedNodeId && visibleGraph.nodes.length > 0) {
      setSelectedNodeId(
        intelligence.immediateAttention[0]?.projectId ?? visibleGraph.nodes[0].id
      );
    }
  }, [selectedNodeId, visibleGraph, intelligence.immediateAttention]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? visibleGraph.nodeMap.get(selectedNodeId) ?? null : null),
    [selectedNodeId, visibleGraph.nodeMap]
  );

  const impactReport = useMemo(() => {
    if (!selectedNode) return null;
    return computeNodeImpact(
      selectedNode,
      visibleGraph,
      projects,
      employees,
      workloads,
      risks
    );
  }, [selectedNode, visibleGraph, projects, employees, workloads, risks]);

  const prioritizedEntities = useMemo(
    () => getPrioritizedGraphEntities(visibleGraph, 5),
    [visibleGraph]
  );

  // Search matches across fullGraph (instant lightweight token matching; does not rebuild graph)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return fullGraph.nodes
      .filter((n) => n.searchTokens.includes(q))
      .slice(0, 8);
  }, [searchQuery, fullGraph.nodes]);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setExpandedNodeIds((prev) => {
      if (prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, []);

  const handleActivateTrace = useCallback(() => {
    setTraceActive(true);
  }, []);

  const handleToggleTrace = useCallback(() => {
    setTraceActive((v) => !v);
  }, []);

  const handleSearchPick = (nodeId: string) => {
    setSearchQuery("");
    setSearchFocused(false);
    setNeighborFocusId(null);
    handleSelectNode(nodeId);
    setFocusTargetId(nodeId);
    setFocusRequestTick((c) => c + 1);
  };

  const handleSelectPriorityEntity = (nodeId: string) => {
    setNeighborFocusId(null);
    handleSelectNode(nodeId);
    setTraceActive(true);
    setFocusTargetId(nodeId);
    setFocusRequestTick((c) => c + 1);
  };

  const handleFocusPattern = (kind: "concentration" | "deadline_collision" | "capacity" | "blockers") => {
    setNeighborFocusId(null);
    let targetId: string | null = null;
    if (kind === "concentration" || kind === "capacity") {
      const topOverloaded = workloads.find((w) => w.capacityStatus === "overloaded");
      if (topOverloaded && visibleGraph.nodeMap.has(`emp:${topOverloaded.employee.id}`)) {
        targetId = `emp:${topOverloaded.employee.id}`;
      }
    } else if (kind === "deadline_collision") {
      if (visibleGraph.nodeMap.has("dl:overdue")) targetId = "dl:overdue";
      else if (visibleGraph.nodeMap.has("dl:due_soon")) targetId = "dl:due_soon";
    } else if (kind === "blockers") {
      const firstBlk = visibleGraph.nodes.find((n) => n.type === "blocker");
      if (firstBlk) targetId = firstBlk.id;
    }
    if (!targetId) {
      targetId = intelligence.immediateAttention[0]?.projectId ?? visibleGraph.nodes[0]?.id ?? null;
    }
    if (targetId) {
      handleSelectNode(targetId);
      setTraceActive(true);
      setActiveTab("impact");
      setFocusTargetId(targetId);
      setFocusRequestTick((c) => c + 1);
    }
  };

  const handleRefreshIntelligence = () => {
    setRefreshSpin(true);
    setNeighborFocusId(null);
    setExpandedNodeIds(new Set());
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshSpin(false), 360);
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_OPSGRAPH_FILTERS);
    setNeighborFocusId(null);
    setExpandedNodeIds(new Set());
    setTraceActive(false);
  };

  const toggleNodeType = (type: OpsGraphNodeType) => {
    setFilters((prev) => ({
      ...prev,
      types: { ...prev.types, [type]: !prev.types[type] },
    }));
  };

  const themeOptions: Array<{ id: ThemeMode; label: string; Icon: React.ElementType }> = [
    { id: "light", label: t.topbar.themeModes.light, Icon: Sun },
    { id: "dark", label: t.topbar.themeModes.dark, Icon: Moon },
    { id: "system", label: t.topbar.themeModes.system, Icon: Monitor },
  ];

  const activeFilterCount =
    Object.values(filters.types).filter((v) => !v).length +
    (filters.criticalOnly ? 1 : 0) +
    (filters.overdueOnly ? 1 : 0) +
    (filters.highUtilizationOnly ? 1 : 0) +
    (filters.upcomingDeadlinesOnly ? 1 : 0) +
    (!filters.showDependencies ? 1 : 0) +
    (filters.dateRange !== "all" ? 1 : 0);

  return (
    <div
      ref={rootRef}
      className={`flex flex-col gap-3 ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-[#F8FAFC] dark:bg-[#070D19] p-4 sm:p-5 overflow-y-auto"
          : "min-h-[calc(100dvh-118px)]"
      }`}
    >
      {/* Top Command Bar */}
      <section className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E293B] rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Title & Graph Search */}
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-[#0F294A] dark:bg-blue-600/90 text-white flex items-center justify-center">
                <Network className="w-4 h-4 text-cyan-300 dark:text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-[#0F294A] dark:text-slate-100 leading-tight">
                  {og.title}
                </h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                  {og.subtitle}
                </p>
              </div>
            </div>

            {/* Global Graph Search */}
            <div className="relative flex-1 min-w-[210px] max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={og.searchPlaceholder}
                aria-label={og.searchPlaceholder}
                className="w-full ps-8 pe-8 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#070D19] text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {searchFocused && searchQuery.trim() && (
                <div className="absolute z-40 mt-1 w-full rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#131E33] shadow-lg overflow-hidden">
                  {searchResults.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {og.noSearchResults}
                    </div>
                  ) : (
                    searchResults.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSearchPick(res.id);
                        }}
                        className="w-full px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-[#1A2842] border-b last:border-b-0 border-slate-100 dark:border-[#1E293B] flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#0F294A] dark:text-slate-100 truncate">
                            {language === "ar" ? res.labelAr : res.labelEn}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {language === "ar" ? res.subtitleAr : res.subtitleEn}
                          </div>
                        </div>
                        <span className="text-[10px] font-medium text-cyan-700 dark:text-cyan-400 shrink-0">
                          {og.nodeSingular[res.type]}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Command Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={filters.dateRange}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  dateRange: e.target.value as OpsGraphDateRange,
                }))
              }
              aria-label={og.dateRanges.all}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#070D19] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {(["all", "7d", "14d", "30d"] as const).map((r) => (
                <option key={r} value={r}>
                  {og.dateRanges[r]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filtersOpen || activeFilterCount > 0
                  ? "bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"
                  : "bg-slate-50 dark:bg-[#070D19] border-slate-200 dark:border-[#1E293B] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#131E33]"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{og.filtersLabel}</span>
              {activeFilterCount > 0 && (
                <span className="font-mono-num text-[11px] font-bold">({activeFilterCount})</span>
              )}
            </button>

            {/* Theme control integrated directly with App.tsx useTheme */}
            <div
              role="group"
              aria-label={t.topbar.themeLabel}
              className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-[#070D19] border border-slate-200 dark:border-[#1E293B]"
            >
              {themeOptions.map((opt) => {
                const selected = themeMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSetThemeMode(opt.id)}
                    aria-pressed={selected}
                    aria-label={`${t.topbar.themeLabel}: ${opt.label}`}
                    title={opt.label}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      selected
                        ? "bg-white dark:bg-[#131E33] text-[#0F294A] dark:text-slate-100 shadow-xs"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    <opt.Icon className="w-3.5 h-3.5" />
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleRefreshIntelligence}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#070D19] hover:bg-slate-100 dark:hover:bg-[#131E33] text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              title={og.actions.refresh}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshSpin ? "animate-spin" : ""}`} />
              <span className="hidden xl:inline">{og.actions.refresh}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#070D19] hover:bg-slate-100 dark:hover:bg-[#131E33] text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              aria-label={isFullscreen ? og.actions.exitFullscreen : og.actions.fullscreen}
              title={isFullscreen ? og.actions.exitFullscreen : og.actions.fullscreen}
            >
              {isFullscreen ? (
                <Minimize className="w-3.5 h-3.5" />
              ) : (
                <Maximize className="w-3.5 h-3.5" />
              )}
              <span className="hidden xl:inline">
                {isFullscreen ? og.actions.exitFullscreen : og.actions.fullscreen}
              </span>
            </button>

            {/* Tablet Slide-over Toggle */}
            <button
              type="button"
              onClick={() => setMobilePanelOpen((v) => !v)}
              className="hidden md:inline-flex lg:hidden items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PanelRightOpen className="w-3.5 h-3.5" />
              <span>{og.actions.openPanel}</span>
            </button>
          </div>
        </div>

        {/* Critical Priority Queue Strip — Intelligent Prioritization */}
        {prioritizedEntities.length > 0 && (
          <div className="pt-2 border-t border-slate-200 dark:border-[#1E293B] flex items-center gap-2 overflow-x-auto no-scrollbar">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
              <Flame className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              <span>{og.labels.priorityQueueLabel}:</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              {prioritizedEntities.map((item) => {
                const isSelected = selectedNodeId === item.id;
                const isCritical = item.severity === "critical";
                const metricText =
                  item.riskScore !== undefined
                    ? `${item.riskScore}`
                    : item.utilizationPct !== undefined
                    ? `${item.utilizationPct}%`
                    : og.nodeSingular[item.type];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectPriorityEntity(item.id)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-blue-600 text-white border-blue-600"
                        : isCritical
                        ? "bg-red-50/70 dark:bg-[#1A1320] border-red-200 dark:border-red-900/60 text-[#0F294A] dark:text-slate-100 hover:border-blue-500"
                        : "bg-orange-50/70 dark:bg-[#1B1816] border-orange-200 dark:border-orange-900/60 text-[#0F294A] dark:text-slate-100 hover:border-blue-500"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isSelected
                          ? "bg-cyan-300"
                          : isCritical
                          ? "bg-red-600 dark:bg-red-400"
                          : "bg-orange-500 dark:bg-orange-400"
                      }`}
                    />
                    <span className="truncate max-w-[155px]">
                      {language === "ar" ? item.labelAr : item.labelEn}
                    </span>
                    <span
                      className={`font-mono-num text-[10px] font-bold ${
                        isSelected
                          ? "text-cyan-200"
                          : isCritical
                          ? "text-red-700 dark:text-red-400"
                          : "text-orange-700 dark:text-orange-400"
                      }`}
                    >
                      {metricText}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Expanded Filter Drawer */}
        {filtersOpen && (
          <div className="pt-2.5 border-t border-slate-200 dark:border-[#1E293B] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                ["project", "employee", "customer", "risk", "blocker", "deadline"] as const
              ).map((typeKey) => {
                const on = filters.types[typeKey];
                return (
                  <button
                    key={typeKey}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleNodeType(typeKey)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                      on
                        ? "bg-[#0F294A] dark:bg-blue-600 text-white border-[#0F294A] dark:border-blue-600"
                        : "bg-slate-50 dark:bg-[#070D19] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#1E293B]"
                    }`}
                  >
                    {og.nodeTypes[typeKey]}
                  </button>
                );
              })}

              <button
                type="button"
                aria-pressed={filters.showDependencies}
                onClick={() =>
                  setFilters((p) => ({ ...p, showDependencies: !p.showDependencies }))
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                  filters.showDependencies
                    ? "bg-[#0F294A] dark:bg-blue-600 text-white border-[#0F294A] dark:border-blue-600"
                    : "bg-slate-50 dark:bg-[#070D19] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#1E293B]"
                }`}
              >
                {og.conditions.dependencies}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: "criticalOnly", label: og.conditions.criticalOnly },
                  { key: "overdueOnly", label: og.conditions.overdueOnly },
                  { key: "highUtilizationOnly", label: og.conditions.highUtilization },
                  { key: "upcomingDeadlinesOnly", label: og.conditions.upcomingDeadlines },
                ] as const
              ).map((cond) => {
                const on = filters[cond.key];
                return (
                  <button
                    key={cond.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setFilters((prev) => ({ ...prev, [cond.key]: !prev[cond.key] }))
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                      on
                        ? "bg-orange-600 text-white border-orange-600"
                        : "bg-white dark:bg-[#070D19] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#1E293B] hover:bg-slate-50 dark:hover:bg-[#131E33]"
                    }`}
                  >
                    {cond.label}
                  </button>
                );
              })}

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap cursor-pointer"
                >
                  {og.actions.resetFilters}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Main Split Workspace: Desktop Canvas + Right Intelligence Panel; Mobile prioritizes Selected Entity Intelligence */}
      <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-[540px]">
        {/* Mobile Priority Order: Selected Entity Intelligence Panel first on <md */}
        <div className="md:hidden order-1">
          <OpsGraphPanel
            language={language}
            graph={visibleGraph}
            selectedNode={selectedNode}
            impactReport={impactReport}
            traceActive={traceActive}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSelectNode={handleSelectNode}
            onToggleTraceImpact={handleToggleTrace}
            onActivateTrace={handleActivateTrace}
            onInspectProject={onInspectProject}
            onNavigate={onNavigate}
            projects={projects}
            employees={employees}
            metrics={metrics}
            workloads={workloads}
            risks={risks}
            rebalanceSuggestions={rebalanceSuggestions}
            intelligence={intelligence}
            projectsSignature={projectsSignature}
          />
        </div>

        {/* Graph Canvas (Main focal area on Desktop/Tablet; compact simplified network on Mobile) */}
        <div className="flex-1 min-w-0 order-2 lg:order-1">
          <OpsGraphCanvas
            language={language}
            graph={visibleGraph}
            selectedNodeId={selectedNodeId}
            tracedImpact={impactReport}
            traceActive={traceActive}
            collapsedSecondary={filters.collapsedSecondary}
            hasNeighborFocus={Boolean(neighborFocusId)}
            onSelectNode={(id) => {
              handleSelectNode(id);
              if (window.innerWidth >= 768 && window.innerWidth < 1024) {
                setMobilePanelOpen(true);
              }
            }}
            onToggleCollapseSecondary={() =>
              setFilters((p) => ({ ...p, collapsedSecondary: !p.collapsedSecondary }))
            }
            onToggleNeighborFocus={() =>
              setNeighborFocusId((cur) => (cur ? null : selectedNodeId))
            }
            onResetFilters={handleResetFilters}
            focusRequestTick={focusRequestTick}
            focusTargetId={focusTargetId}
          />
        </div>

        {/* Desktop Right Intelligence Panel */}
        <div className="hidden lg:block lg:w-[400px] xl:w-[430px] shrink-0 lg:order-2 max-h-[720px]">
          <OpsGraphPanel
            language={language}
            graph={visibleGraph}
            selectedNode={selectedNode}
            impactReport={impactReport}
            traceActive={traceActive}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSelectNode={handleSelectNode}
            onToggleTraceImpact={handleToggleTrace}
            onActivateTrace={handleActivateTrace}
            onInspectProject={onInspectProject}
            onNavigate={onNavigate}
            projects={projects}
            employees={employees}
            metrics={metrics}
            workloads={workloads}
            risks={risks}
            rebalanceSuggestions={rebalanceSuggestions}
            intelligence={intelligence}
            projectsSignature={projectsSignature}
          />
        </div>

        {/* Tablet Collapsible Drawer Intelligence Panel */}
        {mobilePanelOpen && (
          <div className="hidden md:flex lg:hidden fixed inset-0 z-50 justify-end">
            <div
              className="fixed inset-0 bg-slate-900/50 dark:bg-black/65"
              onClick={() => setMobilePanelOpen(false)}
            />
            <div className="relative z-10 w-[410px] max-w-[90vw] h-full p-3 bg-[#F8FAFC] dark:bg-[#070D19]">
              <OpsGraphPanel
                language={language}
                graph={visibleGraph}
                selectedNode={selectedNode}
                impactReport={impactReport}
                traceActive={traceActive}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onSelectNode={handleSelectNode}
                onToggleTraceImpact={handleToggleTrace}
                onActivateTrace={handleActivateTrace}
                onInspectProject={onInspectProject}
                onNavigate={onNavigate}
                onCloseMobile={() => setMobilePanelOpen(false)}
                projects={projects}
                employees={employees}
                metrics={metrics}
                workloads={workloads}
                risks={risks}
                rebalanceSuggestions={rebalanceSuggestions}
                intelligence={intelligence}
                projectsSignature={projectsSignature}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Intelligence Strip — Grounded Operational Patterns */}
      <section className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-[#1E293B] rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
            <h2 className="text-xs font-bold text-[#0F294A] dark:text-slate-100">
              {og.bottomStrip.title}
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
              — {og.bottomStrip.subtitle}
            </span>
          </div>
        </div>

        {intelligence.proactiveInsights.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {og.bottomStrip.noPatterns}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {intelligence.proactiveInsights.map((ins) => {
              const borderClass =
                ins.severity === "critical"
                  ? "border-red-200/90 dark:border-red-900/70"
                  : ins.severity === "warning"
                  ? "border-orange-200/90 dark:border-orange-900/70"
                  : "border-slate-200 dark:border-[#1E293B]";
              return (
                <button
                  key={ins.id}
                  type="button"
                  onClick={() => handleFocusPattern(ins.kind)}
                  className={`p-3 rounded-lg border ${borderClass} bg-slate-50/70 dark:bg-[#131E33] hover:border-blue-500/70 text-start transition-colors cursor-pointer`}
                >
                  <div className="text-xs font-bold text-[#0F294A] dark:text-slate-100 truncate">
                    {language === "ar" ? ins.titleAr : ins.titleEn}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                    {language === "ar" ? ins.detailAr : ins.detailEn}
                  </p>
                  <div className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400 mt-1.5 truncate">
                    {language === "ar" ? ins.evidenceAr : ins.evidenceEn}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
});
