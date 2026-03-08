import assert from 'assert/strict';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { postMessage, waitForResponse } from '../helpers/http';
import { startProcessor } from '../helpers/processor';
import { connectSse } from '../helpers/sse';

test('sse stream emits the core runtime events in order', async () => {
    const fixture = await createTestFixture();
    let processor;
    let sse;

    try {
        processor = await startProcessor(fixture);
        sse = await connectSse(fixture.baseUrl);

        const messageId = await postMessage(fixture.baseUrl, 'watch sse');
        await waitForResponse(fixture.baseUrl, messageId);

        const events = await sse.waitForOrderedEvents([
            'message_enqueued',
            'message_received',
            'agent_routed',
            'response_ready',
        ]);

        assert.ok(events.length >= 4);
    } finally {
        await sse?.close();
        await processor?.stop();
        await fixture.cleanup();
    }
});
