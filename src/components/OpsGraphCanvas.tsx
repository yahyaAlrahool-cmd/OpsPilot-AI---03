import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CalendarClock,
  Expand,
  FolderKanban,
  Link2Off,
  Maximize2,
  Minimize2,
  RotateCcw,
  Shrink,
  User,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Language,
  NodeImpactReport,
  OpsGraphData,
  OpsGraphEdge,
  OpsGraphNode,
  OpsGraphNodeType,
} from "../types";
import { getCopy } from "../i18n/translations";

interface OpsGraphCanvasProps {
  language: Language;
  graph: OpsGraphData;
  selectedNodeId: string | null;
  tracedImpact: NodeImpactReport | null;
  traceActive: boolean;
  collapsedSecondary: boolean;
  hasNeighborFocus: boolean;
  onSelectNode: (nodeId: string) => void;
  onToggleCollapseSecondary: () => void;
  onToggleNeighborFocus: () => void;
  onResetFilters: () => void;
  focusRequestTick: number;
  focusTargetId: string | null;
}

const NODE_WIDTH = 200;
const NODE_HALF_W = NODE_WIDTH / 2;
const NODE_HALF_H = 30;

function nodeTypeIcon(type: OpsGraphNodeType) {
  switch (type) {
    case "project":
      return FolderKanban;
    case "employee":
      return User;
    case "customer":
      return Building2;
    case "blocker":
      return Link2Off;
    case "deadline":
      return CalendarClock;
    case "risk":
      return AlertTriangle;
  }
}

function severityAccent(severity: OpsGraphNode["severity"]) {
  switch (severity) {
    case "critical":
      return {
        border: "border-red-500/85 dark:border-red-500/80",
        ring: "ring-2 ring-red-500/40",
        badge: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/70",
        dot: "#DC2626",
        edge: "#EF4444",
      };
    case "high":
      return {
        border: "border-orange-500/85 dark:border-orange-500/75",
        ring: "ring-2 ring-orange-500/35",
        badge: "text-orange-800 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/70",
        dot: "#EA580C",
        edge: "#F97316",
      };
    case "medium":
      return {
        border: "border-blue-500/75 dark:border-blue-500/65",
        ring: "ring-2 ring-blue-500/30",
        badge: "text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70",
        dot: "#2563EB",
        edge: "#06B6D4",
      };
    case "low":
      return {
        border: "border-emerald-500/65 dark:border-emerald-500/55",
        ring: "ring-2 ring-emerald-500/30",
        badge: "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60",
        dot: "#16A34A",
        edge: "#06B6D4",
      };
    default:
      return {
        border: "border-slate-300 dark:border-slate-700",
        ring: "ring-2 ring-cyan-500/35",
        badge: "text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800",
        dot: "#0891B2",
        edge: "#06B6D4",
      };
  }
}

export const OpsGraphCanvas = React.memo(function OpsGraphCanvas({
  language,
  graph,
  selectedNodeId,
  tracedImpact,
  traceActive,
  collapsedSecondary,
  hasNeighborFocus,
  onSelectNode,
  onToggleCollapseSecondary,
  onToggleNeighborFocus,
  onResetFilters,
  focusRequestTick,
  focusTargetId,
}: OpsGraphCanvasProps) {
  const t = getCopy(language);
  const og = t.opsgraph;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(0.86);
  const [pan, setPan] = useState({ x: 24, y: 18 });
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const dragStateRef = useRef<
    | { kind: "pan"; startX: number; startY: number; origX: number; origY: number }
    | {
        kind: "node";
        nodeId: string;
        startX: number;
        startY: number;
        origDx: number;
        origDy: number;
        moved: boolean;
      }
    | null
  >(null);

  const getPos = useCallback(
    (n: OpsGraphNode) => {
      const off = nodeOffsets[n.id];
      return off ? { x: n.x + off.dx, y: n.y + off.dy } : { x: n.x, y: n.y };
    },
    [nodeOffsets]
  );

  // Bounding box of graph for fitView & minimap
  const bounds = useMemo(() => {
    if (graph.nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 1160, maxY: 660, width: 1160, height: 660 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of graph.nodes) {
      const p = getPos(n);
      minX = Math.min(minX, p.x - NODE_HALF_W - 30);
      maxX = Math.max(maxX, p.x + NODE_HALF_W + 30);
      minY = Math.min(minY, p.y - NODE_HALF_H - 30);
      maxY = Math.max(maxY, p.y + NODE_HALF_H + 30);
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(400, maxX - minX),
      height: Math.max(320, maxY - minY),
    };
  }, [graph.nodes, getPos]);

  const fitGraphToViewport = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el || graph.nodes.length === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return false;

    const scaleX = (rect.width - 40) / bounds.width;
    const scaleY = (rect.height - 40) / bounds.height;
    const nextZoom = Math.max(0.45, Math.min(1.05, Math.min(scaleX, scaleY)));
    const nextX = Math.round((rect.width - bounds.width * nextZoom) / 2 - bounds.minX * nextZoom);
    const nextY = Math.round((rect.height - bounds.height * nextZoom) / 2 - bounds.minY * nextZoom);

    setZoom(+nextZoom.toFixed(2));
    setPan({ x: nextX, y: nextY });
    return true;
  }, [bounds, graph.nodes.length]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = graph.nodeMap.get(nodeId);
      const el = containerRef.current;
      if (!node || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 100) return;
      const pos = getPos(node);
      const targetZoom = Math.max(zoom, 0.98);
      setZoom(targetZoom);
      setPan({
        x: Math.round(rect.width / 2 - pos.x * targetZoom),
        y: Math.round(rect.height / 2 - pos.y * targetZoom),
      });
    },
    [graph.nodeMap, getPos, zoom]
  );

  // Auto-fit once container becomes visible & when explicit fit/focus requested
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (!didInitialFitRef.current && graph.nodes.length > 0) {
      if (fitGraphToViewport()) {
        didInitialFitRef.current = true;
      }
    }
  }, [fitGraphToViewport, graph.nodes.length]);

  useEffect(() => {
    if (focusRequestTick > 0 && focusTargetId) {
      focusNode(focusTargetId);
    }
  }, [focusRequestTick, focusTargetId, focusNode]);

  // Refit cleanly on container resize (debounced lightly via rAF without thrashing)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!didInitialFitRef.current) {
          if (fitGraphToViewport()) {
            didInitialFitRef.current = true;
          }
          return;
        }
        // Keep viewport centered smoothly only if user hasn't dragged custom offsets
        if (Object.keys(nodeOffsets).length === 0 && !selectedNodeId) {
          fitGraphToViewport();
        }
      });
    });
    observer.observe(el);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [fitGraphToViewport, nodeOffsets, selectedNodeId]);

  const handleResetLayout = () => {
    setNodeOffsets({});
    setTimeout(() => {
      fitGraphToViewport();
    }, 0);
  };

  const handlePointerDownCanvas = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-opsgraph-node]")) return;
    dragStateRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerDownNode = (e: React.PointerEvent<HTMLButtonElement>, nodeId: string) => {
    e.stopPropagation();
    const cur = nodeOffsets[nodeId] ?? { dx: 0, dy: 0 };
    dragStateRef.current = {
      kind: "node",
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      origDx: cur.dx,
      origDy: cur.dy,
      moved: false,
    };
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const st = dragStateRef.current;
    if (!st) return;
    if (st.kind === "pan") {
      setPan({
        x: Math.round(st.origX + (e.clientX - st.startX)),
        y: Math.round(st.origY + (e.clientY - st.startY)),
      });
    } else if (st.kind === "node") {
      const dxDelta = (e.clientX - st.startX) / zoom;
      const dyDelta = (e.clientY - st.startY) / zoom;
      if (Math.abs(dxDelta) > 3 || Math.abs(dyDelta) > 3) {
        st.moved = true;
      }
      setNodeOffsets((prev) => ({
        ...prev,
        [st.nodeId]: {
          dx: Math.round(st.origDx + dxDelta),
          dy: Math.round(st.origDy + dyDelta),
        },
      }));
    }
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((prev) => +Math.max(0.42, Math.min(1.85, prev + delta)).toFixed(2));
  };

  const activeNodeSet = useMemo(() => {
    const set = new Set<string>();
    if (traceActive && tracedImpact) {
      for (const id of tracedImpact.tracedNodeIds) set.add(id);
    } else if (selectedNodeId) {
      set.add(selectedNodeId);
      const neighbors = graph.adjacency.get(selectedNodeId);
      if (neighbors) {
        for (const n of neighbors) set.add(n);
      }
    }
    if (hoveredNodeId) {
      set.add(hoveredNodeId);
      const hoverNeighbors = graph.adjacency.get(hoveredNodeId);
      if (hoverNeighbors) {
        for (const n of hoverNeighbors) set.add(n);
      }
    }
    if (!selectedNodeId && !hoveredNodeId) return null;
    return set;
  }, [traceActive, tracedImpact, selectedNodeId, hoveredNodeId, graph.adjacency]);

  const activeEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (traceActive && tracedImpact) {
      for (const id of tracedImpact.tracedEdgeIds) set.add(id);
    } else if (selectedNodeId) {
      for (const e of graph.edges) {
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          set.add(e.id);
        }
      }
    }
    if (hoveredNodeId) {
      for (const e of graph.edges) {
        if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
          set.add(e.id);
        }
      }
    }
    if (!selectedNodeId && !hoveredNodeId) return null;
    return set;
  }, [traceActive, tracedImpact, selectedNodeId, hoveredNodeId, graph.edges]);

  const hoveredNode = hoveredNodeId ? graph.nodeMap.get(hoveredNodeId) ?? null : null;
  const hoveredEdgeCount = hoveredNodeId ? graph.adjacency.get(hoveredNodeId)?.size ?? 0 : 0;

  // Empty state when filters or data lack relationships
  if (graph.nodes.length === 0 || graph.edges.length === 0) {
    return (
      <div className="h-full min-h-[420px] rounded-xl border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#070D19] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 flex items-center justify-center mb-4">
          <AlertCircle className="w-5 h-5 text-slate-500 dark:text-slate-400" />
        </div>
        <h3 className="text-base font-semibold text-[#0F294A] dark:text-slate-100">
          {og.emptyState.title}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mt-1.5 leading-relaxed">
          {og.emptyState.description}
        </p>
        {(language === "ar" ? graph.missingDataSummaryAr : graph.missingDataSummaryEn).length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 max-w-md">
            {og.emptyState.missingPrefix}{" "}
            {(language === "ar" ? graph.missingDataSummaryAr : graph.missingDataSummaryEn)
              .slice(0, 3)
              .join(" · ")}
          </p>
        )}
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
        >
          {og.actions.resetFilters}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col rounded-xl border border-slate-200 dark:border-[#1E293B] bg-[#F1F5F9] dark:bg-[#070D19] overflow-hidden select-none">
      {/* Desktop / Tablet Interactive SVG+HTML Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDownCanvas}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        className="hidden md:block relative flex-1 min-h-[540px] overflow-hidden cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(148,163,184,0.2) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* Top-Start Legend Strip */}
        <div className="absolute top-3 start-3 z-20 flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-white/95 dark:bg-[#0F172A]/95 border border-slate-200 dark:border-[#1E293B] text-[11px] text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-[#0F294A] dark:text-slate-100 font-mono-num">
            {graph.nodes.length} {og.labels.nodesCount} · {graph.edges.length} {og.labels.edgesCount}
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">|</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-red-600 dark:bg-red-500" aria-hidden="true" />
            <span>{og.labels.criticalLegend}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-orange-600 dark:bg-orange-500" aria-hidden="true" />
            <span>{og.labels.highLegend}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-600 dark:bg-cyan-400" aria-hidden="true" />
            <span>{og.labels.relationshipLegend}</span>
          </span>
        </div>

        {/* Top-End Graph Toolbar Controls */}
        <div className="absolute top-3 end-3 z-20 flex items-center gap-1.5">
          {selectedNodeId && (
            <button
              type="button"
              onClick={onToggleNeighborFocus}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                hasNeighborFocus
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white/95 dark:bg-[#0F172A]/95 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1E293B] hover:bg-slate-50 dark:hover:bg-[#131E33]"
              }`}
            >
              {hasNeighborFocus ? (
                <>
                  <Expand className="w-3.5 h-3.5" />
                  <span>{og.actions.expandNeighbors}</span>
                </>
              ) : (
                <>
                  <Shrink className="w-3.5 h-3.5" />
                  <span>{og.actions.collapseNeighbors}</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleCollapseSecondary}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              collapsedSecondary
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white/95 dark:bg-[#0F172A]/95 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1E293B] hover:bg-slate-50 dark:hover:bg-[#131E33]"
            }`}
          >
            {collapsedSecondary ? (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>{og.actions.expandAll}</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>{og.actions.collapsePriority}</span>
              </>
            )}
          </button>

          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white/95 dark:bg-[#0F172A]/95 overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => +Math.max(0.42, z - 0.12).toFixed(2))}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#131E33] cursor-pointer"
              aria-label={og.actions.zoomOut}
              title={og.actions.zoomOut}
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 text-[11px] font-mono-num text-slate-600 dark:text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => +Math.min(1.85, z + 0.12).toFixed(2))}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#131E33] cursor-pointer"
              aria-label={og.actions.zoomIn}
              title={og.actions.zoomIn}
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetLayout}
              className="p-1.5 border-s border-slate-200 dark:border-[#1E293B] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#131E33] cursor-pointer"
              aria-label={og.actions.resetLayout}
              title={og.actions.resetLayout}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Transformed Graph Stage (fixed dir="ltr" coordinate system for exact SVG/HTML alignment) */}
        <div
          dir="ltr"
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            width: `${bounds.maxX + 140}px`,
            height: `${bounds.maxY + 120}px`,
          }}
        >
          {/* SVG Connections Layer */}
          <svg
            width={bounds.maxX + 140}
            height={bounds.maxY + 120}
            className="absolute inset-0 pointer-events-none overflow-visible"
          >
            <defs>
              <marker
                id="ops-arrow-default"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
              </marker>
              <marker
                id="ops-arrow-critical"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#EF4444" />
              </marker>
              <marker
                id="ops-arrow-high"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#F97316" />
              </marker>
              <marker
                id="ops-arrow-cyan"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#06B6D4" />
              </marker>
            </defs>

            {graph.edges.map((edge: OpsGraphEdge) => {
              const sNode = graph.nodeMap.get(edge.source);
              const tNode = graph.nodeMap.get(edge.target);
              if (!sNode || !tNode) return null;

              const sPos = getPos(sNode);
              const tPos = getPos(tNode);

              const isRelated = edge.kind === "related_project";
              let x1 = sPos.x;
              let y1 = sPos.y;
              let x2 = tPos.x;
              let y2 = tPos.y;
              let d = "";

              if (isRelated) {
                // Smooth side arc connecting two projects in the same column
                x1 = sPos.x - NODE_HALF_W;
                x2 = tPos.x - NODE_HALF_W;
                const arcPull = Math.min(85, Math.max(40, Math.abs(y2 - y1) * 0.35));
                d = `M ${x1} ${y1} C ${x1 - arcPull} ${y1}, ${x2 - arcPull} ${y2}, ${x2} ${y2}`;
              } else {
                const forward = tPos.x >= sPos.x;
                x1 = sPos.x + (forward ? NODE_HALF_W : -NODE_HALF_W);
                x2 = tPos.x + (forward ? -NODE_HALF_W : NODE_HALF_W);
                const dx = Math.abs(x2 - x1) * 0.45;
                d = `M ${x1} ${y1} C ${x1 + (forward ? dx : -dx)} ${y1}, ${
                  x2 + (forward ? -dx : dx)
                } ${y2}, ${x2} ${y2}`;
              }

              const isHighlighted = activeEdgeSet ? activeEdgeSet.has(edge.id) : false;
              const isDimmed = activeEdgeSet ? !isHighlighted : false;

              // Highlighted operational relationship edges use Cyan for neutral/dependency links, Red for critical, Orange for high
              const strokeColor = isHighlighted
                ? edge.severity === "critical"
                  ? "#EF4444"
                  : edge.severity === "high"
                  ? "#F97316"
                  : "#06B6D4"
                : edge.severity === "critical"
                ? "rgba(239,68,68,0.45)"
                : edge.severity === "high"
                ? "rgba(249,115,22,0.42)"
                : "rgba(6,182,212,0.28)";

              const markerId = isHighlighted
                ? edge.severity === "critical"
                  ? "url(#ops-arrow-critical)"
                  : edge.severity === "high"
                  ? "url(#ops-arrow-high)"
                  : "url(#ops-arrow-cyan)"
                : "url(#ops-arrow-default)";

              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isHighlighted ? 2.4 : 1.35}
                  strokeDasharray={isRelated ? "5 4" : undefined}
                  opacity={isDimmed ? 0.14 : isHighlighted ? 1 : 0.78}
                  markerEnd={isRelated ? undefined : markerId}
                  className={traceActive && isHighlighted ? "opsgraph-trace-path" : undefined}
                />
              );
            })}
          </svg>

          {/* Interactive HTML Node Layer */}
          {graph.nodes.map((node) => {
            const pos = getPos(node);
            const isSelected = selectedNodeId === node.id;
            const isActive = activeNodeSet ? activeNodeSet.has(node.id) : true;
            const isPriorityNode = node.severity === "critical" || node.severity === "high";
            const accent = severityAccent(node.severity);
            const Icon = nodeTypeIcon(node.type);
            const label = language === "ar" ? node.labelAr : node.labelEn;
            const subtitle = language === "ar" ? node.subtitleAr : node.subtitleEn;

            return (
              <button
                key={node.id}
                data-opsgraph-node="true"
                type="button"
                dir={language === "ar" ? "rtl" : "ltr"}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(node.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(node.id);
                  focusNode(node.id);
                }}
                onPointerDown={(e) => handlePointerDownNode(e, node.id)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() =>
                  setHoveredNodeId((prev) => (prev === node.id ? null : prev))
                }
                aria-pressed={isSelected}
                aria-label={`${og.nodeSingular[node.type]}: ${label} — ${subtitle}`}
                style={{
                  left: `${pos.x - NODE_HALF_W}px`,
                  top: `${pos.y - NODE_HALF_H}px`,
                  width: `${NODE_WIDTH}px`,
                }}
                className={`absolute px-3 py-2 rounded-lg border text-start transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isSelected
                    ? `bg-white dark:bg-[#131E33] border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/35 z-20 shadow-sm`
                    : isPriorityNode
                    ? `bg-white dark:bg-[#0F172A] ${accent.border} hover:bg-slate-50 dark:hover:bg-[#131E33] z-10`
                    : `bg-white/95 dark:bg-[#0B1324] ${accent.border} hover:bg-slate-50 dark:hover:bg-[#131E33]`
                } ${isActive ? "opacity-100" : "opacity-30"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${accent.badge}`}
                    >
                      <Icon className="w-3 h-3" />
                    </span>
                    <span className="text-xs font-bold text-[#0F294A] dark:text-slate-100 truncate">
                      {label}
                    </span>
                  </div>
                  {typeof node.riskScore === "number" && node.type === "project" && (
                    <span
                      className={`text-[10px] font-mono-num font-bold px-1.5 py-0.5 rounded shrink-0 ${accent.badge}`}
                    >
                      {node.riskScore}
                    </span>
                  )}
                  {typeof node.utilizationPct === "number" && node.type === "employee" && (
                    <span
                      className={`text-[10px] font-mono-num font-bold px-1.5 py-0.5 rounded shrink-0 ${accent.badge}`}
                    >
                      {node.utilizationPct}%
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-1 font-mono-num">
                  {subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {/* Lightweight Hover Tooltip */}
        {hoveredNode && !dragStateRef.current && (
          <div className="pointer-events-none absolute bottom-3 end-3 z-20 max-w-xs px-3 py-2 rounded-lg bg-white/95 dark:bg-[#0F172A]/95 border border-slate-200 dark:border-[#1E293B] text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#0F294A] dark:text-slate-100">
              <span>{og.nodeSingular[hoveredNode.type]}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {language === "ar" ? hoveredNode.labelAr : hoveredNode.labelEn}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-[11px] text-cyan-700 dark:text-cyan-400 shrink-0">
                {hoveredEdgeCount} {og.labels.edgesCount}
              </span>
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
              {language === "ar" ? hoveredNode.subtitleAr : hoveredNode.subtitleEn}
            </div>
            {hoveredNode.hasVisibilityGap && (
              <div className="text-[11px] text-orange-700 dark:text-orange-300 mt-0.5">
                {og.labels.visibilityGap}
              </div>
            )}
          </div>
        )}

        {/* Compact SVG Minimap */}
        <div
          dir="ltr"
          className="hidden sm:block absolute bottom-3 start-3 z-20 w-[148px] h-[94px] rounded-lg bg-white/95 dark:bg-[#0F172A]/95 border border-slate-200 dark:border-[#1E293B] p-1.5"
        >
          <svg
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
            className="w-full h-full"
          >
            {graph.edges.map((e) => {
              const s = graph.nodeMap.get(e.source);
              const tN = graph.nodeMap.get(e.target);
              if (!s || !tN) return null;
              const p1 = getPos(s);
              const p2 = getPos(tN);
              return (
                <line
                  key={e.id}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="rgba(6,182,212,0.28)"
                  strokeWidth={4}
                />
              );
            })}
            {graph.nodes.map((n) => {
              const p = getPos(n);
              const isSel = selectedNodeId === n.id;
              return (
                <circle
                  key={n.id}
                  cx={p.x}
                  cy={p.y}
                  r={isSel ? 18 : 11}
                  fill={isSel ? "#3B82F6" : severityAccent(n.severity).dot}
                  opacity={isSel ? 1 : 0.85}
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Mobile Simplified Interactive Network View */}
      <div className="md:hidden p-3 space-y-3 bg-white dark:bg-[#0B1324]">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{og.labels.mobilePriorityNotice}</span>
          <span className="font-mono-num">
            {graph.nodes.length} {og.labels.nodesCount}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 max-h-[280px] overflow-y-auto pe-1">
          {graph.nodes.slice(0, 16).map((node) => {
            const isSelected = selectedNodeId === node.id;
            const accent = severityAccent(node.severity);
            const Icon = nodeTypeIcon(node.type);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectNode(node.id)}
                className={`w-full px-3 py-2.5 rounded-lg border text-start flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? "bg-blue-50/70 dark:bg-[#131E33] border-blue-600 dark:border-blue-400"
                    : "bg-slate-50 dark:bg-[#0F172A] border-slate-200 dark:border-[#1E293B]"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${accent.badge}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F294A] dark:text-slate-100 truncate">
                      {language === "ar" ? node.labelAr : node.labelEn}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate font-mono-num">
                      {language === "ar" ? node.subtitleAr : node.subtitleEn}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                  {og.nodeSingular[node.type]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
