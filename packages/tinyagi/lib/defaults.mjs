import fs from 'fs';
import path from 'path';
import os from 'os';

const TINYCLAW_HOME = process.env.TINYCLAW_HOME || path.join(os.homedir(), '.tinyclaw');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');

function expandHome(p) {
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return p;
}

const DEFAULT_SETTINGS = {
    workspace: {
        path: path.join(os.homedir(), 'tinyagi-workspace'),
        name: 'tinyagi-workspace',
    },
    channels: {
        enabled: [],
    },
    agents: {
        default: {
            name: 'TinyAGI Agent',
            provider: 'anthropic',
            model: 'opus',
            working_directory: path.join(os.homedir(), 'tinyagi-workspace', 'default'),
        },
    },
    models: {
        provider: 'anthropic',
    },
    monitoring: {
        heartbeat_interval: 3600,
    },
};

/**
 * Write default settings.json and create workspace directories.
 * Returns true if defaults were written, false if settings already exist.
 */
export function writeDefaults() {
    if (fs.existsSync(SETTINGS_FILE)) {
        return false;
    }

    // Ensure TINYCLAW_HOME exists
    fs.mkdirSync(TINYCLAW_HOME, { recursive: true });

    // Write settings
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n');

    // Create workspace and agent directories
    const wsPath = DEFAULT_SETTINGS.workspace.path;
    fs.mkdirSync(wsPath, { recursive: true });

    for (const agent of Object.values(DEFAULT_SETTINGS.agents)) {
        fs.mkdirSync(agent.working_directory, { recursive: true });
    }

    return true;
}

export { TINYCLAW_HOME, SETTINGS_FILE, DEFAULT_SETTINGS };
