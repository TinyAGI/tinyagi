"use client";

import { useMemo, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { usePolling } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  type AgentConfig,
  type TeamConfig,
} from "@/lib/api";
import { Bot, Building2, Crown } from "lucide-react";
import { agentColor } from "@/components/sidebar";
import { cn } from "@/lib/utils";

// ── Custom Nodes ──────────────────────────────────────────────────────────

function CompanyNode({ data }: NodeProps) {
  return (
    <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-6 py-3 min-w-[160px]">
      <div className="flex items-center gap-2 justify-center">
        <Building2 className="h-5 w-5" />
        <span className="text-sm font-bold">{data.label as string}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary-foreground !w-2 !h-2" />
    </div>
  );
}

function LeaderNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-primary/60 rounded-lg shadow-md px-4 py-2.5 min-w-[150px] ring-1 ring-primary/20">
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <div className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-[10px] font-bold uppercase shrink-0 text-white",
          data.color as string,
        )}>
          {(data.label as string).slice(0, 2)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium text-foreground truncate">
              {data.label as string}
            </span>
            <Crown className="h-3 w-3 text-primary shrink-0" />
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.teamName as string}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
}

function AgentNode({ data }: NodeProps) {
  return (
    <div className="bg-card border rounded-lg shadow-md px-4 py-2.5 min-w-[150px] border-border">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <div className={cn(
          "flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold uppercase shrink-0 text-white",
          data.color as string,
        )}>
          {(data.label as string).slice(0, 2)}
        </div>
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground truncate block">
            {data.label as string}
          </span>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.model as string}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

function UnassignedNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-dashed border-muted-foreground/40 rounded-lg shadow-md px-4 py-2.5 min-w-[150px]">
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 justify-center">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  company: CompanyNode,
  leader: LeaderNode,
  agent: AgentNode,
  unassigned: UnassignedNode,
};

// ── Layout ────────────────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 50;
const COL_GAP = 60;
const ROW_GAP = 50;
const TEAMMATE_GAP = 20;

function buildOrgChart(
  agents: Record<string, AgentConfig>,
  teams: Record<string, TeamConfig>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const teamEntries = Object.entries(teams);
  const allAgentIds = Object.keys(agents);

  const assignedAgentIds = new Set<string>();
  for (const [, team] of teamEntries) {
    for (const aid of team.agents) assignedAgentIds.add(aid);
  }
  const unassignedAgentIds = allAgentIds.filter((id) => !assignedAgentIds.has(id));

  // Build columns: each team is a column with leader + workers stacked vertically
  type Column = { leaderId: string; workerIds: string[]; teamId: string; teamName: string };
  const columns: Column[] = [];

  for (const [teamId, team] of teamEntries) {
    const leaderId = team.leader_agent;
    if (!agents[leaderId]) continue;
    const workerIds = team.agents.filter((a) => a !== leaderId && agents[a]);
    columns.push({ leaderId, workerIds, teamId, teamName: team.name });
  }

  // Calculate total width to center the company node
  const totalCols = columns.length + (unassignedAgentIds.length > 0 ? 1 : 0);
  const totalWidth = totalCols * (NODE_W + COL_GAP) - COL_GAP;

  // Company node centered at top
  const companyId = "company";
  nodes.push({
    id: companyId,
    type: "company",
    position: { x: totalWidth / 2 - NODE_W / 2, y: 0 },
    data: { label: "Company" },
  });

  const leaderY = NODE_H + ROW_GAP * 2;
  let colX = 0;

  for (const col of columns) {
    const leaderNodeId = `leader-${col.teamId}`;

    // Leader node
    nodes.push({
      id: leaderNodeId,
      type: "leader",
      position: { x: colX, y: leaderY },
      data: {
        label: agents[col.leaderId].name,
        teamName: col.teamName,
        agentId: col.leaderId,
        color: agentColor(col.leaderId),
      },
    });

    edges.push({
      id: `${companyId}->${leaderNodeId}`,
      source: companyId,
      target: leaderNodeId,
      type: "smoothstep",
      style: { stroke: "var(--color-primary)" },
    });

    // Workers stacked vertically below leader, all connect from leader
    col.workerIds.forEach((aid, i) => {
      const nodeId = `agent-${col.teamId}-${aid}`;
      const workerY = leaderY + NODE_H + ROW_GAP + i * (NODE_H + TEAMMATE_GAP);

      nodes.push({
        id: nodeId,
        type: "agent",
        position: { x: colX, y: workerY },
        data: {
          label: agents[aid].name,
          model: `${agents[aid].provider}/${agents[aid].model}`,
          agentId: aid,
          color: agentColor(aid),
        },
      });

      edges.push({
        id: `${leaderNodeId}->${nodeId}`,
        source: leaderNodeId,
        target: nodeId,
        type: "smoothstep",
        style: { stroke: "var(--color-border)" },
      });
    });

    colX += NODE_W + COL_GAP;
  }

  // Unassigned agents grouped in one column
  if (unassignedAgentIds.length > 0) {
    const unassignedHeaderId = "unassigned-header";
    nodes.push({
      id: unassignedHeaderId,
      type: "unassigned",
      position: { x: colX, y: leaderY },
      data: { label: "Unassigned" },
    });

    edges.push({
      id: `${companyId}->${unassignedHeaderId}`,
      source: companyId,
      target: unassignedHeaderId,
      type: "smoothstep",
      style: { stroke: "var(--color-border)", strokeDasharray: "5 5" },
    });

    unassignedAgentIds.forEach((aid, i) => {
      const nodeId = `unassigned-${aid}`;
      const workerY = leaderY + NODE_H + ROW_GAP + i * (NODE_H + TEAMMATE_GAP);
      nodes.push({
        id: nodeId,
        type: "agent",
        position: { x: colX, y: workerY },
        data: {
          label: agents[aid].name,
          model: `${agents[aid].provider}/${agents[aid].model}`,
          agentId: aid,
          color: agentColor(aid),
        },
      });
      edges.push({
        id: `${unassignedHeaderId}->${nodeId}`,
        source: unassignedHeaderId,
        target: nodeId,
        type: "smoothstep",
        style: { stroke: "var(--color-border)", strokeDasharray: "5 5" },
      });
    });
  }

  return { nodes, edges };
}

// ── Main Component ────────────────────────────────────────────────────────

function OrgChartInner() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (!agents) return { nodes: [], edges: [] };
    return buildOrgChart(agents, teams ?? {});
  }, [agents, teams]);

  const onNodesChange = useCallback(() => {}, []);

  useEffect(() => {
    if (nodes.length === 0) return;
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.3, duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes, edges, fitView]);

  if (!agents) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (Object.keys(agents).length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Bot className="h-8 w-8" />
        <p className="text-sm">No agents configured yet.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background gap={20} size={1} className="!bg-background" />
      <Controls
        showInteractive={false}
        className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
      />
    </ReactFlow>
  );
}

export default function OrgChartPage() {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <OrgChartInner />
      </ReactFlowProvider>
    </div>
  );
}
