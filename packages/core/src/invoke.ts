import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, CustomProvider, TeamConfig } from './types';
import { SCRIPT_DIR, resolveModel, getSettings } from './config';
import { log } from './logging';
import { ensureAgentDirectory, buildSystemPrompt } from './agent';
import { getAdapter } from './adapters';

// ── Executable resolution ───────────────────────────────────────────────────
// On Windows, `spawn('claude', ...)` fails with ENOENT because `claude` on PATH
// is a `.cmd`/`.ps1` shim, not a real executable. Spawning a `.cmd` would require
// `shell: true`, which on Windows does NOT quote arguments — so messages/system
// prompts containing spaces, quotes, or newlines would break (and risk injection).
//
// To stay shell-free, resolve the command to a real `.exe`: probe PATH for
// `<cmd>.exe`, otherwise dereference the npm `<cmd>.cmd` shim to the `.exe` path
// it launches. Falls back to the bare command (or `.cmd` with shell) if no exe
// is found. Returns the resolved command plus whether a shell is required.
const execCache = new Map<string, { cmd: string; shell: boolean }>();

function resolveExecutable(command: string): { cmd: string; shell: boolean } {
    // Commands with an explicit path or extension, and all non-Windows commands,
    // are spawned as-is.
    if (process.platform !== 'win32') return { cmd: command, shell: false };
    if (command.includes('/') || command.includes('\\') || path.extname(command)) {
        return { cmd: command, shell: false };
    }

    const cached = execCache.get(command);
    if (cached) return cached;

    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    let result: { cmd: string; shell: boolean } = { cmd: command, shell: false };

    outer:
    for (const dir of dirs) {
        // Prefer a real .exe — spawns without a shell, arguments stay intact.
        const exe = path.join(dir, `${command}.exe`);
        if (fs.existsSync(exe)) { result = { cmd: exe, shell: false }; break; }

        // Otherwise dereference an npm `.cmd` shim to the .exe it launches.
        const cmdShim = path.join(dir, `${command}.cmd`);
        if (fs.existsSync(cmdShim)) {
            try {
                const text = fs.readFileSync(cmdShim, 'utf8');
                for (const m of text.matchAll(/"([^"]+\.exe)"/gi)) {
                    const target = m[1].replace(/%~?dp0%?\\?/gi, path.dirname(cmdShim) + path.sep);
                    if (fs.existsSync(target)) { result = { cmd: target, shell: false }; break outer; }
                }
            } catch { /* fall through */ }
            // Couldn't deref — use the shim via a shell as a last resort.
            result = { cmd: cmdShim, shell: true };
            break;
        }
    }

    execCache.set(command, result);
    log('DEBUG', `Resolved executable '${command}' -> '${result.cmd}' (shell: ${result.shell})`);
    return result;
}

// ── Active process tracking ─────────────────────────────────────────────────
// Tracks the active child process per agent for manual session management.
const activeProcesses = new Map<string, ChildProcess>();

export function getActiveAgentIds(): string[] {
    return Array.from(activeProcesses.keys());
}

export function killAgentProcess(agentId: string): boolean {
    const child = activeProcesses.get(agentId);
    if (!child) return false;
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
    activeProcesses.delete(agentId);
    return true;
}

export async function runCommand(command: string, args: string[], cwd?: string, envOverrides?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
        delete env.CLAUDECODE;

        const resolved = resolveExecutable(command);
        const child = spawn(resolved.cmd, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            shell: resolved.shell,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Spawn a command and process stdout line-by-line as they arrive.
 * Calls `onLine` for each complete line. Returns the full stdout when done.
 *
 * The caller can call the returned `signalDone()` to indicate that all useful
 * output has been received (e.g. after a `result` JSON event). After signalDone,
 * the process gets a 30-second grace period to exit; if it doesn't, it's killed.
 * This prevents hangs when the subprocess stalls during post-result cleanup.
 */
export function runCommandStreaming(
    command: string,
    args: string[],
    onLine: (line: string) => void,
    cwd?: string,
    envOverrides?: Record<string, string>,
    agentId?: string,
): { promise: Promise<string>; signalDone: () => void } {
    let signalDoneCallback: (() => void) | null = null;

    const promise = new Promise<string>((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
        delete env.CLAUDECODE;

        const resolved = resolveExecutable(command);
        const child = spawn(resolved.cmd, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            shell: resolved.shell,
        });

        // Track active process for manual session management
        if (agentId) {
            activeProcesses.set(agentId, child);
            child.on('close', () => {
                if (activeProcesses.get(agentId) === child) activeProcesses.delete(agentId);
            });
        }

        let stdout = '';
        let stderr = '';
        let lineBuffer = '';
        let settled = false;
        let graceTimer: ReturnType<typeof setTimeout> | null = null;

        function settle(code: number | null) {
            if (settled) return;
            settled = true;
            if (graceTimer) clearTimeout(graceTimer);
            if (lineBuffer.trim()) onLine(lineBuffer);
            if (code === 0 || code === null) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `Command exited with code ${code}`));
            }
        }

        // When the caller signals that all useful output has been received,
        // give the process a grace period to exit cleanly, then kill it.
        signalDoneCallback = () => {
            if (settled) return;
            graceTimer = setTimeout(() => {
                if (!settled) {
                    log('WARN', `Process '${command}' did not exit within grace period after result — killing`);
                    // Resolve successfully BEFORE killing — the kill triggers a
                    // `close` event with code 143 which would otherwise reject.
                    settle(0);
                    try { child.kill('SIGTERM'); } catch { /* already dead */ }
                }
            }, 30_000);
        };

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            lineBuffer += chunk;
            const lines = lineBuffer.split('\n');
            // Keep the last incomplete line in the buffer
            lineBuffer = lines.pop()!;
            for (const line of lines) {
                if (line.trim()) onLine(line);
            }
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            if (!settled) {
                settled = true;
                if (graceTimer) clearTimeout(graceTimer);
                reject(error);
            }
        });

        child.on('close', (code) => {
            settle(code);
        });
    });

    return {
        promise,
        signalDone: () => signalDoneCallback?.(),
    };
}

/**
 * Invoke a single agent with a message. Resolves the provider,
 * delegates to the matching adapter, and returns the raw response text.
 *
 * When `onEvent` is provided, streams intermediate text events as they arrive
 * from the CLI subprocess (verbose/streaming mode).
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    _shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    onEvent?: (text: string) => void,
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    let shouldReset = _shouldReset;
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
        shouldReset = true;
    }

    // Build system prompt in-memory (built-in instructions + teammates + memory + user customization)
    const systemPrompt = buildSystemPrompt(agentId, agentDir, agents, teams, agent.system_prompt, agent.prompt_file);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const rawProvider = agent.provider || 'anthropic';

    // Resolve custom provider if using "custom:<id>" prefix
    let provider = rawProvider;
    let customProvider: CustomProvider | undefined;
    let envOverrides: Record<string, string> = {
        TINYAGI_AGENT_ID: agentId,
    };

    if (rawProvider.startsWith('custom:')) {
        const customId = rawProvider.slice('custom:'.length);
        const settings = getSettings();
        customProvider = settings.custom_providers?.[customId];
        if (!customProvider) {
            throw new Error(`Custom provider '${customId}' not found in settings.custom_providers`);
        }
        // Map harness back to built-in provider for adapter selection
        provider = customProvider.harness === 'codex' ? 'openai' : 'anthropic';

        // Build env overrides based on harness
        if (customProvider.harness === 'claude') {
            envOverrides.ANTHROPIC_BASE_URL = customProvider.base_url;
            envOverrides.ANTHROPIC_AUTH_TOKEN = customProvider.api_key;
            envOverrides.ANTHROPIC_API_KEY = '';
        } else if (customProvider.harness === 'codex') {
            envOverrides.OPENAI_API_KEY = customProvider.api_key;
            envOverrides.OPENAI_BASE_URL = customProvider.base_url;
        }

        log('INFO', `Using custom provider '${customId}' (harness: ${customProvider.harness}, base_url: ${customProvider.base_url})`);
    } else {
        // For built-in providers, check if credentials are configured in settings
        const settings = getSettings();
        if (provider === 'anthropic' && settings.models?.anthropic?.oauth_token) {
            envOverrides.CLAUDE_CODE_OAUTH_TOKEN = settings.models.anthropic.oauth_token;
            envOverrides.ANTHROPIC_AUTH_TOKEN = '';
            envOverrides.ANTHROPIC_API_KEY = '';
        } else if (provider === 'anthropic' && settings.models?.anthropic?.api_key) {
            envOverrides.ANTHROPIC_API_KEY = settings.models.anthropic.api_key;
        } else if (provider === 'openai' && settings.models?.openai?.api_key) {
            envOverrides.OPENAI_API_KEY = settings.models.openai.api_key;
        }
    }

    // Resolve model — custom providers use their own model, otherwise resolve via aliases
    const effectiveModel = agent.model || customProvider?.model || '';
    const model = customProvider
        ? effectiveModel
        : resolveModel(effectiveModel, provider as 'anthropic' | 'openai' | 'opencode');

    // Look up the adapter
    const adapter = getAdapter(provider);
    if (!adapter) {
        throw new Error(`No adapter registered for provider '${provider}'`);
    }

    return adapter.invoke({
        agentId,
        message,
        workingDir,
        systemPrompt,
        model,
        shouldReset,
        envOverrides,
        onEvent,
    });
}
