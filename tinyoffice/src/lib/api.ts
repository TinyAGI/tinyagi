const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  provider: string;
  model: string;
  working_directory: string;
  system_prompt?: string;
  prompt_file?: string;
}

export interface TeamConfig {
  name: string;
  agents: string[];
  leader_agent: string;
}

export interface Settings {
  workspace?: { path?: string; name?: string };
  channels?: {
    enabled?: string[];
    discord?: { bot_token?: string };
    telegram?: { bot_token?: string };
    whatsapp?: Record<string, unknown>;
  };
  models?: {
    provider?: string;
    anthropic?: { model?: string };
    openai?: { model?: string };
    opencode?: { model?: string };
  };
  agents?: Record<string, AgentConfig>;
  teams?: Record<string, TeamConfig>;
  monitoring?: { heartbeat_interval?: number };
}

export interface QueueStatus {
  incoming: number;
  processing: number;
  outgoing: number;
  activeConversations: number;
}

export interface ResponseData {
  channel: string;
  sender: string;
  message: string;
  originalMessage: string;
  timestamp: number;
  messageId: string;
  agent?: string;
  files?: string[];
}

export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function getAgents(): Promise<Record<string, AgentConfig>> {
  return apiFetch("/api/agents");
}

export async function getTeams(): Promise<Record<string, TeamConfig>> {
  return apiFetch("/api/teams");
}

export async function getSettings(): Promise<Settings> {
  return apiFetch("/api/settings");
}

export async function updateSettings(settings: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> {
  return apiFetch("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export async function getQueueStatus(): Promise<QueueStatus> {
  return apiFetch("/api/queue/status");
}

export async function getResponses(limit = 20): Promise<ResponseData[]> {
  return apiFetch(`/api/responses?limit=${limit}`);
}

export async function getLogs(limit = 100): Promise<{ lines: string[] }> {
  return apiFetch(`/api/logs?limit=${limit}`);
}

export async function saveAgent(
  id: string,
  agent: AgentConfig
): Promise<{ ok: boolean; agent: AgentConfig }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(agent),
  });
}

export async function deleteAgent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function saveTeam(
  id: string,
  team: TeamConfig
): Promise<{ ok: boolean; team: TeamConfig }> {
  return apiFetch(`/api/teams/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(team),
  });
}

export async function deleteTeam(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendMessage(payload: {
  message: string;
  agent?: string;
  sender?: string;
  channel?: string;
}): Promise<{ ok: boolean; messageId: string }> {
  return apiFetch("/api/message", { method: "POST", body: JSON.stringify(payload) });
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "in_progress" | "review" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  assigneeType: "agent" | "team" | "";
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export async function getTasks(): Promise<Task[]> {
  return apiFetch("/api/tasks");
}

export async function createTask(task: Partial<Task>): Promise<{ ok: boolean; task: Task }> {
  return apiFetch("/api/tasks", { method: "POST", body: JSON.stringify(task) });
}

export async function updateTask(id: string, task: Partial<Task>): Promise<{ ok: boolean; task: Task }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(task) });
}

export async function deleteTask(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function reorderTasks(columns: Record<string, string[]>): Promise<{ ok: boolean }> {
  return apiFetch("/api/tasks/reorder", { method: "PUT", body: JSON.stringify({ columns }) });
}

// ── Chat Room ────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  team_id: string;
  from_agent: string;
  message: string;
  created_at: number;
}

export async function getChatMessages(
  teamId: string,
  limit = 100,
  sinceId = 0
): Promise<ChatMessage[]> {
  return apiFetch(`/api/chatroom/${encodeURIComponent(teamId)}?limit=${limit}&since=${sinceId}`);
}

export async function postChatMessage(
  teamId: string,
  message: string
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/chatroom/${encodeURIComponent(teamId)}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

// ── Projects (localStorage) ─────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

const PROJECTS_KEY = "tinyclaw_projects";

function readProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export async function getProjects(): Promise<Project[]> {
  return readProjects();
}

export async function createProject(
  data: Pick<Project, "name" | "description">
): Promise<{ ok: boolean; project: Project }> {
  const projects = readProjects();
  const project: Project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: data.name,
    description: data.description,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  projects.push(project);
  writeProjects(projects);
  return { ok: true, project };
}

export async function updateProject(
  id: string,
  data: Partial<Omit<Project, "id" | "createdAt">>
): Promise<{ ok: boolean; project: Project }> {
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Project not found");
  projects[idx] = { ...projects[idx], ...data, updatedAt: Date.now() };
  writeProjects(projects);
  return { ok: true, project: projects[idx] };
}

export async function deleteProject(id: string): Promise<{ ok: boolean }> {
  const projects = readProjects();
  writeProjects(projects.filter((p) => p.id !== id));
  return { ok: true };
}

// ── SSE ───────────────────────────────────────────────────────────────────

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/events/stream`);

  const handler = (e: MessageEvent) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
  };

  // Listen to all known event types
  const eventTypes = [
    "message_received", "agent_routed", "chain_step_start", "chain_step_done",
    "chain_handoff", "team_chain_start", "team_chain_end", "response_ready",
    "processor_start", "message_enqueued",
  ];
  for (const type of eventTypes) {
    es.addEventListener(type, handler);
  }

  if (onError) es.onerror = onError;

  return () => es.close();
}
