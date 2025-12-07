/**
 * Global Knowledge Cache
 *
 * Tracks which sources are loaded and their stats for health checks.
 * Content is stored in Typesense, not in memory.
 */

import debug from 'debug';

const log = debug('ernesto:global-knowledge-cache');

/**
 * Cache entry for a single source
 */
interface SourceEntry {
    readonly domain: string;
    readonly resourceCount: number;
    readonly timestamp: number;
    readonly ttlMs: number;
}

/**
 * Cache statistics for monitoring
 */
export interface SourceStats {
    readonly resourceCount: number;
    readonly ageMs: number;
    readonly ttlMs: number;
    readonly expiresIn: number;
}

/**
 * Global Knowledge Cache
 *
 * Tracks loaded sources for health checks.
 * Content is stored in Typesense, not duplicated here.
 */
export class GlobalKnowledgeCache {
    private readonly cache = new Map<string, SourceEntry>();
    private readonly defaultTtlMs = 60 * 60 * 1000; // 1 hour

    /**
     * Mark a source as loaded
     */
    setSource(sourceId: string, domain: string, resourceCount: number, ttlMs: number = this.defaultTtlMs): void {
        this.cache.set(sourceId, {
            domain,
            resourceCount,
            timestamp: Date.now(),
            ttlMs,
        });

        log('Source loaded', {
            sourceId,
            domain,
            resourceCount,
            ttlMs,
        });
    }

    /**
     * Get stats for a domain (sum of all sources)
     */
    getDomainStats(domainName: string): { resourceCount: number } | null {
        let totalResources = 0;
        let hasSource = false;

        for (const [sourceId, entry] of this.cache.entries()) {
            if (entry.domain !== domainName) continue;

            // Check expiry
            const ageMs = Date.now() - entry.timestamp;
            if (ageMs > entry.ttlMs) {
                this.cache.delete(sourceId);
                continue;
            }

            totalResources += entry.resourceCount;
            hasSource = true;
        }

        return hasSource ? { resourceCount: totalResources } : null;
    }

    /**
     * Clear all sources
     */
    clearAll(): number {
        const count = this.cache.size;
        this.cache.clear();
        if (count > 0) {
            log('Cleared all', { count });
        }
        return count;
    }

    /**
     * Get stats for all sources
     */
    getStats(): Map<string, SourceStats> {
        const stats = new Map<string, SourceStats>();

        for (const [sourceId, entry] of this.cache.entries()) {
            const ageMs = Date.now() - entry.timestamp;
            const expiresIn = entry.ttlMs - ageMs;

            stats.set(sourceId, {
                resourceCount: entry.resourceCount,
                ageMs,
                ttlMs: entry.ttlMs,
                expiresIn: Math.max(0, expiresIn),
            });
        }

        return stats;
    }

    /**
     * Check if domain has any loaded sources
     */
    has(domainName: string): boolean {
        return this.getDomainStats(domainName) !== null;
    }

    get size(): number {
        return this.cache.size;
    }
}
