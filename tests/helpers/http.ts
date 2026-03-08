import { waitFor } from './wait';

export interface QueueStatus {
    incoming: number;
    processing: number;
    outgoing: number;
    dead: number;
    activeConversations: number;
}

export interface ApiResponse {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string;
    files?: string[];
}

export interface DeadMessage {
    id: number;
    message_id: string;
    channel: string;
    sender: string;
    message: string;
    agent: string | null;
    status: 'pending' | 'processing' | 'completed' | 'dead';
    retry_count: number;
    last_error: string | null;
}

async function parseJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body}`);
    }
    return await response.json() as T;
}

export async function postMessage(
    baseUrl: string,
    message: string,
    extra: Record<string, unknown> = {}
): Promise<string> {
    const response = await fetch(`${baseUrl}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            ...extra,
        }),
    });
    const payload = await parseJson<{ ok: true; messageId: string }>(response);
    return payload.messageId;
}

export async function getResponses(baseUrl: string): Promise<ApiResponse[]> {
    const response = await fetch(`${baseUrl}/api/responses`);
    return await parseJson<ApiResponse[]>(response);
}

export async function getQueueStatus(baseUrl: string): Promise<QueueStatus> {
    const response = await fetch(`${baseUrl}/api/queue/status`);
    return await parseJson<QueueStatus>(response);
}

export async function getDeadMessages(baseUrl: string): Promise<DeadMessage[]> {
    const response = await fetch(`${baseUrl}/api/queue/dead`);
    return await parseJson<DeadMessage[]>(response);
}

export async function retryDeadMessage(baseUrl: string, id: number): Promise<void> {
    const response = await fetch(`${baseUrl}/api/queue/dead/${id}/retry`, {
        method: 'POST',
    });
    await parseJson<{ ok: true }>(response);
}

export async function waitForResponse(
    baseUrl: string,
    messageId: string,
    timeoutMs = 10_000
): Promise<ApiResponse> {
    return await waitFor(async () => {
        const responses = await getResponses(baseUrl);
        return responses.find(response => response.messageId === messageId);
    }, timeoutMs);
}
