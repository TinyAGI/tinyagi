"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Send } from "lucide-react";

import {
  PixelOfficeScene,
  getTaskStationMemberSpot,
  getLoungeMemberSpot,
  pointToPercent,
  type PixelDeskStatus,
  type SceneAgent,
  type SceneLounge,
  type SceneQueueSnapshot,
  type SceneResponseItem,
  type SceneRouteTarget,
  type SceneTaskStation,
  type SceneTaskSummary,
} from "@/components/pixel-office-scene";
import { usePolling } from "@/lib/hooks";
import {
  getAgents,
  getQueueStatus,
  getResponses,
  getTasks,
  getTeams,
  sendMessage,
  subscribeToEvents,
  type AgentConfig,
  type EventData,
  type QueueStatus,
  type ResponseData,
  type Task,
  type TeamConfig,
} from "@/lib/api";

type LiveBubble = {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  targetAgents: string[];
};

type TeamGroup = {
  id: string;
  label: string;
  memberIds: string[];
  color: string;
};

type StationAssignment = {
  stationIndex: number;
  kind: "task" | "route";
  status: PixelDeskStatus;
  startAt: number;
  label: string;
  speaker?: boolean;
};

type OverlayBubble = {
  id: string;
  x: number;
  y: number;
  color: string;
  heading: string;
  message: string;
};

const AGENT_COLORS = ["#a3e635", "#84cc16", "#f59e0b", "#14b8a6", "#eab308", "#22c55e"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(progress: number) {
  return progress * progress * (3 - 2 * progress);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function interpolatePoint(from: { x: number; y: number }, to: { x: number; y: number }, progress: number) {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
  };
}

function trimText(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractTargets(message: string) {
  const targets: string[] = [];
  for (const match of message.matchAll(/\[@(\w[\w-]*?):/g)) {
    if (!targets.includes(match[1])) targets.push(match[1]);
  }
  if (targets.length === 0) {
    const direct = message.match(/^@(\w[\w-]*)/);
    if (direct) targets.push(direct[1]);
  }
  return targets;
}

function isErrorMessage(message: string) {
  return /\b(error|failed|failure|exception|timeout)\b/i.test(message);
}

function taskTone(task: Task): PixelDeskStatus {
  if (task.status === "done") return "done";
  if (task.status === "review") return "pending";
  if (task.status === "in_progress") return "running";
  return "empty";
}

function routeTone(message: string): PixelDeskStatus {
  return isErrorMessage(message) ? "error" : "running";
}

function responseTone(response: ResponseData): PixelDeskStatus {
  return isErrorMessage(response.message) ? "error" : "done";
}

function buildTeamGroups(
  agents: Record<string, AgentConfig> | null,
  teams: Record<string, TeamConfig> | null,
) {
  if (!agents) return [] as TeamGroup[];

  const allAgentIds = Object.keys(agents);
  const groupedIds = new Set<string>();
  const groups: TeamGroup[] = [];
  const teamEntries = teams ? Object.entries(teams) : [];

  teamEntries.forEach(([teamId, team], index) => {
    const members = team.agents.filter((memberId) => allAgentIds.includes(memberId));
    members.forEach((memberId) => groupedIds.add(memberId));
    if (members.length === 0) return;
    groups.push({
      id: teamId,
      label: team.name || teamId,
      memberIds: members,
      color: AGENT_COLORS[index % AGENT_COLORS.length],
    });
  });

  const independent = allAgentIds.filter((agentId) => !groupedIds.has(agentId));
  if (independent.length > 0) {
    groups.push({
      id: "independent",
      label: "Independent",
      memberIds: independent,
      color: AGENT_COLORS[groups.length % AGENT_COLORS.length],
    });
  }

  return groups;
}

function responseSubtitle(response: ResponseData) {
  return response.agent ? `@${response.agent} -> ${response.channel}` : response.channel;
}

export default function OfficePage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const { data: tasks } = usePolling<Task[]>(getTasks, 4000);
  const { data: queueStatus } = usePolling<QueueStatus>(getQueueStatus, 2500);
  const { data: responses } = usePolling<ResponseData[]>(() => getResponses(6), 4000);

  const [bubbles, setBubbles] = useState<LiveBubble[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState({ now: Date.now(), frame: 0 });

  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClock((current) => ({ now: Date.now(), frame: current.frame + 1 }));
    }, 120);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);
        const fingerprint = `${event.type}:${event.timestamp}:${(event as Record<string, unknown>).messageId ?? ""}:${(event as Record<string, unknown>).agentId ?? ""}`;
        if (seenRef.current.has(fingerprint)) return;
        seenRef.current.add(fingerprint);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const payload = event as Record<string, unknown>;
        const agentId = payload.agentId ? String(payload.agentId) : undefined;

        if (event.type === "message_enqueued") {
          const message = (payload.message as string) || "";
          const sender = (payload.sender as string) || "User";
          if (!message) return;
          setBubbles((current) =>
            [
              ...current,
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
                agentId: `_user_${sender}`,
                message,
                timestamp: event.timestamp,
                targetAgents: extractTargets(message),
              },
            ].slice(-80),
          );
        }

        if (event.type === "agent_message" && agentId) {
          const message = (payload.content as string) || "";
          if (!message) return;
          setBubbles((current) =>
            [
              ...current,
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
                agentId,
                message,
                timestamp: event.timestamp,
                targetAgents: extractTargets(message),
              },
            ].slice(-80),
          );
        }
      },
      () => setConnected(false),
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - 22000;
      setBubbles((current) => current.filter((bubble) => bubble.timestamp > cutoff));
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage({ message: chatInput, sender: "Web", channel: "web" });
      setChatInput("");
    } finally {
      setSending(false);
    }
  }, [chatInput, sending]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSend();
    }
  };

  const teamGroups = useMemo(() => buildTeamGroups(agents, teams), [agents, teams]);
  const agentEntries = useMemo(() => (agents ? Object.entries(agents) : []), [agents]);

  const loungeModel = useMemo<SceneLounge>(
    () => ({
      label: "Agent Lounge",
      agentCount: agentEntries.length,
      teamCount: teamGroups.length,
    }),
    [agentEntries.length, teamGroups.length],
  );

  const homePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; color: string; groupLabel: string }>();
    const orderedAgents = teamGroups.flatMap((group) => group.memberIds.map((agentId) => ({ agentId, group })));
    orderedAgents.forEach(({ agentId, group }, memberIndex) => {
        positions.set(agentId, {
          ...getLoungeMemberSpot(memberIndex, orderedAgents.length),
          color: group.color,
          groupLabel: group.label,
        });
    });
    return positions;
  }, [teamGroups]);

  const latestUserBubble = useMemo(
    () => [...bubbles].reverse().find((bubble) => bubble.agentId.startsWith("_user_")),
    [bubbles],
  );

  const latestAgentBubbleById = useMemo(() => {
    const lookup = new Map<string, LiveBubble>();
    bubbles.forEach((bubble) => {
      if (bubble.agentId.startsWith("_user_")) return;
      const existing = lookup.get(bubble.agentId);
      if (!existing || existing.timestamp < bubble.timestamp) lookup.set(bubble.agentId, bubble);
    });
    return lookup;
  }, [bubbles]);

  const activeTasks = useMemo(() => {
    const allTasks = tasks ?? [];
    return allTasks
      .filter((task) => task.status === "in_progress" || task.status === "review")
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [tasks]);

  const taskStations = useMemo<SceneTaskStation[]>(() => {
    return agentEntries.map(([agentId, agent]) => {
      const directTask = activeTasks.find(
        (task) => task.assigneeType === "agent" && task.assignee === agentId,
      );
      const teamTask = activeTasks.find((task) => {
        if (task.assigneeType !== "team" || !task.assignee) return false;
        const team = teams?.[task.assignee];
        return Boolean(team?.agents.includes(agentId));
      });
      const activeTask = directTask ?? teamTask;
      const recentRouteBubble = [...bubbles]
        .filter(
          (bubble) =>
            clock.now - bubble.timestamp < 10000 &&
            (bubble.agentId === agentId || bubble.targetAgents.includes(agentId)),
        )
        .sort((left, right) => right.timestamp - left.timestamp)[0];

      if (activeTask) {
        return {
          id: `desk-${agentId}`,
          label: agent.name,
          subtitle: trimText(activeTask.title, 42),
          status: taskTone(activeTask),
          kind: "task" as const,
        };
      }

      if (recentRouteBubble) {
        return {
          id: `desk-${agentId}`,
          label: agent.name,
          subtitle: trimText(recentRouteBubble.message, 42),
          status: routeTone(recentRouteBubble.message),
          kind: "route" as const,
        };
      }

      return {
        id: `desk-${agentId}`,
        label: agent.name,
        subtitle: `@${agentId} waiting in lounge`,
        status: "empty" as const,
        kind: "task" as const,
      };
    });
  }, [activeTasks, agentEntries, bubbles, clock.now, teams]);

  const stationAssignments = useMemo(() => {
    const assignments = new Map<string, StationAssignment>();

    activeTasks.forEach((task, stationIndex) => {
      let assignedAgentIds: string[] = [];
      if (task.assigneeType === "team" && task.assignee) {
        const team = teams?.[task.assignee];
        assignedAgentIds = team ? team.agents.filter((agentId) => agents?.[agentId]).slice(0, 3) : [];
        if (team?.leader_agent && assignedAgentIds.includes(team.leader_agent)) {
          assignedAgentIds = [team.leader_agent, ...assignedAgentIds.filter((agentId) => agentId !== team.leader_agent)];
        }
      } else if (task.assigneeType === "agent" && task.assignee && agents?.[task.assignee]) {
        assignedAgentIds = [task.assignee];
      }

      assignedAgentIds.forEach((agentId, memberIndex) => {
        if (!assignments.has(agentId)) {
          const agentDeskIndex = agentEntries.findIndex(([id]) => id === agentId);
          assignments.set(agentId, {
            stationIndex: agentDeskIndex >= 0 ? agentDeskIndex : stationIndex,
            kind: "task",
            status: taskTone(task),
            startAt: task.updatedAt,
            label: task.title,
            speaker: memberIndex === 0,
          });
        }
      });
    });

    const recentRouteBubble = [...bubbles]
      .filter((bubble) => clock.now - bubble.timestamp < 10000)
      .sort((left, right) => right.timestamp - left.timestamp)[0];

    if (recentRouteBubble) {
      const routeAgents = recentRouteBubble.targetAgents.filter((agentId) => agents?.[agentId]).slice(0, 3);
      const speakerIsAgent = !recentRouteBubble.agentId.startsWith("_user_") && agents?.[recentRouteBubble.agentId];
      const participantIds = speakerIsAgent
        ? [recentRouteBubble.agentId, ...routeAgents.filter((agentId) => agentId !== recentRouteBubble.agentId)]
        : routeAgents;

      participantIds.forEach((agentId) => {
        if (!assignments.has(agentId)) {
          const agentDeskIndex = agentEntries.findIndex(([id]) => id === agentId);
          assignments.set(agentId, {
            stationIndex: agentDeskIndex >= 0 ? agentDeskIndex : 0,
            kind: "route",
            status: routeTone(recentRouteBubble.message),
            startAt: recentRouteBubble.timestamp,
            label: trimText(recentRouteBubble.message, 30),
            speaker: speakerIsAgent ? agentId === recentRouteBubble.agentId : participantIds[0] === agentId,
          });
        }
      });
    }

    return assignments;
  }, [activeTasks, bubbles, clock.now, agents, teams, agentEntries]);

  const sceneAgents = useMemo<SceneAgent[]>(() => {
    return agentEntries.map(([agentId], index) => {
      const home = homePositions.get(agentId) ?? {
        x: 100 + index * 40,
        y: 620,
        color: AGENT_COLORS[index % AGENT_COLORS.length],
        groupLabel: "Independent",
      };
      const assignment = stationAssignments.get(agentId);
      const latestBubble = latestAgentBubbleById.get(agentId);
      const errorActive = latestBubble && clock.now - latestBubble.timestamp < 8000 && isErrorMessage(latestBubble.message);

      let target = { x: home.x, y: home.y };
      let anim: SceneAgent["anim"] = index % 2 === 0 ? "idle" : "sleep";

      if (assignment) {
        const stationSpot = getTaskStationMemberSpot(
          assignment.stationIndex,
          Math.max(1, taskStations.length),
          0,
          1,
        );
        if (assignment.kind === "route") {
          const age = clock.now - assignment.startAt;
          const arriveProgress = clamp(age / 1200, 0, 1);
          const returnProgress = clamp((age - 8500) / 1200, 0, 1);
          if (age < 8500) {
            target = interpolatePoint(home, stationSpot, easeInOut(arriveProgress));
          } else {
            target = interpolatePoint(stationSpot, home, easeInOut(returnProgress));
          }
          anim = age < 1200 || (age >= 8500 && age < 9700) ? "walk" : assignment.speaker ? "type" : "idle";
        } else {
          target = stationSpot;
          anim = assignment.status === "pending" ? "idle" : assignment.speaker ? "type" : "idle";
        }
      }

      if (errorActive) {
        anim = "error";
      }

      return {
        id: agentId,
        label: agentId,
        color: home.color,
        x: target.x,
        y: target.y,
        anim,
        flip: target.x < home.x,
      };
    });
  }, [agentEntries, clock.now, homePositions, latestAgentBubbleById, stationAssignments, taskStations.length]);

  const taskSummaries = useMemo<SceneTaskSummary[]>(() => {
    const allTasks = tasks ?? [];
    return [
      { label: "backlog", count: allTasks.filter((task) => task.status === "backlog").length, tone: "empty" },
      { label: "active", count: allTasks.filter((task) => task.status === "in_progress").length, tone: "running" },
      { label: "review", count: allTasks.filter((task) => task.status === "review").length, tone: "pending" },
      { label: "done", count: allTasks.filter((task) => task.status === "done").length, tone: "done" },
    ];
  }, [tasks]);

  const queueSnapshot = useMemo<SceneQueueSnapshot>(
    () => ({
      incoming: queueStatus?.incoming ?? 0,
      processing: queueStatus?.processing ?? 0,
      outgoing: queueStatus?.outgoing ?? 0,
      activeConversations: queueStatus?.activeConversations ?? 0,
    }),
    [queueStatus],
  );

  const responseItems = useMemo<SceneResponseItem[]>(
    () =>
      (responses ?? []).map((response) => ({
        id: response.messageId,
        label: trimText(response.message, 40),
        subtitle: responseSubtitle(response),
        tone: responseTone(response),
      })),
    [responses],
  );

  const routeRoot = latestUserBubble
    ? trimText(latestUserBubble.message, 20)
    : activeTasks[0]
      ? trimText(activeTasks[0].title, 20)
      : "no active route";

  const routeTargets = useMemo<SceneRouteTarget[]>(() => {
    if (latestUserBubble) {
      return latestUserBubble.targetAgents
        .slice(0, 3)
        .map((agentId) => {
          const agent = sceneAgents.find((entry) => entry.id === agentId);
          return {
            label: agentId,
            color: agent?.color ?? AGENT_COLORS[0],
            state: stationAssignments.get(agentId)?.status ?? "pending",
          };
        });
    }

    return activeTasks
      .slice(0, 3)
      .map((task) => ({
        label: task.assignee || "unassigned",
        color: AGENT_COLORS[0],
        state: taskTone(task),
      }));
  }, [activeTasks, latestUserBubble, sceneAgents, stationAssignments]);

  const activeWorkers = sceneAgents.filter((agent) => agent.anim === "type" || agent.anim === "walk").length;
  const statusLabel = sending
    ? "dispatching new message"
    : queueSnapshot.processing > 0
      ? `${queueSnapshot.processing} chains running · ${activeWorkers} agents in motion`
      : activeTasks.length > 0
        ? `${activeTasks.length} active tasks on the floor`
        : connected
          ? "floor is live and waiting"
          : "waiting for live event stream";

  const overlayBubbles = useMemo<OverlayBubble[]>(() => {
    const items: OverlayBubble[] = [];

    if (latestUserBubble && clock.now - latestUserBubble.timestamp < 10000) {
      items.push({
        id: latestUserBubble.id,
        x: 585,
        y: 80,
        color: "#7c3aed",
        heading: "control input",
        message: trimText(latestUserBubble.message, 220),
      });
    }

    latestAgentBubbleById.forEach((bubble, agentId) => {
      if (clock.now - bubble.timestamp > 9000) return;
      const agent = sceneAgents.find((entry) => entry.id === agentId);
      if (!agent) return;
      items.push({
        id: bubble.id,
        x: agent.x,
        y: agent.y - 82,
        color: agent.color,
        heading: "agent update",
        message: trimText(bubble.message, 220),
      });
    });

    return items;
  }, [clock.now, latestAgentBubbleById, latestUserBubble, sceneAgents]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top,#1b2440,#0c0a09_58%)] p-3">
        <div className="relative size-full">
          <PixelOfficeScene
            frame={clock.frame}
            connected={connected}
            statusLabel={statusLabel}
            queue={queueSnapshot}
            routeRoot={routeRoot}
            routeTargets={routeTargets}
            lounge={loungeModel}
            taskStations={taskStations}
            taskSummaries={taskSummaries}
            responses={responseItems}
            agents={sceneAgents}
          />

          {overlayBubbles.map((bubble) => {
            const position = pointToPercent(bubble.x, bubble.y);
            return (
              <div
                key={bubble.id}
                className="absolute z-20 max-w-[380px] -translate-x-1/2 -translate-y-full animate-slide-up"
                style={{ left: position.left, top: position.top }}
              >
                <div
                  className="relative rounded-md border px-3 py-2 text-[11px] leading-relaxed text-white shadow-xl"
                  style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                >
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: bubble.color }}>
                    {bubble.heading}
                  </div>
                  <p className="break-words">{bubble.message}</p>
                  <div
                    className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b"
                    style={{ borderColor: bubble.color, background: "rgba(17, 24, 39, 0.94)" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message @agent or @team..."
            className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!chatInput.trim() || sending}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>Cmd/Ctrl + Enter to send</span>
          <span>
            {connected ? "SSE online" : "SSE disconnected"} · {taskSummaries[1]?.count ?? 0} active · {queueSnapshot.outgoing} outgoing
          </span>
        </div>
      </div>
    </div>
  );
}
