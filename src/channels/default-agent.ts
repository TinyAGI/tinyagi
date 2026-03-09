/**
 * Per-chat default agent tracking for channel clients.
 *
 * When a user sends `@agent_id message`, the channel client stores that agent
 * as the default for the chat. Subsequent messages without an @-prefix are
 * automatically routed to the stored default agent.
 *
 * Defaults persist across restarts via a JSON file in TINYCLAW_HOME.
 */

import fs from 'fs';
import path from 'path';

// Per-chat default agent: chatKey → agentId (the raw @-prefix value)
let defaultAgentPerChat = new Map<string, string>();
let persistPath: string | null = null;

/**
 * Initialize persistence. Call once at startup with the TINYCLAW_HOME path.
 * If not called, defaults are in-memory only.
 */
export function initPersistence(tinyclawHome: string): void {
    persistPath = path.join(tinyclawHome, 'default-agents.json');
    try {
        if (fs.existsSync(persistPath)) {
            const data = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
            defaultAgentPerChat = new Map(Object.entries(data));
        }
    } catch {
        // Corrupt or unreadable — start fresh
    }
}

function saveDefaults(): void {
    if (!persistPath) return;
    try {
        const dir = path.dirname(persistPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(persistPath, JSON.stringify(Object.fromEntries(defaultAgentPerChat)));
    } catch {
        // Best-effort persistence
    }
}

interface AgentMatchResult {
    /** The @-prefix value the user typed (e.g. "coder") */
    tag: string;
    /** Display name resolved from settings (e.g. "Coder") */
    displayName: string;
    /** Whether this matched a team rather than an agent */
    isTeam: boolean;
}

/**
 * Try to resolve a candidate tag to a valid agent or team.
 * Returns match info or null if no match found.
 */
export function resolveAgentTag(candidateTag: string, settingsFile: string): AgentMatchResult | null {
    try {
        const settingsData = fs.readFileSync(settingsFile, 'utf8');
        const settings = JSON.parse(settingsData);
        const agents = settings.agents || {};
        const teams = settings.teams || {};
        const candidate = candidateTag.toLowerCase();

        // Check agent IDs
        if (agents[candidate]) {
            return { tag: candidate, displayName: agents[candidate].name, isTeam: false };
        }

        // Check team IDs
        if (teams[candidate]) {
            return { tag: candidate, displayName: teams[candidate].name, isTeam: true };
        }

        // Match by agent name (case-insensitive)
        for (const [id, config] of Object.entries(agents) as [string, any][]) {
            if (config.name.toLowerCase() === candidate) {
                return { tag: id, displayName: config.name, isTeam: false };
            }
        }

        // Match by team name (case-insensitive)
        for (const [id, config] of Object.entries(teams) as [string, any][]) {
            if (config.name.toLowerCase() === candidate) {
                return { tag: id, displayName: config.name, isTeam: true };
            }
        }
    } catch {
        // Settings unreadable — can't validate
    }
    return null;
}

/**
 * Process an incoming message for default-agent logic.
 *
 * - If the message starts with `@tag`, validate the tag and store it as default.
 *   Returns the original message unchanged plus a switch confirmation message.
 * - If the message is just `@tag` with no body, switches the default and returns
 *   null message to indicate no message should be queued.
 * - If the message has no `@tag` but a default is stored, prepends the default tag.
 * - Otherwise returns the message unchanged.
 */
export function applyDefaultAgent(
    chatKey: string,
    messageText: string,
    settingsFile: string,
): { message: string | null; switchNotification: string | null } {
    // Match @tag with optional space+body (handles both "@coder fix bug" and "@coder")
    const atMatch = messageText.match(/^@(\S+)(?:\s+([\s\S]*))?$/);

    if (atMatch) {
        const candidateTag = atMatch[1];
        const body = atMatch[2]?.trim() || '';

        // Special case: "@default" clears the sticky default
        if (candidateTag.toLowerCase() === 'default') {
            const had = defaultAgentPerChat.has(chatKey);
            defaultAgentPerChat.delete(chatKey);
            saveDefaults();
            if (had) {
                return { message: null, switchNotification: 'Cleared default agent. Messages will use default routing.' };
            }
            return { message: null, switchNotification: 'No default agent was set.' };
        }

        const match = resolveAgentTag(candidateTag, settingsFile);
        if (match) {
            const previous = defaultAgentPerChat.get(chatKey);
            defaultAgentPerChat.set(chatKey, match.tag);
            saveDefaults();

            // Only notify if the default actually changed
            const switched = previous !== match.tag;
            const kind = match.isTeam ? 'team' : 'agent';
            const notification = switched
                ? `Switched to ${kind} @${match.tag} (${match.displayName}). Future messages will be routed here automatically. Send @default to clear.`
                : null;

            if (!body) {
                // Tag-only message like "@coder" — just switch, don't queue a message
                return { message: null, switchNotification: notification };
            }

            // Pass through the original message (server will also parse the @tag)
            return { message: messageText, switchNotification: notification };
        }
        // Unrecognized @tag — pass through as-is, don't touch default
        return { message: messageText, switchNotification: null };
    }

    // No @-prefix — apply stored default if any
    const storedDefault = defaultAgentPerChat.get(chatKey);
    if (storedDefault) {
        return { message: `@${storedDefault} ${messageText}`, switchNotification: null };
    }

    return { message: messageText, switchNotification: null };
}

/**
 * Get the current default agent for a chat, or null if none set.
 */
export function getDefaultAgent(chatKey: string): string | null {
    return defaultAgentPerChat.get(chatKey) ?? null;
}

/**
 * Clear the default agent for a chat.
 */
export function clearDefaultAgent(chatKey: string): void {
    defaultAgentPerChat.delete(chatKey);
    saveDefaults();
}
