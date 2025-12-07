/**
 * Lifecycle Service
 *
 * Handles operational lifecycle tasks for Ernesto:
 * - restart: clear state and re-initialize
 * - wipe and rebuild: clear Typesense index and rebuild from sources
 * - refresh source: manually refresh a single source
 *
 * Separated from core Ernesto to keep the lib minimal.
 */

import debug from 'debug';
import { clearAllResources, deleteSourceDocuments, getSourceFreshness } from './typesense/client';
import { generateSourceId } from './knowledge/ContentPipeline';
import { DEFAULT_CACHE_TTL_MS } from './knowledge/pipeline-types';
import type { Ernesto } from './Ernesto';

const log = debug('ernesto:lifecycle');

export interface SourceInfo {
    sourceId: string;
    domain: string;
    sourceName: string;
    isLocal: boolean;
    cacheTtlMs: number;
}

export class LifecycleService {
    private ernesto: Ernesto;

    constructor(ernesto: Ernesto) {
        this.ernesto = ernesto;
    }

    /**
     * Restart Ernesto
     *
     * Clears in-memory state and re-initializes.
     * Fresh sources load from Typesense (fast), stale sources refetch.
     */
    async restart(): Promise<{
        success: boolean;
        routeCount: number;
        duration: number;
    }> {
        const startTime = Date.now();
        log('Restarting...');

        try {
            // Clear in-memory state
            this.ernesto.clearState();

            // Re-register static routes
            for (const domain of this.ernesto.domainRegistry.getAll()) {
                this.ernesto.routeRegistry.registerAll(domain.routes);
            }

            // Re-initialize (same flow as cold start)
            await this.ernesto.initialize();

            const duration = Date.now() - startTime;
            return {
                success: true,
                routeCount: this.ernesto.routeRegistry.getAll().length,
                duration,
            };
        } catch (error) {
            log('Restart failed', { error });
            return {
                success: false,
                routeCount: this.ernesto.routeRegistry.getAll().length,
                duration: Date.now() - startTime,
            };
        }
    }

    /**
     * Wipe index and rebuild everything
     *
     * Clears Typesense index, then initializes.
     * All sources will be stale, so everything gets fetched fresh.
     */
    async wipeIndexAndRebuild(): Promise<{
        success: boolean;
        routeCount: number;
        duration: number;
    }> {
        const startTime = Date.now();
        log('Wiping index and rebuilding...');

        try {
            // Clear Typesense index
            await clearAllResources(this.ernesto as any);

            // Clear in-memory state
            this.ernesto.clearState();

            // Re-register static routes
            for (const domain of this.ernesto.domainRegistry.getAll()) {
                this.ernesto.routeRegistry.registerAll(domain.routes);
            }

            // Initialize (everything is stale, so everything fetches)
            await this.ernesto.initialize();

            const duration = Date.now() - startTime;
            log('Wipe and rebuild complete', {
                duration,
                routeCount: this.ernesto.routeRegistry.getAll().length,
            });

            return {
                success: true,
                routeCount: this.ernesto.routeRegistry.getAll().length,
                duration,
            };
        } catch (error) {
            log('Wipe and rebuild failed', { error });
            return {
                success: false,
                routeCount: this.ernesto.routeRegistry.getAll().length,
                duration: Date.now() - startTime,
            };
        }
    }

    /**
     * Rebuild from index (diagnostic tool)
     *
     * In the unified flow, this is essentially what initialize() does
     * for fresh sources - just a restart.
     */
    async rebuildFromIndex(): Promise<{
        success: boolean;
        routesRebuilt: number;
        byDomain: Record<string, number>;
        error?: string;
    }> {
        try {
            // This is essentially a restart - fresh sources load from index
            await this.restart();

            // Collect stats
            const byDomain: Record<string, number> = {};
            for (const route of this.ernesto.routeRegistry.getAll()) {
                const domain = route.route.split('://')[0];
                byDomain[domain] = (byDomain[domain] || 0) + 1;
            }

            return {
                success: true,
                routesRebuilt: this.ernesto.routeRegistry.getAll().length,
                byDomain,
            };
        } catch (error: any) {
            return {
                success: false,
                routesRebuilt: 0,
                byDomain: {},
                error: error.message,
            };
        }
    }

    /**
     * Manually refresh a specific source
     */
    async refreshSource(sourceId: string): Promise<{
        success: boolean;
        resourceCount: number;
        message: string;
    }> {
        // Find the source
        const sourceInfo = this.findSource(sourceId);
        if (!sourceInfo) {
            return {
                success: false,
                resourceCount: 0,
                message: `Source not found: ${sourceId}`,
            };
        }

        const { domainName, extractor } = sourceInfo;

        try {
            // Delete old documents
            await deleteSourceDocuments(this.ernesto as any, sourceId);

            // Fetch fresh using Ernesto's internal method
            const result = await this.ernesto.refetchSource(domainName, extractor);

            return {
                success: true,
                resourceCount: result.resourceCount,
                message: `Refreshed ${result.resourceCount} resources`,
            };
        } catch (error: any) {
            log('Manual refresh failed', { sourceId, error });
            return {
                success: false,
                resourceCount: 0,
                message: error.message || 'Unknown error',
            };
        }
    }

    /**
     * Refresh all stale third-party sources
     *
     * Checks each non-local source for freshness and refreshes if stale.
     * Used by background workers/cron jobs.
     */
    async refreshStaleSources(): Promise<{
        checked: number;
        refreshed: number;
        failed: number;
    }> {
        const stats = { checked: 0, refreshed: 0, failed: 0 };

        for (const source of this.getAllSources()) {
            // Skip local sources (always fresh, re-fetched on restart)
            if (source.isLocal) continue;

            stats.checked++;

            try {
                const freshness = await getSourceFreshness(this.ernesto as any, source.sourceId);
                const isStale = !freshness || freshness.ageMs >= source.cacheTtlMs;

                if (isStale) {
                    log('Refreshing stale source', {
                        sourceId: source.sourceId,
                        domain: source.domain,
                        ageMinutes: freshness ? Math.round(freshness.ageMs / 60000) : null,
                        ttlMinutes: Math.round(source.cacheTtlMs / 60000),
                    });

                    await this.refreshSource(source.sourceId);
                    stats.refreshed++;
                }
            } catch (error) {
                log('Failed to refresh source', {
                    sourceId: source.sourceId,
                    domain: source.domain,
                    error,
                });
                stats.failed++;
            }
        }

        return stats;
    }

    /**
     * Get all sources (for health checks and auto-refresh)
     */
    getAllSources(): SourceInfo[] {
        const result: SourceInfo[] = [];

        for (const domain of this.ernesto.domainRegistry.getAll()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                const sourceId = generateSourceId(extractor.source.name, extractor.basePath || '');
                const isLocal = extractor.source.name.startsWith('local:');

                result.push({
                    sourceId,
                    domain: domain.name,
                    sourceName: extractor.source.name,
                    isLocal,
                    cacheTtlMs: extractor.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
                });
            }
        }

        return result;
    }

    /**
     * Find a source by ID
     */
    private findSource(sourceId: string): {
        domainName: string;
        extractor: any;
    } | null {
        for (const domain of this.ernesto.domainRegistry.getAll()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                const id = generateSourceId(extractor.source.name, extractor.basePath || '');
                if (id === sourceId) {
                    return { domainName: domain.name, extractor };
                }
            }
        }

        return null;
    }
}
