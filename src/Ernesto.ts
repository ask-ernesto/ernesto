import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DomainRegistry } from './domain-registry';
import { RouteRegistry } from './router';
import { RouteContext } from './route';
import { Domain } from './domain';
import debug from 'debug';
import { ContentPipeline } from './pipelines';
import { ResourceNode, DEFAULT_CACHE_TTL_MS, PipelineConfig } from './types';
import { deleteSourceDocuments, getSourceFreshness, indexMcpResources } from './typesense/client';
import { McpResourceDocument } from './typesense/schema';
import { Client as TypesenseClient } from 'typesense';
import { LifecycleService } from './LifecycleService';
import { InstructionRegistry } from './instructions/registry';
import { buildInstructionContext } from './instructions/context';
import { truncateText, flattenResources } from './utils';

const log = debug('Ernesto');

interface ErnestoOptions {
    domains: Domain[];
    typesense: TypesenseClient;
    instructionRegistry: InstructionRegistry;
}

/**
 * Ernesto - The unified knowledge system
 *
 * ARCHITECTURE:
 * - Sources: Where data comes from (local files, external APIs, etc.)
 * - Index: Typesense for semantic search and freshness tracking
 * - Routes: HTTP-like endpoints (domain://path) for accessing knowledge
 *
 * INITIALIZATION FLOW:
 * 1. Register static routes (TypeScript-defined tools)
 * 2. For each source:
 *    - Check Typesense for freshness (indexed_at + TTL)
 *    - If FRESH: skip (data already in index)
 *    - If STALE: fetch from source → index (new indexed_at)
 */
export class Ernesto {
    readonly domainRegistry = new DomainRegistry();
    readonly routeRegistry = new RouteRegistry();
    readonly typesense: TypesenseClient;
    readonly instructionRegistry: InstructionRegistry;
    readonly lifecycle = new LifecycleService(this);

    constructor({ domains, typesense, instructionRegistry }: ErnestoOptions) {
        this.domainRegistry.registerAll(domains);
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
        const { attachErnestoTools } = await import('./ernesto-tools');
        await attachErnestoTools(this, server, context);
    }

    /**
     * Build instruction context from current state
     */
    public async buildInstructionContext() {
        return buildInstructionContext(this);
    }

    /**
     * Initialize Ernesto
     */
    public async initialize(): Promise<void> {
        const startTime = Date.now();
        log('Initializing...');

        this.registerStaticRoutes();

        const stats = { fresh: 0, fetched: 0, failed: 0 };

        for (const domain of this.domainRegistry.getAll()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                try {
                    const result = await this.initializeSource(domain.name, extractor);
                    result.wasFresh ? stats.fresh++ : stats.fetched++;
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

        log('Initialization complete', {
            duration: Date.now() - startTime,
            routes: this.routeRegistry.getAll().length,
            ...stats,
        });
    }

    // ============================================================
    // PRIVATE: SOURCE INITIALIZATION
    // ============================================================

    /**
     * Initialize a single source - skip if fresh, fetch if stale
     */
    private async initializeSource(domainName: string, extractor: PipelineConfig): Promise<{ wasFresh: boolean }> {
        const pipeline = new ContentPipeline({
            source: extractor.source,
            formats: extractor.formats,
            basePath: extractor.basePath,
        });
        const sourceId = pipeline.sourceId;
        const ttlMs = extractor.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        const isLocal = extractor.source.name.startsWith('local:');

        // Local sources always fetch (fast, may have new files)
        // Third-party sources check freshness first
        if (!isLocal) {
            const freshness = await getSourceFreshness(this, sourceId);
            if (freshness && freshness.ageMs < ttlMs) {
                log('Source fresh, skipping', {
                    sourceId,
                    ageMinutes: Math.round(freshness.ageMs / 60000),
                });
                return { wasFresh: true };
            }
        }

        // Fetch and index
        await this.fetchAndIndexSource(pipeline, sourceId, domainName, extractor);
        return { wasFresh: false };
    }

    /**
     * Fetch source from origin and index to Typesense
     */
    private async fetchAndIndexSource(
        pipeline: ContentPipeline,
        sourceId: string,
        domainName: string,
        extractor: PipelineConfig,
    ): Promise<void> {
        const resources = await pipeline.fetchResources();

        if (resources.length === 0) {
            log('No resources from source', { sourceId });
            return;
        }

        await deleteSourceDocuments(this, sourceId);
        await this.indexResources(sourceId, domainName, extractor, resources);

        log('Indexed source', {
            sourceId,
            domainName,
            resourceCount: resources.length,
        });
    }

    /**
     * Index resources to Typesense
     */
    public async indexResources(
        sourceId: string,
        domainName: string,
        pipelineConfig: PipelineConfig,
        resources: ResourceNode[],
    ): Promise<void> {
        // Get domain and merge scopes
        const domain = this.domainRegistry.get(domainName);
        const domainScopes = domain?.requiredScopes || [];
        const pipelineScopes = pipelineConfig.scopes || [];

        // Merge domain + pipeline scopes (following same pattern as routes)
        const mergedScopes = [...new Set([...domainScopes, ...pipelineScopes])];

        // Flatten resources (handle nested children)
        const flatResources = flattenResources(resources);

        // Build documents for this source
        const documents: McpResourceDocument[] = flatResources.map((resource) => {
            const path = resource.path.startsWith('/') ? resource.path.slice(1) : resource.path;
            const uri = `${domainName}://resources/${path}`;

            // Description from ResourceNode or truncate content
            const description = truncateText(resource.description || resource.content);

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

    // ============================================================
    // PRIVATE: HELPERS
    // ============================================================

    /**
     * Register static routes with domain-level scopes applied
     */
    private registerStaticRoutes(): void {
        for (const domain of this.domainRegistry.getAll()) {
            if (!domain.requiredScopes?.length) {
                this.routeRegistry.registerAll(domain.routes);
                continue;
            }

            // Merge domain scopes into each route
            const routesWithScopes = domain.routes.map((route) => ({
                ...route,
                requiredScopes: [...new Set([...domain.requiredScopes!, ...(route.requiredScopes || [])])],
            }));

            this.routeRegistry.registerAll(routesWithScopes);
        }
    }
}
