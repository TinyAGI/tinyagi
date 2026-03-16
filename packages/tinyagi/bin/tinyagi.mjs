#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeDefaults, TINYCLAW_HOME } from '../lib/defaults.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

const INSTALL_DIR = TINYCLAW_HOME;
const GITHUB_REPO = 'TinyAGI/tinyclaw';
const PORTAL_URL = 'https://office.tinyagicompany.com';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

function log(color, msg) {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

function commandExists(cmd) {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function exec(cmd, opts = {}) {
    return execSync(cmd, { stdio: 'inherit', ...opts });
}

// ── Prerequisites ────────────────────────────────────────────────────────────

function checkPrerequisites() {
    const missing = [];
    if (!commandExists('node')) missing.push('node (https://nodejs.org/)');
    if (!commandExists('npm')) missing.push('npm (https://nodejs.org/)');
    if (!commandExists('tmux')) missing.push('tmux (brew install tmux / apt install tmux)');
    if (!commandExists('jq')) missing.push('jq (brew install jq / apt install jq)');

    if (missing.length > 0) {
        log(RED, 'Missing prerequisites:');
        for (const dep of missing) {
            console.log(`  - ${dep}`);
        }
        process.exit(1);
    }
}

// ── Installation ─────────────────────────────────────────────────────────────

function isInstalled() {
    return fs.existsSync(path.join(INSTALL_DIR, 'tinyclaw.sh'));
}

async function install() {
    log(BLUE, 'Installing TinyClaw...');
    console.log(`  Directory: ${INSTALL_DIR}`);
    console.log('');

    // Try pre-built bundle first
    let usedBundle = false;
    try {
        const releaseJson = execSync(
            `curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest"`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        const match = releaseJson.match(/"tag_name"\s*:\s*"([^"]+)"/);
        if (match) {
            const tag = match[1];
            const bundleUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/tinyclaw-bundle.tar.gz`;

            // Check if bundle exists
            try {
                execSync(`curl -fsSL -I "${bundleUrl}"`, { stdio: 'ignore' });
                log(GREEN, `✓ Pre-built bundle available (${tag})`);

                fs.mkdirSync(INSTALL_DIR, { recursive: true });
                exec(`curl -fsSL "${bundleUrl}" | tar -xz -C "${INSTALL_DIR}" --strip-components=1`);

                // Rebuild native modules
                exec(`cd "${INSTALL_DIR}" && npm rebuild better-sqlite3 --silent 2>/dev/null || true`);
                usedBundle = true;
            } catch {
                // Bundle not available
            }
        }
    } catch {
        // No releases found
    }

    if (!usedBundle) {
        if (!commandExists('git')) {
            log(RED, 'git is required for source installation');
            process.exit(1);
        }

        log(YELLOW, 'No pre-built bundle — installing from source...');
        exec(`git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "${INSTALL_DIR}"`);

        log(BLUE, 'Installing dependencies...');
        exec(`cd "${INSTALL_DIR}" && PUPPETEER_SKIP_DOWNLOAD=true npm install --silent`);

        log(BLUE, 'Building...');
        exec(`cd "${INSTALL_DIR}" && npm run build --silent`);

        log(BLUE, 'Pruning dev dependencies...');
        exec(`cd "${INSTALL_DIR}" && npm prune --omit=dev --silent`);
    }

    // Make scripts executable and install CLI symlink
    exec(`chmod +x "${INSTALL_DIR}/bin/tinyclaw" "${INSTALL_DIR}/tinyclaw.sh" "${INSTALL_DIR}/scripts/install.sh" "${INSTALL_DIR}/lib/heartbeat-cron.sh"`);
    exec(`"${INSTALL_DIR}/scripts/install.sh" || true`);

    log(GREEN, '✓ TinyClaw installed');
    console.log('');
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function run() {
    console.log('');
    log(BLUE, '╔════════════════════════════════════════╗');
    log(BLUE, '║          TinyAGI Quick Start           ║');
    log(BLUE, '╚════════════════════════════════════════╝');
    console.log('');

    // 1. Prerequisites
    checkPrerequisites();

    // 2. Install if needed
    if (!isInstalled()) {
        await install();
    } else {
        log(GREEN, '✓ TinyClaw already installed');
        console.log('');
    }

    // 3. Write default settings if needed
    const wrote = writeDefaults();
    if (wrote) {
        log(GREEN, '✓ Default settings written');
        console.log(`  Workspace: ~/tinyagi-workspace`);
        console.log(`  Agent: TinyAGI Agent (anthropic/opus)`);
        console.log('');
    }

    // 4. Start with --skip-setup
    const tinyclawSh = path.join(INSTALL_DIR, 'tinyclaw.sh');
    log(BLUE, 'Starting TinyClaw...');
    try {
        exec(`"${tinyclawSh}" start --skip-setup`);
    } catch {
        // May already be running
        log(YELLOW, 'TinyClaw may already be running (use tinyclaw status to check)');
    }

    // 5. Open web portal
    console.log('');
    log(GREEN, '✓ Opening TinyOffice setup portal...');
    console.log(`  ${BLUE}${PORTAL_URL}${NC}`);
    console.log('');

    try {
        const open = (await import('open')).default;
        await open(PORTAL_URL);
    } catch {
        log(YELLOW, `Could not open browser. Visit ${PORTAL_URL} manually.`);
    }

    // 6. Instructions
    console.log('');
    log(GREEN, 'Next steps:');
    console.log('  1. Complete setup in the web portal');
    console.log('  2. Once configured, restart to enable channels:');
    console.log(`     ${BLUE}tinyclaw restart${NC}`);
    console.log('');
    console.log('Useful commands:');
    console.log(`  ${BLUE}tinyclaw status${NC}    Check status`);
    console.log(`  ${BLUE}tinyclaw stop${NC}      Stop all processes`);
    console.log(`  ${BLUE}tinyclaw restart${NC}   Restart with new settings`);
    console.log(`  ${BLUE}tinyclaw office${NC}    Start local web portal`);
    console.log('');
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2] || 'run';

switch (command) {
    case 'run':
    case 'start':
        run();
        break;
    case 'install':
        checkPrerequisites();
        if (isInstalled()) {
            log(GREEN, '✓ TinyClaw already installed');
        } else {
            install();
        }
        break;
    case '--help':
    case '-h':
    case 'help':
        console.log('');
        console.log('Usage: npx tinyagi [command]');
        console.log('');
        console.log('Commands:');
        console.log('  run        Install, configure defaults, start, and open portal (default)');
        console.log('  install    Install TinyClaw only');
        console.log('  help       Show this help');
        console.log('');
        console.log('After first run, use the tinyclaw CLI directly:');
        console.log('  tinyclaw start | stop | restart | status | setup | ...');
        console.log('');
        break;
    default:
        // Pass through to tinyclaw CLI if installed
        if (isInstalled()) {
            const tinyclawSh = path.join(INSTALL_DIR, 'tinyclaw.sh');
            const child = spawn(tinyclawSh, process.argv.slice(2), { stdio: 'inherit' });
            child.on('exit', (code) => process.exit(code || 0));
        } else {
            log(RED, `Unknown command: ${command}`);
            log(YELLOW, 'Run "npx tinyagi" first to install TinyClaw');
            process.exit(1);
        }
        break;
}
