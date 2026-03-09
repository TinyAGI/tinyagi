/**
 * Per-chat default agent tracking for channel clients.
 *
 * When a user sends `@agent_id message`, the channel client stores that agent
 * as the default for the chat. Subsequent messages without an @-prefix are
 * automatically routed to the stored default agent.
 */

import fs from 'fs';

// Per-chat default agent: chatKey → agentId (the raw @-prefix value)
const defaultAgentPerChat = new Map<string, string>();

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
 * - If the message has no `@tag` but a default is stored, prepends the default tag.
 * - Otherwise returns the message unchanged.
 */
export function applyDefaultAgent(
    chatKey: string,
    messageText: string,
    settingsFile: string,
): { message: string; switchNotification: string | null } {
    const atMatch = messageText.match(/^@(\S+)\s+([\s\S]*)$/);

    if (atMatch) {
        const candidateTag = atMatch[1];
        const match = resolveAgentTag(candidateTag, settingsFile);
        if (match) {
            const previous = defaultAgentPerChat.get(chatKey);
            defaultAgentPerChat.set(chatKey, match.tag);

            // Only notify if the default actually changed
            const switched = previous !== match.tag;
            const kind = match.isTeam ? 'team' : 'agent';
            const notification = switched
                ? `Switched to ${kind} @${match.tag} (${match.displayName}). Future messages will be routed here automatically.`
                : null;

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
}
