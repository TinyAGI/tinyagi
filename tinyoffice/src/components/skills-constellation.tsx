"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";

// ── Skill registry types ──────────────────────────────────────────────────

export interface SkillEntry {
  id: string;
  name: string;
  repo: string;        // org/repo
  registry: string;    // "skills.sh" | "clawhub"
  downloads: number;
  tags: string[];
  description: string;
  icon?: string;       // emoji or short text
}

interface SkillNode extends SkillEntry {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface ConstellationProps {
  skills: SkillEntry[];
  equipped: Set<string>;
  onToggle: (id: string) => void;
  agentName: string;
  agentInitials: string;
}

// ── Pre-built skill registries ─────────────────────────────────────────────

export const SKILL_REGISTRY: SkillEntry[] = [
  // skills.sh registry
  { id: "tasks", name: "tasks", repo: "tinyclaw/skills", registry: "skills.sh", downloads: 2100, tags: ["productivity", "kanban"], description: "Kanban task management - create, update, list tasks", icon: "T" },
  { id: "agent-browser", name: "agent-browser", repo: "vercel-labs/agent-browser", registry: "skills.sh", downloads: 48000, tags: ["browser", "automation"], description: "Browser automation - open, snapshot, click, fill forms", icon: "B" },
  { id: "send-message", name: "send-message", repo: "tinyclaw/skills", registry: "skills.sh", downloads: 1800, tags: ["messaging", "channels"], description: "Send proactive messages via Discord, Telegram, WhatsApp", icon: "M" },
  { id: "imagegen", name: "imagegen", repo: "tinyclaw/skills", registry: "skills.sh", downloads: 950, tags: ["media", "generation"], description: "Generate images from text descriptions", icon: "I" },
  { id: "schedule", name: "schedule", repo: "tinyclaw/skills", registry: "skills.sh", downloads: 720, tags: ["scheduling", "automation"], description: "Schedule messages and tasks for future delivery", icon: "S" },
  { id: "skill-creator", name: "skill-creator", repo: "tinyclaw/skills", registry: "skills.sh", downloads: 600, tags: ["development", "tools"], description: "Create custom skills from templates", icon: "+" },
  { id: "tinyclaw-admin", name: "tinyclaw-admin", repo: "tinyclaw/skills", registry: "skills.sh", downloads: 450, tags: ["admin", "api"], description: "Admin operations via TinyClaw API", icon: "A" },

  // skills.sh community
  { id: "react-best-practices", name: "react-best-practices", repo: "vercel-labs/agent-skills", registry: "skills.sh", downloads: 27000, tags: ["react", "frontend"], description: "React patterns, hooks, and performance optimization", icon: "R" },
  { id: "data-fetching", name: "data-fetching", repo: "vercel-labs/agent-skills", registry: "skills.sh", downloads: 14000, tags: ["api", "data"], description: "Data fetching patterns, caching, and SWR strategies", icon: "D" },
  { id: "building-ui", name: "building-ui", repo: "vercel-labs/agent-skills", registry: "skills.sh", downloads: 9800, tags: ["ui", "frontend"], description: "UI component patterns and accessibility best practices", icon: "U" },
  { id: "frontend-design", name: "frontend-design", repo: "vercel-labs/agent-skills", registry: "skills.sh", downloads: 7200, tags: ["design", "css"], description: "Frontend design systems, layouts, and responsive patterns", icon: "F" },
  { id: "api-routing", name: "api-routing", repo: "vercel-labs/agent-skills", registry: "skills.sh", downloads: 5400, tags: ["api", "backend"], description: "API route patterns and middleware strategies", icon: "P" },

  // clawhub registry
  { id: "create-auth-skill", name: "create-auth-skill", repo: "better-auth/skills", registry: "clawhub", downloads: 800, tags: ["auth", "security"], description: "Authentication skill scaffolding with OAuth, JWT, sessions", icon: "K" },
  { id: "better-auth-practices", name: "better-auth-practices", repo: "better-auth/skills", registry: "clawhub", downloads: 1200, tags: ["auth", "security"], description: "Authentication best practices and security patterns", icon: "L" },
  { id: "expo-skills", name: "expo-skills", repo: "expo/skills", registry: "clawhub", downloads: 14000, tags: ["mobile", "react-native"], description: "Expo and React Native development patterns", icon: "E" },
  { id: "upgrading-expo", name: "upgrading-expo", repo: "expo/skills", registry: "clawhub", downloads: 2100, tags: ["mobile", "migration"], description: "Expo upgrade guides and migration helpers", icon: "X" },
  { id: "remotion-skills", name: "remotion-skills", repo: "remotion-dev/skills", registry: "clawhub", downloads: 3200, tags: ["video", "media"], description: "Programmatic video creation with Remotion", icon: "V" },
  { id: "marketing-skills", name: "marketing-skills", repo: "coreyhaines31/marketingskills", registry: "clawhub", downloads: 11000, tags: ["marketing", "seo"], description: "Marketing automation, SEO, and content strategies", icon: "m" },
  { id: "copywriting", name: "copywriting", repo: "coreyhaines31/marketingskills", registry: "clawhub", downloads: 8500, tags: ["marketing", "writing"], description: "Copywriting patterns and conversion optimization", icon: "C" },
  { id: "pdf-skills", name: "pdf-skills", repo: "anthropics/skills", registry: "clawhub", downloads: 6800, tags: ["documents", "parsing"], description: "PDF generation, parsing, and document manipulation", icon: "P" },
  { id: "dev-client", name: "dev-client", repo: "anthropics/skills", registry: "clawhub", downloads: 4200, tags: ["development", "tools"], description: "Development client utilities and debugging tools", icon: "d" },
  { id: "seo-audit", name: "seo-audit", repo: "coreyhaines31/marketingskills", registry: "clawhub", downloads: 780, tags: ["seo", "audit"], description: "SEO auditing and optimization recommendations", icon: "s" },
  { id: "callstack-agent", name: "callstack-agent", repo: "callstackincubator/agent-skills", registry: "clawhub", downloads: 1100, tags: ["react-native", "mobile"], description: "React Native agent skills from Callstack", icon: "c" },
  { id: "rn-best-practices", name: "react-native-best-practices", repo: "callstackincubator/agent-skills", registry: "clawhub", downloads: 1400, tags: ["react-native", "mobile"], description: "React Native best practices and performance tips", icon: "N" },
  { id: "baoyu-skills", name: "baoyu-skills", repo: "jimliu/baoyu-skills", registry: "clawhub", downloads: 3100, tags: ["translation", "i18n"], description: "Translation and internationalization skill pack", icon: "J" },
];

// ── Format download count ──────────────────────────────────────────────────

function formatDownloads(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

// ── Constellation component ────────────────────────────────────────────────

export function SkillsConstellation({
  skills,
  equipped,
  onToggle,
  agentName,
  agentInitials,
}: ConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 900, h: 560 });
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const nodesRef = useRef<SkillNode[]>([]);
  const [, forceRender] = useState(0);
  const animFrameRef = useRef<number>(0);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      setDimensions({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Initialize node positions in a spread-out pattern
  useEffect(() => {
    const cx = dimensions.w / 2;
    const cy = dimensions.h / 2;
    const existing = new Map(nodesRef.current.map(n => [n.id, n]));

    nodesRef.current = skills.map((s, i) => {
      const prev = existing.get(s.id);
      if (prev) return { ...prev, ...s };

      // Distribute nodes in expanding rings
      const ring = Math.floor(i / 8);
      const angleInRing = (i % 8) / 8 * Math.PI * 2;
      const radius = 120 + ring * 100 + (Math.random() * 40 - 20);
      const angle = angleInRing + (Math.random() * 0.3 - 0.15);

      return {
        ...s,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });

    forceRender(n => n + 1);
  }, [skills, dimensions.w, dimensions.h]);

  // Physics simulation - gentle floating
  useEffect(() => {
    const cx = dimensions.w / 2;
    const cy = dimensions.h / 2;
    let tick = 0;

    const step = () => {
      tick++;
      const nodes = nodesRef.current;
      const padding = 60;

      for (const node of nodes) {
        // Gentle floating motion
        node.x += Math.sin(tick * 0.008 + node.id.length) * 0.15;
        node.y += Math.cos(tick * 0.006 + node.id.charCodeAt(0)) * 0.12;

        // Soft pull toward center ring
        const dx = node.x - cx;
        const dy = node.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const targetDist = 180;
        if (dist > targetDist + 120) {
          node.x -= dx * 0.002;
          node.y -= dy * 0.002;
        }

        // Keep within bounds
        node.x = Math.max(padding, Math.min(dimensions.w - padding, node.x));
        node.y = Math.max(padding, Math.min(dimensions.h - padding, node.y));
      }

      // Node repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 90 && dist > 0) {
            const force = (90 - dist) * 0.02;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].x -= fx;
            nodes[i].y -= fy;
            nodes[j].x += fx;
            nodes[j].y += fy;
          }
        }
      }

      if (tick % 3 === 0) forceRender(n => n + 1);
      animFrameRef.current = requestAnimationFrame(step);
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [dimensions]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-skill-node]")) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
  }, [dragOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setDragOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Compute connection lines between same-repo or same-tag skills
  const connections = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; opacity: number }[] = [];
    const nodes = nodesRef.current;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const sameRepo = a.repo === b.repo;
        const sharedTag = a.tags.some(t => b.tags.includes(t));
        if (sameRepo || sharedTag) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 300) {
            lines.push({
              x1: a.x, y1: a.y,
              x2: b.x, y2: b.y,
              opacity: sameRepo ? 0.2 : 0.07,
            });
          }
        }
      }
    }
    return lines;
  }, [nodesRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const cx = dimensions.w / 2;
  const cy = dimensions.h / 2;
  const equippedCount = equipped.size;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[560px] overflow-hidden bg-[#0a0a0a] border select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      {/* Radial gradient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, rgba(163,230,53,0.03) 0%, transparent 70%)",
        }}
      />

      {/* SVG layer for connection lines */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={dimensions.w}
        height={dimensions.h}
      >
        <g transform={`translate(${dragOffset.x}, ${dragOffset.y})`}>
          {connections.map((line, i) => (
            <line
              key={i}
              x1={line.x1} y1={line.y1}
              x2={line.x2} y2={line.y2}
              stroke="rgb(163,230,53)"
              strokeWidth={0.5}
              opacity={line.opacity}
            />
          ))}

          {/* Lines from equipped skills to center */}
          {nodesRef.current
            .filter(n => equipped.has(n.id))
            .map(n => (
              <line
                key={`equip-${n.id}`}
                x1={n.x} y1={n.y}
                x2={cx} y2={cy}
                stroke="rgb(163,230,53)"
                strokeWidth={1}
                opacity={0.3}
                strokeDasharray="4 4"
                className="animate-dash"
              />
            ))}
        </g>
      </svg>

      {/* Node layer */}
      <div
        className="absolute inset-0"
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      >
        {/* Character avatar in center */}
        <div
          className="absolute z-20 flex flex-col items-center gap-1"
          style={{ left: cx - 32, top: cy - 44 }}
        >
          <div className="relative">
            <div className="h-16 w-16 border-2 border-primary bg-card flex items-center justify-center text-xl font-bold text-primary">
              {agentInitials}
            </div>
            <div className="absolute -bottom-1 -right-1 h-5 w-5 bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
              {equippedCount}
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
            {agentName}
          </span>
          {equippedCount > 0 && (
            <Badge className="bg-primary/20 text-primary text-[9px] px-1.5 py-0">
              {equippedCount} equipped
            </Badge>
          )}
        </div>

        {/* Skill nodes */}
        {nodesRef.current.map(node => {
          const isEquipped = equipped.has(node.id);
          const isHovered = hoveredSkill === node.id;
          const isRegistry = node.registry === "skills.sh";

          return (
            <div
              key={node.id}
              data-skill-node
              className="absolute group"
              style={{
                left: node.x - 55,
                top: node.y - 18,
                zIndex: isHovered ? 30 : isEquipped ? 15 : 10,
              }}
              onMouseEnter={() => setHoveredSkill(node.id)}
              onMouseLeave={() => setHoveredSkill(null)}
              onClick={() => onToggle(node.id)}
            >
              {/* Node pill */}
              <div
                className={`
                  relative flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer
                  transition-all duration-200 whitespace-nowrap
                  ${isEquipped
                    ? "bg-primary/15 border border-primary/50 text-primary"
                    : "bg-card/80 border border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }
                  ${isHovered ? "scale-110" : ""}
                `}
              >
                {/* Equipped indicator dot */}
                {isEquipped && (
                  <span className="h-1.5 w-1.5 bg-primary animate-pulse-dot" />
                )}

                {/* Registry icon */}
                <span className={`text-[10px] font-bold ${isRegistry ? "text-primary" : "text-blue-400"}`}>
                  {node.icon}
                </span>

                {/* Skill name */}
                <span className="text-xs font-medium">{node.name}</span>

                {/* Download count */}
                <span className="text-[9px] text-muted-foreground/60 ml-0.5">
                  {formatDownloads(node.downloads)}
                </span>
              </div>

              {/* Hover tooltip */}
              {isHovered && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-56 p-3 bg-popover border border-border/80 text-popover-foreground animate-slide-up">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 ${
                      isRegistry
                        ? "bg-primary/20 text-primary"
                        : "bg-blue-500/20 text-blue-400"
                    }`}>
                      {node.registry}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {node.repo}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                    {node.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {node.tags.slice(0, 2).map(t => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 bg-secondary text-secondary-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                    <span className="text-[9px] text-muted-foreground">
                      {node.downloads.toLocaleString()} installs
                    </span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/50">
                    <span className={`text-[10px] font-medium ${isEquipped ? "text-destructive" : "text-primary"}`}>
                      Click to {isEquipped ? "unequip" : "equip"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent z-30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
            Powered by
          </span>
          <span className="text-sm font-bold tracking-tight text-foreground">
            SKILLS
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-primary" />
            <span className="text-[10px] text-muted-foreground">skills.sh</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-blue-400" />
            <span className="text-[10px] text-muted-foreground">clawhub</span>
          </div>
        </div>
      </div>
    </div>
  );
}
