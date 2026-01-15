/**
 * Lifecycle Service
 * Handles operational lifecycle tasks
 */

import debug from 'debug';
import { clearAllResources, deleteSourceDocuments, getSourceFreshness } from './typesense/client';
import { ContentPipeline } from './pipelines';
import type { Ernesto } from './Ernesto';

const log = debug('LifecycleService');

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
            // Clear in-memory state and re-initialize
            this.ernesto.routeRegistry.clear();
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
            // Clear Typesense index and in-memory state
            await clearAllResources(this.ernesto as any);
            this.ernesto.routeRegistry.clear();

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
        const sourceInfo = this.ernesto.domainRegistry.findSource(sourceId);
        if (!sourceInfo) {
            return {
                success: false,
                resourceCount: 0,
                message: `Source not found: ${sourceId}`,
            };
        }

        const { domainName, extractor } = sourceInfo;

        try {
            const pipeline = new ContentPipeline({
                source: extractor.source,
                formats: extractor.formats,
                basePath: extractor.basePath,
            });

            const resources = await pipeline.fetchResources();
            if (resources.length === 0) {
                return { success: true, resourceCount: 0, message: 'No resources found' };
            }

            await deleteSourceDocuments(this.ernesto as any, sourceId);
            await this.ernesto.indexResources(sourceId, domainName, extractor, resources);

            return {
                success: true,
                resourceCount: resources.length,
                message: `Refreshed ${resources.length} resources`,
            };
        } catch (error: any) {
            log('Refresh failed', { sourceId, error });
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

        for (const source of this.ernesto.domainRegistry.getAllSources()) {
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
}
