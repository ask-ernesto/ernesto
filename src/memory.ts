/**
 * Memory - OpenClaw MEMORY.md + daily logs equivalent
 *
 * Interface for persistent memory across conversations.
 * Two scopes: org memory (shared) + personal memory (per-user).
 *
 * Implementation is in the backend (MongoDB + Typesense),
 * this file defines the interface contract.
 */

/**
 * Memory entry metadata
 */
export interface MemoryMeta {
    /** Who created this entry */
    source?: string;
    /** When it was created */
    createdAt?: Date;
    /** When it was last updated */
    updatedAt?: Date;
    /** Optional tags for categorization */
    tags?: string[];
}

/**
 * A stored memory entry
 */
export interface MemoryEntry {
    key: string;
    value: string;
    meta?: MemoryMeta;
}

/**
 * Filter for listing memory entries
 */
export interface MemoryFilter {
    /** Filter by key prefix */
    prefix?: string;
    /** Filter by tag */
    tag?: string;
    /** Filter by source */
    source?: string;
    /** Maximum entries to return */
    limit?: number;
}

/**
 * Memory store interface — matches OpenClaw's memory system
 *
 * Implementations:
 * - MongoMemoryStore (backend, for production)
 * - InMemoryStore (testing)
 */
export interface MemoryStore {
    // ─── Daily Memory (like memory/YYYY-MM-DD.md) ───────────────────────
    appendDaily(content: string, source?: string): Promise<void>;
    getDailyLog(date?: Date): Promise<string | null>;

    // ─── Long-term Memory (like MEMORY.md) ──────────────────────────────
    get(key: string): Promise<string | null>;
    set(key: string, value: string, meta?: MemoryMeta): Promise<void>;
    delete(key: string): Promise<void>;

    // ─── Search (vector + keyword via Typesense) ────────────────────────
    search(query: string, limit?: number): Promise<MemoryEntry[]>;

    // ─── Dashboard ──────────────────────────────────────────────────────
    list(filter?: MemoryFilter): Promise<MemoryEntry[]>;

    // ─── Pre-compaction flush (OpenClaw pattern) ────────────────────────
    flush(): Promise<void>;
}
