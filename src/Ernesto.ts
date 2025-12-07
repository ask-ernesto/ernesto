import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DomainRegistry } from './domain-registry';
import { RouteRegistry } from './router';
import { Route, RouteContext } from './types';
import { Domain } from './domain';
import { createSearchTool } from './tools/search';
import { createGetTool } from './tools/get';
import { GlobalKnowledgeCache } from './knowledge/GlobalKnowledgeCache';
import debug from 'debug';
import { ContentPipeline, generateSourceId } from './knowledge/ContentPipeline';
import { ResourceNode } from './knowledge/types';
import { buildContent } from './knowledge/resource-helpers';
import { clearAllResources, deleteSourceDocuments, exportSourceDocuments, getSourceFreshness, indexMcpResources } from './typesense/client';
import { McpResourceDocument } from './typesense/schema';
import { DEFAULT_CACHE_TTL_MS, PipelineConfig } from './knowledge/pipeline-types';
import { Client as TypesenseClient } from 'typesense';
import { LifecycleService } from './LifecycleService';

const log = debug('ernesto:ernesto');

interface ErnestoOptions {
    domains: Domain[];
    routes: Route[];
    typesense: TypesenseClient;
}

/**
 * Ernesto - The unified knowledge system
 *
 * ARCHITECTURE:
 * - Sources: Where data comes from (local files, GitHub, data warehouse, etc.)
 * - Cache: In-memory storage for fast route serving
 * - Index: Typesense for semantic search and freshness tracking
 * - Routes: HTTP-like endpoints (domain://path) for accessing knowledge
 *
 * INITIALIZATION FLOW (same for cold start and restart):
 * 1. Register static routes (TypeScript-defined tools, instructions)
 * 2. For each source:
 *    - Check Typesense for freshness (indexed_at + TTL)
 *    - If FRESH: load from Typesense → cache (don't re-index)
 *    - If STALE: fetch from source → cache → index (new indexed_at)
 * 3. Register dynamic routes for cached knowledge
 * 4. Schedule background refreshes based on actual indexed_at
 */
export class Ernesto {
    readonly domainRegistry = new DomainRegistry();
    readonly routeRegistry = new RouteRegistry();
    readonly globalKnowledgeCache = new GlobalKnowledgeCache();
    readonly typesense: TypesenseClient;
    readonly lifecycle = new LifecycleService(this);

    constructor({ domains, routes, typesense }: ErnestoOptions) {
        this.domainRegistry.registerAll(domains);
        this.routeRegistry.registerAll(routes);
        this.typesense = typesense;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Attach Ernesto to an MCP server
     */
    public attachToMcpServer(server: McpServer, context: RouteContext) {
        context.ernesto = this;

        const searchTool = createSearchTool(context);
        const getTool = createGetTool(context);

        server.registerTool(
            searchTool.name,
            {
                description: searchTool.description,
                inputSchema: searchTool.inputSchema,
            },
            searchTool.handler,
        );

        server.registerTool(
            getTool.name,
            {
                description: getTool.description,
                inputSchema: getTool.inputSchema,
            },
            getTool.handler,
        );
    }

    /**
     * Clear in-memory state (for restart/rebuild operations)
     */
    public clearState(): void {
        this.globalKnowledgeCache.clearAll();
        this.routeRegistry.clear();
    }

    /**
     * Re-fetch a source and index it (exposed for LifecycleService)
     */
    public async refetchSource(domainName: string, extractor: any): Promise<{ resourceCount: number }> {
        return this.fetchAndIndexSource(domainName, extractor);
    }

    /**
     * Initialize Ernesto
     *
     * Same flow for cold start and restart:
     * - Fresh sources: load from Typesense (fast, preserves indexed_at)
     * - Stale sources: fetch from origin, update index (new indexed_at)
     */
    public async initialize(): Promise<void> {
        const startTime = Date.now();
        log('Initializing...');

        // Step 1: Register static routes (TypeScript-defined)
        this.registerStaticRoutes();

        // Step 2: Load instructions cache
        await this.initializeInstructionsCache();

        // Step 3: Initialize each source (fresh → from index, stale → fetch)
        const stats = { fromIndex: 0, fetched: 0, failed: 0 };

        for (const domain of this.domainRegistry.getAll()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                try {
                    const result = await this.initializeSource(domain.name, extractor);
                    if (result.fromIndex) {
                        stats.fromIndex++;
                    } else {
                        stats.fetched++;
                    }
                } catch (error) {
                    log('Failed to initialize source', {
                        domain: domain.name,
                        source: extractor.source.name,
                        error,
                    });
                    stats.failed++;
                }
            }
        }

        // Step 4: Index static routes (instructions, templates) to Typesense for search
        await this.indexStaticRoutes();

        // Note: Background refreshes should be handled externally (e.g., cron job or worker)

        const duration = Date.now() - startTime;
        log('Initialization complete', {
            duration,
            routes: this.routeRegistry.getAll().length,
            ...stats,
        });
    }

    /**
     * Restart Ernesto
     *
     * Clears in-memory state and re-initializes.
     * Fresh sources load from Typesense (fast), stale sources refetch.
     */
    public async restart(): Promise<{
        success: boolean;
        routeCount: number;
        duration: number;
    }> {
        const startTime = Date.now();
        log('Restarting...');

        try {
            // Clear in-memory state
            this.globalKnowledgeCache.clearAll();
            this.routeRegistry.clear();

            // Re-register static routes
            for (const domain of this.domainRegistry.getAll()) {
                this.routeRegistry.registerAll(domain.routes);
            }

            // Re-initialize (same flow as cold start)
            await this.initialize();

            const duration = Date.now() - startTime;
            return {
                success: true,
                routeCount: this.routeRegistry.getAll().length,
                duration,
            };
        } catch (error) {
            log('Restart failed', { error });
            return {
                success: false,
                routeCount: this.routeRegistry.getAll().length,
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
    public async wipeIndexAndRebuild(): Promise<{
        success: boolean;
        routeCount: number;
        duration: number;
    }> {
        const startTime = Date.now();
        log('Wiping index and rebuilding...');

        try {
            // Clear Typesense index
            await clearAllResources(this);

            // Clear in-memory state
            this.globalKnowledgeCache.clearAll();
            this.routeRegistry.clear();

            // Re-register static routes
            for (const domain of this.domainRegistry.getAll()) {
                this.routeRegistry.registerAll(domain.routes);
            }

            // Initialize (everything is stale, so everything fetches)
            await this.initialize();

            const duration = Date.now() - startTime;
            log('Wipe and rebuild complete', {
                duration,
                routeCount: this.routeRegistry.getAll().length,
            });

            return {
                success: true,
                routeCount: this.routeRegistry.getAll().length,
                duration,
            };
        } catch (error) {
            log('Wipe and rebuild failed', { error });
            return {
                success: false,
                routeCount: this.routeRegistry.getAll().length,
                duration: Date.now() - startTime,
            };
        }
    }

    /**
     * Manually refresh a specific source
     */
    public async refreshSource(sourceId: string): Promise<{
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

        const { domain, extractor } = sourceInfo;

        try {
            // Delete old documents
            await deleteSourceDocuments(this, sourceId);

            // Fetch fresh
            const result = await this.fetchAndIndexSource(domain, extractor);

            return {
                success: true,
                resourceCount: result.resourceCount,
                message: `Refreshed ${result.resourceCount} resources`,
            };
        } catch (error) {
            log('Manual refresh failed', { sourceId, error });
            return {
                success: false,
                resourceCount: 0,
                message: error.message || 'Unknown error',
            };
        }
    }

    /**
     * Rebuild from index (diagnostic tool)
     *
     * In the new unified flow, this is essentially what initialize() does
     * for fresh sources. This method is kept for backward compatibility
     * with the dev://rebuild-from-index handler.
     */
    public async rebuildFromIndex(): Promise<{
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
            for (const route of this.routeRegistry.getAll()) {
                const domain = route.route.split('://')[0];
                byDomain[domain] = (byDomain[domain] || 0) + 1;
            }

            return {
                success: true,
                routesRebuilt: this.routeRegistry.getAll().length,
                byDomain,
            };
        } catch (error) {
            return {
                success: false,
                routesRebuilt: 0,
                byDomain: {},
                error: error.message,
            };
        }
    }

    /**
     * Get all sources (for health checks)
     */
    public getAllSources(): {
        sourceId: string;
        domain: string;
        sourceName: string;
        isLocal: boolean;
        cacheTtlMs: number;
    }[] {
        const result: {
            sourceId: string;
            domain: string;
            sourceName: string;
            isLocal: boolean;
            cacheTtlMs: number;
        }[] = [];

        for (const domain of this.domainRegistry.getAll()) {
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

    // ============================================================
    // PRIVATE: SOURCE INITIALIZATION
    // ============================================================

    /**
     * Initialize a single source
     *
     * Core logic:
     * - Check if source is fresh in Typesense
     * - If fresh: load from index (fast, preserves indexed_at)
     * - If stale: fetch from origin, index (new indexed_at)
     */
    private async initializeSource(domainName: string, extractor: PipelineConfig): Promise<{ fromIndex: boolean; resourceCount: number }> {
        const pipeline = new ContentPipeline({
            source: extractor.source,
            formats: extractor.formats,
            basePath: extractor.basePath,
        });
        const sourceId = pipeline.sourceId;
        const ttlMs = extractor.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        const isLocal = extractor.source.name.startsWith('local:');

        // Local sources: always fetch (fast, may have new files)
        // Third-party sources: check freshness
        let isFresh = false;
        if (!isLocal) {
            const freshness = await getSourceFreshness(this, sourceId);
            isFresh = freshness !== null && freshness.ageMs < ttlMs;

            if (isFresh) {
                log('Source is fresh, loading from index', {
                    sourceId,
                    ageMinutes: Math.round(freshness!.ageMs / 60000),
                    ttlMinutes: Math.round(ttlMs / 60000),
                });
            }
        }

        if (isFresh) {
            // Load from Typesense (don't re-fetch, don't re-index)
            return this.loadSourceFromIndex(sourceId, domainName, ttlMs);
        } else {
            // Fetch from origin, index
            const result = await this.fetchAndIndexSource(domainName, extractor);
            return { fromIndex: false, resourceCount: result.resourceCount };
        }
    }

    /**
     * Load source from Typesense index into memory cache
     *
     * Used for fresh sources - avoids re-fetching and preserves indexed_at.
     */
    private async loadSourceFromIndex(
        sourceId: string,
        domainName: string,
        ttlMs: number,
    ): Promise<{ fromIndex: boolean; resourceCount: number }> {
        const docs = await exportSourceDocuments(this, sourceId);

        if (docs.length === 0) {
            log('No documents found for fresh source', { sourceId });
            return { fromIndex: true, resourceCount: 0 };
        }

        // Count resources (for stats only - content is in Typesense)
        const resourceCount = docs.filter((doc) => doc.type === 'resource' || doc.type === 'instruction').length;

        // Store in cache (for health checks - content served from Typesense)
        this.globalKnowledgeCache.setSource(sourceId, domainName, resourceCount, ttlMs);

        log('Loaded source from index', {
            sourceId,
            domainName,
            resourceCount,
        });

        return { fromIndex: true, resourceCount };
    }

    /**
     * Fetch source from origin and index to Typesense
     *
     * Used for stale/missing sources - fetches fresh data and updates index.
     */
    private async fetchAndIndexSource(domainName: string, extractor: PipelineConfig): Promise<{ resourceCount: number }> {
        const pipeline = new ContentPipeline({
            source: extractor.source,
            formats: extractor.formats,
            basePath: extractor.basePath,
        });
        const sourceId = pipeline.sourceId;
        const ttlMs = extractor.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

        // Fetch from origin
        const resources = await pipeline.fetchResources();

        if (resources.length === 0) {
            log('No resources from source', { sourceId });
            return { resourceCount: 0 };
        }

        // Build content
        const contentMap = new Map<string, string>();
        this.prebuildAllContent(resources, contentMap);

        // Store in cache (for health checks - content served from Typesense)
        this.globalKnowledgeCache.setSource(sourceId, domainName, resources.length, ttlMs);

        // Delete old documents and index new ones
        await deleteSourceDocuments(this, sourceId);
        await this.indexSource(sourceId, domainName, resources, contentMap);

        log('Fetched and indexed source', {
            sourceId,
            domainName,
            resourceCount: resources.length,
        });

        return { resourceCount: resources.length };
    }

    /**
     * Index a source's routes to Typesense
     */
    private async indexSource(
        sourceId: string,
        domainName: string,
        resources: ResourceNode[],
        contentMap: Map<string, string>,
    ): Promise<void> {
        // Flatten resources (handle nested children)
        const flatResources = this.flattenResources(resources);

        // Build documents for this source
        const documents: McpResourceDocument[] = flatResources.map((resource) => {
            const path = resource.path.startsWith('/') ? resource.path.slice(1) : resource.path;
            const uri = `${domainName}://${path}`;
            const content = contentMap.get(resource.path) || resource.metadata?.description || '';

            return {
                id: Buffer.from(uri).toString('base64'),
                uri,
                domain: domainName,
                path,
                source_id: sourceId,
                name: resource.name,
                content,
                scopes: ['public'],
                description: resource.metadata?.description || '',
                content_size: content.length,
                child_count: resource.children?.length || 0,
                type: 'resource',
                resource_type: 'resource',
                path_segment: path.split('/')[0] || '',
                quality_score: 50,
                indexed_at: Date.now(),
            };
        });

        await indexMcpResources(this, documents);
    }

    /**
     * Flatten nested resources into a single array
     */
    private flattenResources(resources: ResourceNode[]): ResourceNode[] {
        const result: ResourceNode[] = [];
        for (const resource of resources) {
            result.push(resource);
            if (resource.children) {
                result.push(...this.flattenResources(resource.children));
            }
        }
        return result;
    }

    /**
     * Index static routes (instructions, templates) to Typesense
     *
     * These are TypeScript-defined routes that need to be searchable.
     * Only indexes metadata - execution still happens via RouteRegistry.
     */
    private async indexStaticRoutes(): Promise<void> {
        const staticRoutes = this.routeRegistry.getAll().filter((r) => r.type === 'instruction' || r.type === 'template');

        if (staticRoutes.length === 0) return;

        const documents: McpResourceDocument[] = staticRoutes.map((route) => {
            const [domain, ...pathParts] = route.route.split('://');
            const path = pathParts.join('://') || domain;

            // Build searchable content from description + inline content
            const contentParts = [route.description];
            if (route.content && typeof route.content === 'string') {
                contentParts.push(route.content);
            }

            return {
                id: Buffer.from(route.route).toString('base64'),
                uri: route.route,
                domain,
                path,
                source_id: `${domain}__static`,
                name: route.name || path.split('/').pop() || path,
                content: contentParts.join('\n\n'),
                scopes: route.requiredScopes || ['public'],
                description: route.description || '',
                content_size: contentParts.join('\n\n').length,
                child_count: 0,
                type: route.type,
                resource_type: route.type,
                path_segment: path.split('/')[0] || '',
                quality_score: 80, // Static routes are high quality
                indexed_at: Date.now(),
            };
        });

        await indexMcpResources(this, documents);

        log('Indexed static routes', {
            count: documents.length,
            types: {
                instructions: staticRoutes.filter((r) => r.type === 'instruction').length,
                templates: staticRoutes.filter((r) => r.type === 'template').length,
            },
        });
    }

    // ============================================================
    // PRIVATE: HELPERS
    // ============================================================

    /**
     * Register static routes (TypeScript-defined)
     *
     * Applies domain-level requiredScopes to all routes in the domain.
     */
    private registerStaticRoutes(): void {
        for (const domain of this.domainRegistry.getAll()) {
            // Apply domain-level scopes to routes
            const routesWithDomainScopes = domain.routes.map((route) => {
                if (!domain.requiredScopes || domain.requiredScopes.length === 0) {
                    return route;
                }

                // Merge domain scopes with route scopes (domain scopes take precedence)
                const mergedScopes = [...new Set([...(domain.requiredScopes || []), ...(route.requiredScopes || [])])];

                return {
                    ...route,
                    requiredScopes: mergedScopes,
                };
            });

            this.routeRegistry.registerAll(routesWithDomainScopes);
        }
    }

    /**
     * Initialize instructions cache
     *
     * Executes each domain's instructions route to warm up the cache.
     * Instructions are quasi-static, so this is done once at startup.
     */
    private async initializeInstructionsCache(): Promise<void> {
        log('Initializing instructions cache...');

        let loaded = 0;
        let skipped = 0;

        for (const domain of this.domainRegistry.getAll()) {
            try {
                // Find the instructions route for this domain
                const instructionsRoute = domain.routes.find(
                    (route) => route.type === 'instruction' && route.route.endsWith('://instructions'),
                );

                if (!instructionsRoute) {
                    skipped++;
                    continue;
                }

                // Execute to warm up cache
                await instructionsRoute.execute(undefined, {
                    timestamp: Date.now(),
                    ernesto: this,
                });

                loaded++;
            } catch (error) {
                log('Failed to load instructions', {
                    domain: domain.name,
                    error,
                });
                skipped++;
            }
        }

        log('Instructions cache initialized', { loaded, skipped });
    }

    /**
     * Pre-build content for all resource nodes
     */
    private prebuildAllContent(nodes: ResourceNode[], contentMap: Map<string, string>): void {
        for (const node of nodes) {
            const content = buildContent(node);
            if (content) {
                contentMap.set(node.path, content);
            }

            if (node.children) {
                this.prebuildAllContent(node.children, contentMap);
            }
        }
    }

    /**
     * Find a source by ID
     */
    private findSource(sourceId: string): {
        domain: string;
        extractor: PipelineConfig;
    } | null {
        for (const domain of this.domainRegistry.getAll()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                const id = generateSourceId(extractor.source.name, extractor.basePath || '');
                if (id === sourceId) {
                    return { domain: domain.name, extractor };
                }
            }
        }

        return null;
    }
}
