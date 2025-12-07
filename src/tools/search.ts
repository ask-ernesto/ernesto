/**
 * System Tool: ask
 *
 * Semantic search across Ernesto.
 * Returns matching instructions, templates, and resources ranked by relevance.
 * Tools are hidden - they're only accessible via instructions that unlock them.
 */

import { z } from 'zod';
import { RouteContext } from '../types';
import debug from 'debug';
import { searchRoute } from '../typesense/search';

const log = debug('ernesto:search-tool');

const inputSchema = z.object({
    query: z.string().min(1).describe('Natural language search query'),
    domain: z.string().optional().describe('Filter to specific domain (e.g., "data-warehouse", "qa")'),
    perDomain: z.number().min(1).max(50).default(10).optional().describe('Maximum results per domain (default: 10)'),
});

export function createSearchTool(context: RouteContext) {
    return {
        name: 'ask',
        description: 'Semantic search across Ernesto. Returns matching instructions, templates, and resources ranked by relevance.',
        inputSchema,
        handler: async ({ query, domain, perDomain = 10 }) => {
            log('ask called', {
                query,
                domain,
                perDomain,
                userId: context.user?.id,
                requestId: context.requestId,
            });

            // Call the ask route
            const result = await searchRoute.execute(
                {
                    query,
                    domain,
                    perDomain,
                },
                context,
            );

            const domainCount = Object.keys(result as object).filter((k) => k !== 'guide').length;
            log('ask complete', {
                query,
                domainCount,
            });

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        },
    };
}
