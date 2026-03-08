import assert from 'assert/strict';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { startProcessor } from '../helpers/processor';
import { postMessage, waitForResponse } from '../helpers/http';

test('agent routing uses the mentioned agent and stripped message body', async () => {
    const fixture = await createTestFixture({
        agents: {
            default: { name: 'Default' },
            coder: { name: 'Coder' },
        },
    });
    let processor;

    try {
        processor = await startProcessor(fixture);
        const messageId = await postMessage(fixture.baseUrl, '@coder write hello world');
        const response = await waitForResponse(fixture.baseUrl, messageId);

        assert.equal(response.agent, 'coder');
        assert.match(response.message, /FAKE_RESPONSE:write hello world/);
        assert.doesNotMatch(response.message, /FAKE_RESPONSE:@coder/);
    } finally {
        await processor?.stop();
        await fixture.cleanup();
    }
});
