"use client";

import { useState, useEffect } from "react";
import { getSettings, updateSettings, runSetup, type Settings, type AgentConfig } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wifi,
  MessageSquare,
  Cpu,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";

// ── Provider / model definitions (mirrored from CLI shared.ts) ───────────

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)", hint: "recommended" },
  { value: "openai", label: "OpenAI (Codex/GPT)" },
  { value: "opencode", label: "OpenCode" },
] as const;

const MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
  ],
  openai: [
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
  ],
  opencode: [
    { value: "opencode/claude-sonnet-4-5", label: "opencode/claude-sonnet-4-5" },
    { value: "opencode/claude-opus-4-6", label: "opencode/claude-opus-4-6" },
    { value: "opencode/gemini-3-flash", label: "opencode/gemini-3-flash" },
    { value: "opencode/gemini-3-pro", label: "opencode/gemini-3-pro" },
  ],
};

const CHANNELS = [
  { id: "discord", label: "Discord", needsToken: true, tokenHint: "Bot token from discord.com/developers" },
  { id: "telegram", label: "Telegram", needsToken: true, tokenHint: "Token from @BotFather" },
  { id: "whatsapp", label: "WhatsApp", needsToken: false, tokenHint: "" },
] as const;

// ── Setup wizard types ───────────────────────────────────────────────────

interface SetupAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
}

function cleanId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

// ── Main page component ──────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setRawJson(JSON.stringify(s, null, 2));
        // Show setup wizard if settings are effectively empty
        const isEmpty = !s || (Object.keys(s).length === 0) ||
          (!s.channels?.enabled?.length && !s.agents && !s.models?.provider);
        setNeedsSetup(isEmpty);
      })
      .catch((err) => {
        setErrorMsg(err.message);
        setStatus("error");
        setNeedsSetup(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(rawJson);
      const result = await updateSettings(parsed);
      setSettings(result.settings);
      setRawJson(JSON.stringify(result.settings, null, 2));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleSetupComplete = (newSettings: Settings) => {
    setSettings(newSettings);
    setRawJson(JSON.stringify(newSettings, null, 2));
    setNeedsSetup(false);
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading settings...
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-primary" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and edit TinyClaw configuration
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status === "saved" && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {errorMsg}
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => setNeedsSetup(true)}
          >
            <Wand2 className="h-4 w-4" />
            Run Setup
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
          </Button>
        </div>
      </div>

      {settings && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
            title="Workspace"
            value={settings.workspace?.name || settings.workspace?.path || "Default"}
          />
          <OverviewCard
            icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
            title="Default Provider"
            value={settings.models?.provider || "anthropic"}
          />
          <OverviewCard
            icon={<Wifi className="h-4 w-4 text-muted-foreground" />}
            title="Channels"
            value={settings.channels?.enabled?.join(", ") || "None"}
          />
          <OverviewCard
            icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
            title="Heartbeat"
            value={settings.monitoring?.heartbeat_interval ? `${settings.monitoring.heartbeat_interval}s` : "Disabled"}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Configuration (settings.json)
            <Badge variant="outline" className="text-[10px]">JSON</Badge>
          </CardTitle>
          <CardDescription>
            Edit the raw configuration. Changes take effect on next message processing cycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={30}
            className="font-mono text-xs leading-relaxed"
            spellCheck={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <ApiEndpoint method="POST" path="/api/message" desc="Send a message to the queue" />
            <ApiEndpoint method="GET" path="/api/agents" desc="List all agents" />
            <ApiEndpoint method="GET" path="/api/teams" desc="List all teams" />
            <ApiEndpoint method="GET" path="/api/settings" desc="Get current settings" />
            <ApiEndpoint method="PUT" path="/api/settings" desc="Update settings" />
            <ApiEndpoint method="GET" path="/api/queue/status" desc="Queue status" />
            <ApiEndpoint method="GET" path="/api/responses" desc="Recent responses" />
            <ApiEndpoint method="GET" path="/api/events/stream" desc="SSE event stream" />
            <ApiEndpoint method="GET" path="/api/events" desc="Recent events (polling)" />
            <ApiEndpoint method="GET" path="/api/logs" desc="Queue processor logs" />
            <ApiEndpoint method="GET" path="/api/chats" desc="Chat histories" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Setup Wizard ─────────────────────────────────────────────────────────

const STEPS = ["Channels", "Provider", "Workspace", "Agents", "Review"] as const;

function SetupWizard({ onComplete }: { onComplete: (s: Settings) => void }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [enabledChannels, setEnabledChannels] = useState<string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("sonnet");
  const [heartbeat, setHeartbeat] = useState("3600");
  const [workspaceName, setWorkspaceName] = useState("tinyclaw-workspace");
  const [agents, setAgents] = useState<SetupAgent[]>([
    { id: "assistant", name: "Assistant", provider: "anthropic", model: "sonnet" },
  ]);

  const canNext = (): boolean => {
    switch (step) {
      case 0: return enabledChannels.length > 0;
      case 1: return !!provider && !!model;
      case 2: return !!workspaceName.trim();
      case 3: return agents.length > 0 && agents.every(a => a.id && a.name);
      case 4: return true;
      default: return false;
    }
  };

  const toggleChannel = (ch: string) => {
    setEnabledChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    );
  };

  const updateAgent = (idx: number, patch: Partial<SetupAgent>) => {
    setAgents(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
  };

  const removeAgent = (idx: number) => {
    setAgents(prev => prev.filter((_, i) => i !== idx));
  };

  const addAgent = () => {
    setAgents(prev => [...prev, { id: "", name: "", provider, model }]);
  };

  // When provider changes at the global level, update default model
  const handleProviderChange = (p: string) => {
    setProvider(p);
    const models = MODELS[p];
    if (models?.length) setModel(models[0].value);
  };

  const buildSettings = (): Settings => {
    const sanitizedName = workspaceName.replace(/ /g, "-").replace(/[^a-zA-Z0-9_/~.-]/g, "");
    const workspacePath = sanitizedName.startsWith("/") || sanitizedName.startsWith("~")
      ? sanitizedName
      : `~/` + sanitizedName;

    const agentsMap: Record<string, AgentConfig> = {};
    for (const a of agents) {
      const id = cleanId(a.id) || "assistant";
      agentsMap[id] = {
        name: a.name || id,
        provider: a.provider,
        model: a.model,
        working_directory: `${workspacePath}/${id}`.replace(/^~/, "$HOME"),
      };
    }

    return {
      workspace: { path: workspacePath.replace(/^~/, "$HOME"), name: sanitizedName },
      channels: {
        enabled: enabledChannels,
        discord: { bot_token: tokens["discord"] || "" },
        telegram: { bot_token: tokens["telegram"] || "" },
        whatsapp: {},
      },
      agents: agentsMap,
      models: {
        provider,
        ...(provider === "anthropic" ? { anthropic: { model } } : {}),
        ...(provider === "openai" ? { openai: { model } } : {}),
        ...(provider === "opencode" ? { opencode: { model } } : {}),
      },
      monitoring: { heartbeat_interval: parseInt(heartbeat) || 3600 },
    };
  };

  const handleFinish = async () => {
    try {
      setSaving(true);
      setError("");
      const settings = buildSettings();
      const result = await runSetup(settings);
      onComplete(result.settings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          Setup
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure TinyClaw in a few steps
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              className={`text-xs px-2 py-1 transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                  ? "bg-accent text-accent-foreground cursor-pointer"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {step === 0 && (
            <>
              <CardTitle className="text-sm">Messaging Channels</CardTitle>
              <CardDescription>Select which channels to enable.</CardDescription>
              <div className="space-y-3 pt-2">
                {CHANNELS.map(ch => (
                  <div key={ch.id} className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabledChannels.includes(ch.id)}
                        onChange={() => toggleChannel(ch.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm font-medium">{ch.label}</span>
                    </label>
                    {ch.needsToken && enabledChannels.includes(ch.id) && (
                      <div className="ml-7">
                        <Input
                          type="password"
                          placeholder={ch.tokenHint}
                          value={tokens[ch.id] || ""}
                          onChange={e => setTokens(prev => ({ ...prev, [ch.id]: e.target.value }))}
                          className="text-xs"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <CardTitle className="text-sm">AI Provider & Model</CardTitle>
              <CardDescription>Choose the default provider and model for agents.</CardDescription>
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
                  <Select value={provider} onChange={e => handleProviderChange(e.target.value)} className="mt-1">
                    {PROVIDERS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</label>
                  <Select value={model} onChange={e => setModel(e.target.value)} className="mt-1">
                    {(MODELS[provider] || []).map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Heartbeat Interval (seconds)</label>
                  <Input
                    type="number"
                    value={heartbeat}
                    onChange={e => setHeartbeat(e.target.value)}
                    placeholder="3600"
                    className="mt-1"
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <CardTitle className="text-sm">Workspace</CardTitle>
              <CardDescription>Where agent working directories will be created.</CardDescription>
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workspace name or path</label>
                <Input
                  value={workspaceName}
                  onChange={e => setWorkspaceName(e.target.value)}
                  placeholder="tinyclaw-workspace"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Relative names are created under ~/. Use an absolute path to place it elsewhere.
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <CardTitle className="text-sm">Agents</CardTitle>
              <CardDescription>Configure your agents. Each gets its own workspace directory.</CardDescription>
              <div className="space-y-4 pt-2">
                {agents.map((agent, idx) => (
                  <div key={idx} className="border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Agent {idx + 1}</span>
                      {agents.length > 1 && (
                        <button onClick={() => removeAgent(idx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">ID</label>
                        <Input
                          value={agent.id}
                          onChange={e => updateAgent(idx, { id: cleanId(e.target.value) })}
                          placeholder="assistant"
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">Display Name</label>
                        <Input
                          value={agent.name}
                          onChange={e => updateAgent(idx, { name: e.target.value })}
                          placeholder="Assistant"
                          className="text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">Provider</label>
                        <Select
                          value={agent.provider}
                          onChange={e => {
                            const p = e.target.value;
                            const m = MODELS[p]?.[0]?.value || "";
                            updateAgent(idx, { provider: p, model: m });
                          }}
                          className="text-xs"
                        >
                          {PROVIDERS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase">Model</label>
                        <Select
                          value={agent.model}
                          onChange={e => updateAgent(idx, { model: e.target.value })}
                          className="text-xs"
                        >
                          {(MODELS[agent.provider] || []).map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" onClick={addAgent} className="w-full">
                  <Plus className="h-4 w-4" />
                  Add Agent
                </Button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <CardTitle className="text-sm">Review</CardTitle>
              <CardDescription>Confirm your configuration before saving.</CardDescription>
              <div className="pt-2 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <ReviewItem label="Channels" value={enabledChannels.length > 0 ? enabledChannels.join(", ") : "None"} />
                  <ReviewItem label="Provider" value={provider} />
                  <ReviewItem label="Model" value={model} />
                  <ReviewItem label="Heartbeat" value={`${heartbeat}s`} />
                  <ReviewItem label="Workspace" value={workspaceName} />
                  <ReviewItem label="Agents" value={agents.map(a => a.id || "(unnamed)").join(", ")} />
                </div>
                <Textarea
                  value={JSON.stringify(buildSettings(), null, 2)}
                  readOnly
                  rows={16}
                  className="font-mono text-xs leading-relaxed mt-3"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(s => s - 1)}
          disabled={step === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Finish Setup
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function OverviewCard({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        </div>
        <p className="text-sm font-medium truncate">{value}</p>
      </CardContent>
    </Card>
  );
}

function ApiEndpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const methodColor = method === "POST" ? "bg-blue-500/10 text-blue-500" :
    method === "PUT" ? "bg-orange-500/10 text-orange-500" :
    "bg-green-500/10 text-green-500";

  return (
    <div className="flex items-center gap-3 border p-3">
      <Badge className={`${methodColor} text-[10px] font-mono`}>{method}</Badge>
      <code className="text-xs font-mono flex-1">{path}</code>
      <span className="text-xs text-muted-foreground hidden lg:inline">{desc}</span>
    </div>
  );
}
