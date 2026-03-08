import path from 'path';
import Database from 'better-sqlite3';

export interface DbMessageRow {
    id: number;
    message_id: string;
    status: 'pending' | 'processing' | 'completed' | 'dead';
    retry_count: number;
    last_error: string | null;
}

export interface DbResponseRow {
    id: number;
    message_id: string;
    status: 'pending' | 'acked';
    message: string;
    agent: string | null;
}

export function openQueueDb(tinyclawHome: string): Database.Database {
    return new Database(path.join(tinyclawHome, 'tinyclaw.db'));
}

export function getMessageByMessageId(db: Database.Database, messageId: string): DbMessageRow | undefined {
    return db.prepare(`
        SELECT id, message_id, status, retry_count, last_error
        FROM messages
        WHERE message_id = ?
    `).get(messageId) as DbMessageRow | undefined;
}

export function getResponsesByMessageId(db: Database.Database, messageId: string): DbResponseRow[] {
    return db.prepare(`
        SELECT id, message_id, status, message, agent
        FROM responses
        WHERE message_id = ?
        ORDER BY id ASC
    `).all(messageId) as DbResponseRow[];
}
