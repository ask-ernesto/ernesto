import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DomainRegistry } from './domain-registry';
import { RouteRegistry } from './router';
import { Route, RouteContext } from './route';
import { Domain } from './domain';
import { createSearchTool } from './tools/search';
import { createGetTool } from './tools/get';
import debug from 'debug';
import { ContentPipeline, generateSourceId } from './pipelines';
import { ResourceNode, DEFAULT_CACHE_TTL_MS, PipelineConfig } from './types';
import {
    clearAllResources,
    deleteSourceDocuments,
    exportSourceDocuments,
    getSourceFreshness,
    indexMcpResources,
} from './typesense/client';
import { McpResourceDocument } from './typesense/schema';
import { Client as TypesenseClient } from 'typesense';
import { LifecycleService } from './LifecycleService';
import { InstructionRegistry } from './instructions/registry';
import { buildInstructionContext } from './instructions/context';

const log = debug('ernesto');

interface ErnestoOptions {
    domains: Domain[];
    routes: Route[];
    typesense: TypesenseClient;
    instructionRegistry: InstructionRegistry;
}

/**
 * Ernesto - The unified knowledge system
 *
 * ARCHITECTURE:
 * - Sources: Where data comes from (local files, external APIs, etc.)
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
    readonly typesense: TypesenseClient;
    readonly instructionRegistry: InstructionRegistry;
    readonly lifecycle = new LifecycleService(this);

    constructor({ domains, routes, typesense, instructionRegistry }: ErnestoOptions) {
        this.domainRegistry.registerAll(domains);
        this.routeRegistry.registerAll(routes);
        this.typesense = typesense;
        this.instructionRegistry = instructionRegistry;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Attach Ernesto to an MCP server
     */
    public async attachToMcpServer(server: McpServer, context: RouteContext): Promise<void> {
        context.ernesto = this;

        // Build instruction context
        const instructionContext = await buildInstructionContext(this);

        // Create tools with rendered descriptions
        const searchTool = createSearchTool(
            context,
            this.instructionRegistry.renderAskTool(instructionContext)
        );
        const getTool = createGetTool(
            context,
            this.instructionRegistry.renderGetTool(instructionContext)
        );

        server.registerTool(searchTool.name, {
            description: searchTool.description,
            inputSchema: searchTool.inputSchema,
        }, searchTool.handler);

        server.registerTool(getTool.name, {
            description: getTool.description,
            inputSchema: getTool.inputSchema,
        }, getTool.handler);

        // Store rendered instructions on server for later access (used by HTTP server)
        const instructions = this.instructionRegistry.render(instructionContext);
        (server as any).__ernestoInstructions = instructions;
    }

    /**
     * Clear in-memory state (for restart/rebuild operations)
     */
    public clearState(): void {
        this.routeRegistry.clear();
    }

    /**
     * Build instruction context from current state
     */
    public async buildInstructionContext() {
        return buildInstructionContext(this);
    }

    /**
     * Re-fetch a source and index it (exposed for LifecycleService)
     */
    public async refetchSource(
        domainName: string,
        extractor: any
    ): Promise<{ resourceCount: number }> {
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

        // Note: Static routes (searchable: true) are served directly from RouteRegistry.
        // No indexing needed - they're always surfaced in ask() results.

        // Note: Background refreshes should be handled externally

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
    private async initializeSource(
        domainName: string,
        extractor: PipelineConfig
    ): Promise<{ fromIndex: boolean; resourceCount: number }> {
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
        ttlMs: number
    ): Promise<{ fromIndex: boolean; resourceCount: number }> {
        const docs = await exportSourceDocuments(this, sourceId);

        if (docs.length === 0) {
            log('No documents found for fresh source', { sourceId });
            return { fromIndex: true, resourceCount: 0 };
        }

        const resourceCount = docs.length;

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
    private async fetchAndIndexSource(
        domainName: string,
        extractor: PipelineConfig
    ): Promise<{ resourceCount: number }> {
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

        // Delete old documents and index new ones
        await deleteSourceDocuments(this, sourceId);
        await this.indexSource(sourceId, domainName, extractor, resources);

        log('Fetched and indexed source', {
            sourceId,
            domainName,
            resourceCount: resources.length,
        });

        return { resourceCount: resources.length };
    }

    /**
     * Index a source's routes to Typesense
     *
     * Merges domain-level and pipeline-level scopes for access control.
     */
    private async indexSource(
        sourceId: string,
        domainName: string,
        pipelineConfig: PipelineConfig,
        resources: ResourceNode[]
    ): Promise<void> {
        // Get domain and merge scopes
        const domain = this.domainRegistry.get(domainName);
        const domainScopes = domain?.requiredScopes || [];
        const pipelineScopes = pipelineConfig.scopes || [];

        // Merge domain + pipeline scopes (following same pattern as routes)
        const mergedScopes = [...new Set([...domainScopes, ...pipelineScopes])];

        // Flatten resources (handle nested children)
        const flatResources = this.flattenResources(resources);

        // Build documents for this source
        const documents: McpResourceDocument[] = flatResources.map(resource => {
            const path = resource.path.startsWith('/')
                ? resource.path.slice(1)
                : resource.path;
            const uri = `${domainName}://resources/${path}`;

            // Description from ResourceNode or truncate content
            const description = resource.description
                ? this.truncateDescription(resource.description)
                : this.truncateDescription(resource.content);

            // Scopes: empty array = unrestricted (visible to all)
            // Non-empty array = restricted (user must have ALL scopes)
            // Use merged scopes unless resource explicitly overrides
            const resourceScopes = resource.metadata?.scopes;
            const finalScopes = resourceScopes !== undefined ? resourceScopes : mergedScopes;

            return {
                id: Buffer.from(uri).toString('base64'),
                uri,
                domain: domainName,
                path,
                source_id: sourceId,
                name: resource.name,
                content: resource.content,
                scopes: finalScopes,
                is_unrestricted: finalScopes.length === 0,
                description,
                content_size: resource.content.length,
                child_count: resource.children?.length || 0,
                resource_type: resource.metadata?.resource_type || 'resource',
                path_segment: path.split('/')[0] || '',
                quality_score: resource.metadata?.quality_score ?? 50,
                indexed_at: Date.now(),
            };
        });

        await indexMcpResources(this, documents);
    }

    /**
     * Truncate description to reasonable length for MCP search results
     *
     * Limits description to ~200 characters to avoid bloating MCP responses.
     * Full content is always available in the content field.
     */
    private truncateDescription(description: string, maxLength = 200): string {
        if (!description || description.length <= maxLength) {
            return description;
        }

        // Find the last sentence boundary before maxLength
        const truncated = description.slice(0, maxLength);
        const lastSentence = truncated.match(/^.*[.!?]/);

        if (lastSentence && lastSentence[0].length > 50) {
            // Use last complete sentence if it's substantial
            return lastSentence[0].trim();
        }

        // Otherwise, truncate at word boundary
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > 50) {
            return truncated.slice(0, lastSpace).trim() + '...';
        }

        return truncated.trim() + '...';
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
            const routesWithDomainScopes = domain.routes.map(route => {
                if (!domain.requiredScopes || domain.requiredScopes.length === 0) {
                    return route;
                }

                // Merge domain scopes with route scopes (domain scopes take precedence)
                const mergedScopes = [
                    ...new Set([
                        ...(domain.requiredScopes || []),
                        ...(route.requiredScopes || [])
                    ])
                ];

                return {
                    ...route,
                    requiredScopes: mergedScopes
                };
            });

            this.routeRegistry.registerAll(routesWithDomainScopes);
        }
    }

    /**
     * Initialize searchable routes cache
     *
     * Counts searchable routes with static freshness for stats.
     */
    private async initializeInstructionsCache(): Promise<void> {
        log('Initializing searchable routes cache...');

        let loaded = 0;

        for (const domain of this.domainRegistry.getAll()) {
            // Count searchable routes with static freshness
            const staticRoutes = domain.routes.filter(
                route => route.searchable && route.freshness === 'static'
            );
            loaded += staticRoutes.length;
        }

        log('Searchable routes cache initialized', { loaded });
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
                const id = generateSourceId(
                    extractor.source.name,
                    extractor.basePath || ''
                );
                if (id === sourceId) {
                    return { domain: domain.name, extractor };
                }
            }
        }

        return null;
    }
}
