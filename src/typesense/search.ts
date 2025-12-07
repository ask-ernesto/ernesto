/**
 * Ask Route
 *
 * Unified semantic search across all routes.
 * Returns matching instructions, templates, and resources ranked by relevance.
 * Tools are hidden - they're only accessible via instructions that unlock them.
 */

import { z } from 'zod';
import { Route, RouteContext, SearchSegment } from '../types';
import { searchMcpResources } from './client';
import { formatZodSchemaForAgent } from '../schema-formatter';
import debug from 'debug';
import { MASTER_INSTRUCTIONS } from '../master_instructions';

const log = debug('ernesto:search-route');

/**
 * Default search segments for all domains
 *
 * Instructions and templates are always surfaced regardless of semantic relevance.
 * This ensures agents always see available workflows and pre-built operations.
 * Domains can override with custom segments in their searchConfig.
 */
const DEFAULT_SEGMENTS: SearchSegment[] = [
    {
        name: 'templates',
        filter: 'type:=template',
        limit: 10,
        description: 'Pre-built operations that return rendered results',
        priority: 1,
    },
    {
        name: 'instructions',
        filter: 'type:=instruction',
        limit: 10,
        description: 'Workflow guidance that unlocks tools',
        priority: 2,
    },
    {
        name: 'resources',
        filter: 'type:=resource',
        limit: 15,
        description: 'Knowledge resources',
        priority: 3,
    },
];

const inputSchema = z.object({
    query: z.string().min(1).describe('Natural language search query'),
    domain: z.string().optional().describe('Filter to specific domain (e.g., "data-warehouse", "qa")'),
    perDomain: z.number().min(1).max(50).default(10).optional().describe('Maximum results per domain (default: 10)'),
});

const outputSchema = z.record(z.any()); // Dynamic per-domain structure

type TInput = z.infer<typeof inputSchema>;
type TOutput = z.infer<typeof outputSchema>;

/**
 * Route: semantic://ask
 *
 * Semantic search across Ernesto. Returns matching instructions, templates,
 * and resources ranked by relevance. Tools are hidden from search results.
 *
 * When an instruction is loaded via get(), it returns the instruction content
 * plus the tools it unlocks. Templates execute tools internally and return
 * rendered MarkdownUI.
 */
export const searchRoute: Route<TInput, TOutput> = {
    route: 'semantic://ask',
    type: 'tool',
    description: 'Semantic search across Ernesto. Returns matching instructions, templates, and resources ranked by relevance.',
    freshness: 'live',

    inputSchema,
    outputSchema,

    async execute(params, ctx: RouteContext) {
        const { query, domain, perDomain = 10 } = params;

        log('Ask', { query, domain, perDomain, userId: ctx.user?.id });

        // Get domains to search
        const allDomains = ctx.ernesto.domainRegistry.getAll();
        const domainsToSearch = domain ? allDomains.filter((d) => d.name === domain) : allDomains;

        // Build response structure
        const response: any = {
            guide: MASTER_INSTRUCTIONS,
        };

        // Search each domain
        for (const domainConfig of domainsToSearch) {
            const domainName = domainConfig.name;
            const searchConfig = domainConfig.searchConfig || {};

            // Search Typesense for matching routes (tools are excluded from index)
            // Always use segmented search to ensure instructions/templates surface
            const segments = searchConfig.segments && searchConfig.segments.length > 0 ? searchConfig.segments : DEFAULT_SEGMENTS;

            const allResults: any[] = [];
            const sortedSegments = [...segments].sort((a, b) => a.priority - b.priority);

            for (const segment of sortedSegments) {
                const segmentResults = await searchMcpResources(ctx.ernesto, query, {
                    domain: domainName,
                    limit: segment.limit,
                    mode: 'semantic',
                    filterBy: segment.filter,
                    queryBy: searchConfig.queryBy,
                    weights: searchConfig.weights,
                    scopes: ctx.scopes,
                });

                // Tag results with segment name
                for (const result of segmentResults) {
                    allResults.push({ ...result, segment: segment.name });
                }
            }

            const searchResults = allResults;

            // Convert search results to route info
            const instructions: any[] = [];
            const templates: any[] = [];
            const resources: any[] = [];

            for (const result of searchResults) {
                // Try to get route from registry (for tools, templates, instructions)
                const route = ctx.ernesto.routeRegistry.get(result.uri);

                // For resources: they're not in registry anymore, served directly from Typesense
                if (!route && result.type === 'resource') {
                    const routeInfo: any = {
                        route: result.uri,
                        description: result.description || '',
                    };
                    if (result.segment) {
                        routeInfo.segment = result.segment;
                    }
                    resources.push(routeInfo);
                    continue;
                }

                if (!route) continue;

                // Check permissions
                if (route.requiredScopes && route.requiredScopes.length > 0) {
                    const hasPermission = route.requiredScopes.every((p) => ctx.scopes?.includes(p));
                    if (!hasPermission) continue;
                }

                const routeInfo: any = {
                    route: route.route,
                    description: route.description,
                    ...(route.requiredScopes && { permissions: route.requiredScopes }),
                };

                if (route.type === 'instruction') {
                    // Show count of tools unlocked, not the routes themselves (tools stay hidden)
                    if (route.unlocks && route.unlocks.length > 0) {
                        routeInfo.unlocks = route.unlocks.length;
                    }
                    instructions.push(routeInfo);
                } else if (route.type === 'template') {
                    // Include input schema for templates
                    const parameters = formatZodSchemaForAgent(route.inputSchema, 'Parameters');
                    if (parameters) {
                        routeInfo.parameters = parameters;
                    }
                    templates.push(routeInfo);
                } else if (route.type === 'resource') {
                    // Include segment if available
                    if (result.segment) {
                        routeInfo.segment = result.segment;
                    }
                    resources.push(routeInfo);
                }
                // Tools are not included - they're hidden from search
            }

            // Only include domain if it has matching results
            const hasResults = instructions.length > 0 || templates.length > 0 || resources.length > 0;
            if (!hasResults) continue;

            // Apply per-domain limit
            const limitedResources = resources.slice(0, perDomain);

            // Build domain response - order: description → templates → instructions → resources
            // Description first: hints the agent about what the domain provides
            // Templates second: pre-built solutions should be used before loading instructions
            response[domainName] = {
                description: domainConfig.description,
                ...(templates.length > 0 && { templates }),
                ...(instructions.length > 0 && { instructions }),
                ...(limitedResources.length > 0 && {
                    resources: {
                        list: limitedResources,
                        count: limitedResources.length,
                        ...(resources.length > limitedResources.length && {
                            more_available: resources.length - limitedResources.length,
                        }),
                    },
                }),
            };
        }

        const matchingDomains = Object.keys(response).filter((k) => k !== 'guide').length;
        log('Ask Complete', { query, matchingDomains });

        return response;
    },
};
