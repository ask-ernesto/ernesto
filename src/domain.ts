import { PipelineConfig } from './types';
import { Route, DomainSearchConfig } from './route';

/**
 * Domain configuration
 *
 * Represents a complete domain with all its routes.
 */
export interface Domain {
    /** Domain name */
    name: string;

    /** Domain description */
    description: string;

    /**
     * All routes for this domain
     * - Instructions: workflow guidance that unlocks tools
     * - Tools: operations with input schemas, hidden from search
     * - Templates: pre-built operations returning MarkdownUI
     * - Resources: content routes generated from extractors
     */
    routes: Route[];

    /**
     * Knowledge extractors for generating informational routes (optional)
     * System converts extracted content into informational routes automatically
     */
    extractors?: PipelineConfig[];

    /**
     * Search configuration (optional)
     * Defines how this domain's content should be ranked in search.
     * All searches use semantic mode for meaning-based discovery.
     * If not provided, uses default: content-weighted semantic search.
     */
    searchConfig?: DomainSearchConfig;

    /**
     * Required scopes for this domain (optional)
     * If specified, all routes in this domain require users to have these scopes.
     * Example: ['ernesto-admin'] restricts entire domain to users with that permission.
     */
    requiredScopes?: string[];
}

/**
 * Create a domain configuration with minimal boilerplate
 *
 * @param config - Domain configuration
 * @returns Complete Domain object
 *
 * @example
 * ```typescript
 * export const myDomain = createDomain({
 *     name: 'my-domain',
 *     description: 'My domain description',
 *     routes: [route1, route2],
 *     resourceTree: myResourceTree,  // optional
 *     searchConfig: {                // optional
 *         queryBy: 'description,name,content',
 *         weights: '4,2,1',
 *         mode: 'hybrid'
 *     }
 * });
 * ```
 */
export function createDomain(config: {
    name: string;
    description: string;
    routes: Route<any>[];
    extractors?: PipelineConfig[];
    searchConfig?: DomainSearchConfig;
    requiredScopes?: string[];
}): Domain {
    return {
        name: config.name,
        description: config.description,
        routes: config.routes,
        ...(config.extractors && { extractors: config.extractors }),
        ...(config.searchConfig && { searchConfig: config.searchConfig }),
        ...(config.requiredScopes && { requiredScopes: config.requiredScopes })
    };
}
