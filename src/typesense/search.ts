/**
 * Typesense Resource Search
 *
 * Pure Typesense search functionality for resources.
 * Routes are NOT in Typesense - they live in RouteRegistry.
 */

import { SearchSegment } from '../route';
import { searchMcpResources } from './client';
import { Ernesto } from '../Ernesto';
import debug from 'debug';

const log = debug('ernesto:typesense:search');

/**
 * Default search segment for resources
 */
const DEFAULT_SEGMENTS: SearchSegment[] = [
    {
        name: 'resources',
        filter: '',
        limit: 20,
        description: 'Resources extracted from sources',
        priority: 1
    }
];

export interface ResourceSearchResult {
    uri: string;
    description: string;
    segment: string;
}

export interface ResourceSearchOptions {
    query: string;
    domain: string;
    segments?: SearchSegment[];
    queryBy?: string;  // Comma-separated field names
    weights?: string;
    scopes?: string[];
}

/**
 * Search resources in Typesense for a specific domain
 *
 * This is the pure Typesense search - no route composition.
 * Returns matching resources ranked by relevance.
 */
export async function searchResources(
    ernesto: Ernesto,
    options: ResourceSearchOptions
): Promise<ResourceSearchResult[]> {
    const { query, domain, segments, queryBy, weights, scopes } = options;

    const activeSegments = segments && segments.length > 0
        ? segments
        : DEFAULT_SEGMENTS;

    const results: ResourceSearchResult[] = [];
    const sortedSegments = [...activeSegments].sort((a, b) => a.priority - b.priority);

    for (const segment of sortedSegments) {
        try {
            const segmentResults = await searchMcpResources(ernesto, query, {
                domain,
                limit: segment.limit,
                mode: 'semantic',
                filterBy: segment.filter || undefined,
                queryBy,
                weights,
                scopes
            });

            for (const result of segmentResults) {
                results.push({
                    uri: result.uri,
                    description: result.description || '',
                    segment: segment.name,
                });
            }
        } catch (error) {
            log('Segment search failed', {
                domain,
                segment: segment.name,
                error: error.message
            });
        }
    }

    return results;
}
