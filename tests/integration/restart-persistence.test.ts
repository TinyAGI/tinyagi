import assert from 'assert/strict';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { getResponses, postMessage, waitForResponse } from '../helpers/http';
import { startProcessor } from '../helpers/processor';

test('responses remain available after restarting the queue processor', async () => {
    const fixture = await createTestFixture();
    let processor;

    try {
        processor = await startProcessor(fixture);
        const messageId = await postMessage(fixture.baseUrl, 'persist across restart');
        await waitForResponse(fixture.baseUrl, messageId);

        await processor.stop();
        processor = await startProcessor(fixture);

        const responses = await getResponses(fixture.baseUrl);
        assert.ok(responses.some(response => response.messageId === messageId));
    } finally {
        await processor?.stop();
        await fixture.cleanup();
    }
});
