"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, saveTeam, deleteTeam,
  type AgentConfig, type TeamConfig,
} from "@/lib/api";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  ReactFlowProvider,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Crown, Bot, Plus, Pencil, Trash2,
  X, Check, Loader2,
} from "lucide-react";
import { agentColor } from "@/components/sidebar";
import { cn } from "@/lib/utils";

type FormData = {
  id: string;
  name: string;
  agents: string[];
  leader_agent: string;
};

const emptyForm: FormData = {
  id: "", name: "", agents: [], leader_agent: "",
};

// ── Mini ReactFlow node types for team cards ──────────────────────────────

function MiniLeaderNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-primary/60 rounded-lg shadow-sm px-3 py-1.5 ring-1 ring-primary/20" style={{ width: MINI_NODE_W }}>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5">
        <div className={cn(
          "flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold uppercase shrink-0 text-white",
          data.color as string,
        )}>
          {(data.label as string).slice(0, 2)}
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {data.label as string}
        </span>
        <Crown className="h-2.5 w-2.5 text-primary shrink-0" />
      </div>
    </div>
  );
}

function MiniAgentNode({ data }: NodeProps) {
  return (
    <div className="bg-card border rounded-lg shadow-sm px-3 py-1.5 border-border" style={{ width: MINI_NODE_W }}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5">
        <div className={cn(
          "flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold uppercase shrink-0 text-white",
          data.color as string,
        )}>
          {(data.label as string).slice(0, 2)}
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {data.label as string}
        </span>
      </div>
    </div>
  );
}

const miniNodeTypes: NodeTypes = {
  leader: MiniLeaderNode,
  agent: MiniAgentNode,
};

const MINI_NODE_W = 150;
const MINI_NODE_H = 30;
const MINI_V_GAP = 50;

function buildMiniTree(
  team: TeamConfig,
  agents: Record<string, AgentConfig>,
): { nodes: Node[]; edges: Edge[]; height: number } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const leaderId = team.leader_agent;
  const leader = agents[leaderId];
  const workerIds = team.agents.filter((a) => a !== leaderId && agents[a]);

  const H_GAP = 20;
  const totalWorkersWidth = workerIds.length > 0
    ? workerIds.length * MINI_NODE_W + (workerIds.length - 1) * H_GAP
    : 0;
  const contentWidth = Math.max(MINI_NODE_W, totalWorkersWidth);

  // Leader centered at top
  const leaderNodeId = "leader";
  nodes.push({
    id: leaderNodeId,
    type: "leader",
    position: { x: contentWidth / 2 - MINI_NODE_W / 2, y: 0 },
    data: {
      label: leader?.name || leaderId,
      color: agentColor(leaderId),
    },
  });

  // Workers evenly spaced at the same Y
  const workerY = MINI_NODE_H + MINI_V_GAP;
  workerIds.forEach((aid, i) => {
    const nodeId = `agent-${aid}`;
    const x = (contentWidth - totalWorkersWidth) / 2 + i * (MINI_NODE_W + H_GAP);
    nodes.push({
      id: nodeId,
      type: "agent",
      position: { x, y: workerY },
      data: {
        label: agents[aid].name,
        color: agentColor(aid),
      },
    });
    edges.push({
      id: `${leaderNodeId}->${nodeId}`,
      source: leaderNodeId,
      target: nodeId,
      type: "smoothstep",
      pathOptions: { offset: MINI_V_GAP / 2 },
      style: { stroke: "var(--color-border)" },
    });
  });

  const height = workerIds.length > 0 ? workerY + MINI_NODE_H + 10 : MINI_NODE_H + 10;
  return { nodes, edges, height };
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams, loading, refresh } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const [editing, setEditing] = useState<FormData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const openNew = () => {
    setEditing({ ...emptyForm });
    setIsNew(true);
    setError("");
  };

  const openEdit = (id: string, team: TeamConfig) => {
    setEditing({
      id,
      name: team.name,
      agents: [...team.agents],
      leader_agent: team.leader_agent,
    });
    setIsNew(false);
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    const { id, name, agents: teamAgents, leader_agent } = editing;
    if (!id.trim() || !name.trim()) {
      setError("ID and name are required");
      return;
    }
    if (/\s/.test(id)) {
      setError("ID cannot contain spaces");
      return;
    }
    if (teamAgents.length === 0) {
      setError("At least one agent is required");
      return;
    }
    if (!leader_agent) {
      setError("A leader agent must be selected");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveTeam(id.toLowerCase(), { name, agents: teamAgents, leader_agent });
      setEditing(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editing, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await deleteTeam(id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }, [refresh]);

  // Find unassigned agents
  const assignedAgentIds = new Set<string>();
  if (teams) {
    for (const team of Object.values(teams)) {
      for (const aid of team.agents) assignedAgentIds.add(aid);
    }
  }
  const unassignedAgents = agents
    ? Object.entries(agents).filter(([id]) => !assignedAgentIds.has(id))
    : [];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Teams
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agent teams for collaborative task execution
          </p>
        </div>
        <Button onClick={openNew} disabled={!!editing}>
          <Plus className="h-4 w-4" />
          Add Team
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <TeamEditor
          form={editing}
          setForm={setEditing}
          isNew={isNew}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={cancel}
          availableAgents={agents || {}}
        />
      )}

      {/* Team Cards */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading teams...
        </div>
      ) : teams && Object.keys(teams).length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(teams).map(([id, team]) => (
            <TeamCard
              key={id}
              id={id}
              team={team}
              agents={agents || {}}
              onEdit={() => openEdit(id, team)}
              onDelete={() => handleDelete(id)}
              deleting={deleting === id}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No teams configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click &quot;Add Team&quot; to create your first agent team
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Unassigned Agents */}
      {unassignedAgents.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Unassigned Agents
            <Badge variant="outline" className="ml-1">{unassignedAgents.length}</Badge>
          </h2>
          <div className="flex flex-wrap gap-3">
            {unassignedAgents.map(([id, agent]) => (
              <Link key={id} href={`/agents/${id}`}>
                <div className="flex items-center gap-2 border border-dashed px-3 py-2 hover:border-primary/50 transition-colors cursor-pointer">
                  <div className={cn(
                    "flex h-6 w-6 items-center justify-center text-[9px] font-bold uppercase shrink-0 text-white",
                    agentColor(id),
                  )}>
                    {agent.name.slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="text-[10px] text-muted-foreground">@{id}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Team Editor ───────────────────────────────────────────────────────────

function TeamEditor({
  form, setForm, isNew, saving, error, onSave, onCancel, availableAgents,
}: {
  form: FormData;
  setForm: (f: FormData) => void;
  isNew: boolean;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  availableAgents: Record<string, AgentConfig>;
}) {
  const agentIds = Object.keys(availableAgents);

  const toggleAgent = (agentId: string) => {
    const inTeam = form.agents.includes(agentId);
    let newAgents: string[];
    let newLeader = form.leader_agent;

    if (inTeam) {
      newAgents = form.agents.filter(a => a !== agentId);
      if (newLeader === agentId) {
        newLeader = newAgents[0] || "";
      }
    } else {
      newAgents = [...form.agents, agentId];
      if (!newLeader) newLeader = agentId;
    }

    setForm({ ...form, agents: newAgents, leader_agent: newLeader });
  };

  const setLeader = (agentId: string) => {
    setForm({ ...form, leader_agent: agentId });
  };

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
          {isNew ? "New Team" : `Edit @${form.id}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Team ID</label>
            <Input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="e.g. backend-team"
              disabled={!isNew}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Display Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Backend Team"
            />
          </div>
        </div>

        {/* Agent Selection */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Team Members
            {form.agents.length > 0 && (
              <span className="ml-2 text-primary">{form.agents.length} selected</span>
            )}
          </label>
          {agentIds.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {agentIds.map(agentId => {
                const agent = availableAgents[agentId];
                const selected = form.agents.includes(agentId);
                const isLeader = form.leader_agent === agentId;
                return (
                  <div
                    key={agentId}
                    className={`flex items-center justify-between border px-3 py-2 cursor-pointer transition-colors ${
                      selected
                        ? isLeader
                          ? "border-primary bg-primary/10"
                          : "border-primary/50 bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                    onClick={() => toggleAgent(agentId)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "flex h-6 w-6 items-center justify-center text-[9px] font-bold uppercase shrink-0 text-white",
                        agentColor(agentId),
                      )}>
                        {agent.name.slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">@{agentId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {selected && (
                        <Button
                          variant={isLeader ? "default" : "ghost"}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLeader(agentId);
                          }}
                        >
                          <Crown className="h-3 w-3" />
                          {isLeader ? "Leader" : "Set Leader"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No agents configured. Create agents first before building a team.
            </p>
          )}
        </div>

        {/* Selected order preview */}
        {form.agents.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Team Composition</label>
            <div className="flex items-center gap-2 flex-wrap">
              {form.agents.map((agentId) => {
                const agent = availableAgents[agentId];
                const isLeader = agentId === form.leader_agent;
                return (
                  <Badge
                    key={agentId}
                    variant={isLeader ? "default" : "outline"}
                    className="flex items-center gap-1"
                  >
                    {isLeader && <Crown className="h-3 w-3" />}
                    {agent?.name || agentId}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isNew ? "Create Team" : "Save Changes"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Team Card with mini ReactFlow ─────────────────────────────────────────

function TeamCard({
  id, team, agents, onEdit, onDelete, deleting,
}: {
  id: string;
  team: TeamConfig;
  agents: Record<string, AgentConfig>;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { nodes, edges, height } = useMemo(
    () => buildMiniTree(team, agents),
    [team, agents],
  );

  return (
    <Link href={`/team/${id}`} className="block">
      <Card className="transition-colors hover:border-primary/50 cursor-pointer">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">{team.name}</CardTitle>
              <CardDescription>@{id}</CardDescription>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
              <Badge variant="outline">
                {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
              </Badge>
              <Button variant="ghost" size="icon" onClick={(e) => { e.preventDefault(); onEdit(); }} className="h-8 w-8">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={(e) => { e.preventDefault(); onDelete(); setConfirmDelete(false); }}
                    disabled={deleting}
                    className="h-8 text-xs"
                  >
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); setConfirmDelete(false); }} className="h-8 text-xs">
                    No
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="icon" onClick={(e) => { e.preventDefault(); setConfirmDelete(true); }} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ height: height + 20 }} className="w-full">
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={miniNodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                proOptions={{ hideAttribution: true }}
                className="bg-transparent"
              />
            </ReactFlowProvider>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
