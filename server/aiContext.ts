import {
  assessProjectRisks,
  computeOperationalIntelligence,
  computeOperationalMetrics,
  computeTeamWorkload,
  generateRebalanceSuggestions,
} from "../src/utils/analytics.js";
import {
  buildAnalystContext,
  buildDailyBriefContext,
  buildPerformanceContext,
} from "../src/utils/aiContextBuilders.js";
import {
  buildGraphEntityContext,
  buildOpsGraphData,
  computeNodeImpact,
  DEFAULT_OPSGRAPH_FILTERS,
} from "../src/utils/opsGraph.js";
import {
  buildTargetedChatContext,
  classifyChatIntent,
  type ChatIntent,
  type WorkspaceSnapshot,
} from "../src/services/contextRetriever.js";
import type { Employee, Language, Project } from "../src/types.js";

function buildSignature(projects: Project[]): string {
  return projects
    .map(
      (p) =>
        `${p.id}:${p.status}:${p.progress}:${p.deadline}:${p.assignedEmployeeId}:${p.lastUpdated}`
    )
    .join("|");
}

function buildSnapshot(projects: Project[], employees: Employee[]): WorkspaceSnapshot {
  const metrics = computeOperationalMetrics(projects, employees);
  const workloads = computeTeamWorkload(projects, employees);
  const risks = assessProjectRisks(projects, employees);
  const rebalanceSuggestions = generateRebalanceSuggestions(projects, employees);
  const intelligence = computeOperationalIntelligence(
    projects,
    employees,
    metrics,
    workloads,
    risks
  );
  return {
    projects,
    employees,
    metrics,
    risks,
    workloads,
    rebalanceSuggestions,
    intelligence,
    signature: buildSignature(projects),
  };
}

export function buildServerDailyBriefContext(
  projects: Project[],
  employees: Employee[],
  language: Language
) {
  const snap = buildSnapshot(projects, employees);
  return buildDailyBriefContext(
    snap.employees,
    snap.metrics,
    snap.risks,
    snap.workloads,
    language,
    snap.intelligence
  );
}

export function buildServerAnalystContext(
  projects: Project[],
  employees: Employee[],
  language: Language
) {
  const snap = buildSnapshot(projects, employees);
  return buildAnalystContext(
    snap.employees,
    snap.metrics,
    snap.risks,
    snap.workloads,
    snap.rebalanceSuggestions,
    language,
    snap.intelligence
  );
}

export function buildServerPerformanceContext(
  projects: Project[],
  employees: Employee[],
  language: Language
) {
  const snap = buildSnapshot(projects, employees);
  return buildPerformanceContext(
    snap.projects,
    snap.employees,
    snap.metrics,
    snap.workloads,
    language,
    snap.intelligence
  );
}

export function buildServerChatContext(params: {
  projects: Project[];
  employees: Employee[];
  language: Language;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  requestedIntent?: ChatIntent;
  focusNodeId?: string;
}): { intent: ChatIntent; context: Record<string, unknown> | null } {
  const { projects, employees, language, messages, requestedIntent, focusNodeId } = params;

  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
  const latestUser = userMessages[userMessages.length - 1] ?? "";
  const previousUsers = userMessages.slice(0, -1);

  const intent: ChatIntent =
    focusNodeId
      ? requestedIntent ?? classifyChatIntent(latestUser, previousUsers)
      : requestedIntent ?? classifyChatIntent(latestUser, previousUsers);

  if (intent === "greeting" && !focusNodeId) {
    return { intent: "greeting", context: null };
  }

  const snap = buildSnapshot(projects, employees);
  const targeted = buildTargetedChatContext(
    intent === "greeting" ? "risk_overdue" : intent,
    snap,
    language
  );

  if (!focusNodeId) {
    return { intent: targeted.intent, context: targeted.context };
  }

  const graph = buildOpsGraphData(
    snap.projects,
    snap.employees,
    snap.workloads,
    snap.risks,
    snap.intelligence!,
    DEFAULT_OPSGRAPH_FILTERS,
    new Set()
  );
  const focusedNode = graph.nodeMap.get(focusNodeId);
  if (!focusedNode) {
    return { intent: targeted.intent, context: targeted.context };
  }

  const impactReport = computeNodeImpact(
    focusedNode,
    graph,
    snap.projects,
    snap.employees,
    snap.workloads,
    snap.risks
  );

  const opsGraphFocus = buildGraphEntityContext({
    node: focusedNode,
    graph,
    impactReport,
    projects: snap.projects,
    employees: snap.employees,
    workloads: snap.workloads,
    risks: snap.risks,
    language,
    investigationMode: true,
  });

  return {
    intent: targeted.intent,
    context: {
      ...(targeted.context ?? {}),
      opsGraphFocus,
    },
  };
}
