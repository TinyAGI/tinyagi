import assert from 'assert/strict';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { openQueueDb, getMessageByMessageId } from '../helpers/db';
import { startProcessor } from '../helpers/processor';
import { postMessage, waitForResponse } from '../helpers/http';

test('core message flow persists a fake provider response', async () => {
    const fixture = await createTestFixture();
    let processor;
    const db = openQueueDb(fixture.tinyclawHome);

    try {
        processor = await startProcessor(fixture);
        const messageId = await postMessage(fixture.baseUrl, 'hello test');
        const response = await waitForResponse(fixture.baseUrl, messageId);
        const messageRow = getMessageByMessageId(db, messageId);

        assert.equal(response.agent, 'default');
        assert.match(response.message, /FAKE_RESPONSE:hello test/);
        assert.equal(messageRow?.status, 'completed');
    } finally {
        db.close();
        await processor?.stop();
        await fixture.cleanup();
    }
});
