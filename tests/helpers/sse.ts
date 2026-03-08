import { waitFor } from './wait';

export interface SseEvent {
    event: string;
    data: unknown;
}

export interface SseConnection {
    events: SseEvent[];
    waitForOrderedEvents(expectedEvents: string[], timeoutMs?: number): Promise<SseEvent[]>;
    close(): Promise<void>;
}

function parseFrame(frame: string): SseEvent | null {
    const lines = frame.split('\n');
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith('event:')) {
            event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trim());
        }
    }

    if (dataLines.length === 0) {
        return null;
    }

    const rawData = dataLines.join('\n');
    try {
        return {
            event,
            data: JSON.parse(rawData),
        };
    } catch {
        return {
            event,
            data: rawData,
        };
    }
}

export async function connectSse(baseUrl: string): Promise<SseConnection> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events/stream`, {
        signal: controller.signal,
    });

    if (!response.ok || !response.body) {
        throw new Error(`Could not connect to SSE stream: ${response.status}`);
    }

    const events: SseEvent[] = [];
    const reader = response.body.getReader();
    let buffer = '';
    let streamError: Error | null = null;

    const streamPromise = (async () => {
        while (true) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                buffer += Buffer.from(value).toString('utf8');
                const frames = buffer.split('\n\n');
                buffer = frames.pop() || '';

                for (const frame of frames) {
                    const parsed = parseFrame(frame.trim());
                    if (parsed) {
                        events.push(parsed);
                    }
                }
            } catch (error) {
                streamError = error as Error;
                throw error;
            }
        }
    })();

    return {
        events,
        async waitForOrderedEvents(expectedEvents: string[], timeoutMs = 10_000) {
            return await waitFor(() => {
                if (streamError) {
                    throw streamError;
                }
                let nextIndex = 0;
                for (const event of events) {
                    if (event.event === expectedEvents[nextIndex]) {
                        nextIndex += 1;
                    }
                    if (nextIndex === expectedEvents.length) {
                        return events.slice();
                    }
                }
                return undefined;
            }, timeoutMs);
        },
        async close() {
            controller.abort();
            try {
                await streamPromise;
            } catch (error) {
                const streamException = streamError || (error as Error);
                if (streamException.name !== 'AbortError') {
                    throw streamException;
                }
            }
        },
    };
}
