/**
 * MCP Tool: ask
 *
 * Semantic search across Ernesto.
 *
 * TWO SOURCES:
 * 1. Searchable routes from RouteRegistry (always surfaced)
 * 2. Resources from Typesense (semantic search)
 *
 * Hidden routes are never returned - only via get() or unveils.
 */

import { z } from 'zod';
import { RouteContext } from '../route';
import { searchResources } from '../typesense/search';
import { formatZodSchemaForAgent } from '../schema-formatter';
import debug from 'debug';

const log = debug('ernesto:tools:search');

const inputSchema = z.object({
    query: z.string().min(1).describe('Natural language search query'),
    domain: z.string().optional()
        .describe('Filter to specific domain'),
    perDomain: z.number().min(1).max(50).default(10).optional()
        .describe('Maximum results per domain (default: 10)')
});

export interface AskTool {
    name: 'ask';
    description: string;
    inputSchema: typeof inputSchema;
    handler: (params: z.infer<typeof inputSchema>) => Promise<{
        content: { type: 'text'; text: string }[];
    }>;
}

export function createSearchTool(context: RouteContext, description: string): AskTool {
    return {
        name: 'ask',
        description,
        inputSchema,
        handler: async ({ query, domain, perDomain = 10 }) => {
            log('ask called', {
                query,
                domain,
                perDomain,
                userId: context.user?.id,
                requestId: context.requestId,
            });

            const result = await executeSearch(context, { query, domain, perDomain });

            log('ask complete', { query });

            return {
                content: [{ type: 'text' as const, text: result }]
            };
        }
    };
}

interface SearchParams {
    query: string;
    domain?: string;
    perDomain: number;
}

/**
 * Execute search combining routes + resources
 */
async function executeSearch(ctx: RouteContext, params: SearchParams): Promise<string> {
    const { query, domain, perDomain } = params;

    // Get domains to search
    const allDomains = ctx.ernesto.domainRegistry.getAll();
    const domainsToSearch = domain
        ? allDomains.filter(d => d.name === domain)
        : allDomains;

    // Build response structure
    const response: Record<string, any> = {};

    // Search each domain
    for (const domainConfig of domainsToSearch) {
        const domainName = domainConfig.name;
        const searchConfig = domainConfig.searchConfig || {};

        // === PART 1: Get searchable routes from RouteRegistry (always surfaced) ===
        const routeResults = getSearchableRoutes(ctx, domainName);

        // === PART 2: Get resources from Typesense (semantic search) ===
        const resourceResults = await searchResources(ctx.ernesto, {
            query,
            domain: domainName,
            segments: searchConfig.segments,
            queryBy: searchConfig.queryBy,
            weights: searchConfig.weights,
            scopes: ctx.scopes
        });

        // === COMBINE: Routes first, then resources ===
        const allResults = [
            ...routeResults.map(r => ({ ...r, type: 'route' as const })),
            ...resourceResults.map(r => ({ route: r.uri, description: r.description, type: 'resource' as const, segment: r.segment }))
        ];

        // Only include domain if it has matching results
        if (allResults.length === 0) continue;

        // Apply per-domain limit
        const limitedResults = allResults.slice(0, perDomain);

        // Build domain response
        response[domainName] = {
            description: domainConfig.description,
            routes: {
                list: limitedResults,
                count: limitedResults.length,
                ...(allResults.length > limitedResults.length && {
                    more_available: allResults.length - limitedResults.length
                })
            }
        };
    }

    const matchingDomains = Object.keys(response).length;
    log('Ask complete', { query, matchingDomains });

    return formatSearchResponse(response);
}

/**
 * Get all searchable routes for a domain from RouteRegistry
 */
function getSearchableRoutes(ctx: RouteContext, domainName: string): Array<{
    route: string;
    description: string;
    permissions?: string[];
    parameters?: string;
}> {
    const allRoutes = ctx.ernesto.routeRegistry.getAll();
    const domainSearchableRoutes = allRoutes.filter(r =>
        r.route.startsWith(`${domainName}://`) && r.searchable
    );

    const results: Array<{
        route: string;
        description: string;
        permissions?: string[];
        parameters?: string;
    }> = [];

    for (const route of domainSearchableRoutes) {
        // Check permissions
        if (route.requiredScopes && route.requiredScopes.length > 0) {
            const hasPermission = route.requiredScopes.every(p =>
                ctx.scopes?.includes(p)
            );
            if (!hasPermission) continue;
        }

        const routeInfo: {
            route: string;
            description: string;
            permissions?: string[];
            parameters?: string;
        } = {
            route: route.route,
            description: route.description,
        };

        if (route.requiredScopes) {
            routeInfo.permissions = route.requiredScopes;
        }

        // Include input schema if route has parameters
        if (route.inputSchema) {
            const parameters = formatZodSchemaForAgent(route.inputSchema, 'Parameters');
            if (parameters) {
                routeInfo.parameters = parameters;
            }
        }

        results.push(routeInfo);
    }

    return results;
}

/**
 * Format search response as markdown with embedded data
 */
function formatSearchResponse(response: Record<string, any>): string {
    const parts: string[] = [];

    // Domain results
    const domains = Object.keys(response);

    if (domains.length === 0) {
        parts.push('No matching routes found.');
        return parts.join('\n');
    }

    for (const domainName of domains) {
        const domain = response[domainName];
        parts.push(`## ${domainName}`);
        if (domain.description) {
            parts.push(`*${domain.description}*`);
        }
        parts.push('');

        if (domain.routes?.list) {
            for (const route of domain.routes.list) {
                parts.push(`- **\`${route.route}\`**: ${route.description}`);
                if (route.parameters) {
                    parts.push(`  *${route.parameters}*`);
                }
            }
            if (domain.routes.more_available) {
                parts.push(`  - *${domain.routes.more_available} more available*`);
            }
        }

        parts.push('');
    }

    return parts.join('\n');
}
