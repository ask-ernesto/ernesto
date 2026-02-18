/**
 * MCP Tool: ask
 *
 * Semantic search across Ernesto — returns skills with tool listings + resources.
 */

import { z } from 'zod';
import { ToolContext } from '../skill';
import { formatZodSchemaForAgent } from '../schema-formatter';
import { searchResources } from '../typesense/search';
import debug from 'debug';

const log = debug('ask');

const inputSchema = z.object({
    query: z.string().min(1).describe('Natural language search query'),
    domain: z.string().optional().describe('Filter to specific domain'),
    perDomain: z.number().min(1).max(50).default(10).optional().describe('Maximum results per domain (default: 10)'),
});

export function createAskTool(context: ToolContext, description: string) {
    return {
        name: 'ask',
        description,
        inputSchema,
        handler: async ({ query, domain, perDomain = 10 }: any, _extra: any) => {
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
                content: [{ type: 'text' as const, text: result }],
            };
        },
    };
}

interface SearchParams {
    query: string;
    domain?: string;
    perDomain: number;
}

async function executeSearch(ctx: ToolContext, params: SearchParams): Promise<string> {
    const { query, domain, perDomain } = params;

    const response: Record<string, any> = {};

    const allSkills = ctx.ernesto.skillRegistry.getAll();
    const skillsToSearch = domain ? allSkills.filter((s) => s.name === domain) : allSkills;

    for (const skill of skillsToSearch) {
        const skillName = skill.name;
        const searchConfig = skill.searchConfig || {};

        if (skill.requiredScopes?.length) {
            const hasPermission = skill.requiredScopes.every((s) => ctx.scopes?.includes(s));
            if (!hasPermission) continue;
        }

        // Build tool listing as the skill entry point
        const routeResults: any[] = [];

        const toolListing = skill.tools.map((t) => {
            const params = t.inputSchema ? formatZodSchemaForAgent(t.inputSchema) : undefined;
            return `${skill.name}:${t.name} - ${t.description}${params ? ` (${params})` : ''}`;
        }).join('; ');

        routeResults.push({
            route: skill.name,
            description: `${skill.description}${toolListing ? ` | Tools: ${toolListing}` : ''}`,
            type: 'skill' as const,
        });

        // Get resources from Typesense (semantic search)
        const resourceResults = (
            await searchResources(ctx.ernesto, {
                query,
                domain: skillName,
                segments: searchConfig.segments,
                queryBy: searchConfig.queryBy,
                weights: searchConfig.weights,
                scopes: ctx.scopes,
            })
        ).map((r) => ({ route: r.uri, description: r.description, type: 'resource' as const, segment: r.segment }));

        const limitedResults = [...routeResults, ...resourceResults.slice(0, perDomain)];

        if (limitedResults.length === 0) continue;

        response[skillName] = {
            description: skill.description,
            routes: {
                list: limitedResults,
                count: limitedResults.length,
                ...(routeResults.length + resourceResults.length > limitedResults.length && {
                    more_available: routeResults.length + resourceResults.length - limitedResults.length,
                }),
            },
        };
    }

    const matchingDomains = Object.keys(response).length;
    log('Complete', { query, matchingDomains });

    return formatSearchResponse(response);
}

function formatSearchResponse(response: Record<string, any>): string {
    const parts: string[] = [];

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
