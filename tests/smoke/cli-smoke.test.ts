import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { postMessage, waitForResponse } from '../helpers/http';
import { REPO_ROOT } from '../helpers/paths';
import { startProcessor } from '../helpers/processor';

const execFile = promisify(execFileCb);

test('install script and CLI wrapper support a minimal fake-provider runtime smoke', async () => {
    const fixture = await createTestFixture({
        agents: {
            default: { name: 'Default' },
            coder: { name: 'Coder' },
        },
    });
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tinyclaw-install-'));
    const env = {
        ...process.env,
        HOME: fixture.homeDir,
        PATH: `${installDir}:${process.env.PATH || ''}`,
        SHELL: process.env.SHELL || '/bin/bash',
        TINYCLAW_INSTALL_DIR: installDir,
    };
    let processor;

    try {
        await execFile('bash', ['scripts/install.sh'], {
            cwd: REPO_ROOT,
            env,
        });

        const help = await execFile(path.join(installDir, 'tinyclaw'), ['--help'], {
            cwd: REPO_ROOT,
            env,
        });
        assert.match(help.stdout, /Usage:/);

        const agentList = await execFile(path.join(installDir, 'tinyclaw'), ['agent', 'list'], {
            cwd: REPO_ROOT,
            env,
        });
        assert.match(agentList.stdout, /@default/);

        processor = await startProcessor(fixture);
        const messageId = await postMessage(fixture.baseUrl, 'smoke check');
        const response = await waitForResponse(fixture.baseUrl, messageId);

        assert.match(response.message, /FAKE_RESPONSE:smoke check/);
    } finally {
        await processor?.stop();
        await fixture.cleanup();
        await fs.rm(installDir, { recursive: true, force: true });
    }
});
