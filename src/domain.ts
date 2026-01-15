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
     */
    routes: Route[];

    /**
     * Knowledge extractors
     */
    extractors?: PipelineConfig[];

    /**
     * Search configuration (optional)
     * Defines how this domain's content should be ranked in search.
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
        ...(config.requiredScopes && { requiredScopes: config.requiredScopes }),
    };
}
