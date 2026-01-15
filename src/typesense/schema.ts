/**
 * Typesense Schema for MCP Resources
 *
 */

import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';

// TODO: Configurable
export const MCP_RESOURCES_COLLECTION = 'mcp_resources';

export const mcpResourcesSchema: CollectionCreateSchema = {
    name: MCP_RESOURCES_COLLECTION,
    fields: [
        // === Identity ===
        { name: 'uri', type: 'string', facet: false, index: true },
        { name: 'domain', type: 'string', facet: true, index: true },
        { name: 'path', type: 'string', facet: false, index: true },
        { name: 'scopes', type: 'string[]', facet: false, index: true, optional: true },
        { name: 'is_unrestricted', type: 'bool', facet: false, index: true },

        // === Source Tracking ===
        // Identifies which extractor/source produced this document
        // Used for per-source freshness checks on restart
        { name: 'source_id', type: 'string', facet: true, index: true },

        // === Searchable Content ===
        // These fields are the semantic search surface
        { name: 'name', type: 'string', facet: false, index: true },
        { name: 'content', type: 'string', facet: false, index: true },
        { name: 'description', type: 'string', facet: false, index: true },

        // === Metadata for Ranking ===
        { name: 'content_size', type: 'int32', facet: false, index: true },
        { name: 'child_count', type: 'int32', facet: false, index: true },
        { name: 'resource_type', type: 'string', facet: true, index: true }, // Semantic type: column, table, page, doc, etc.
        { name: 'path_segment', type: 'string', facet: true, index: true }, // First path segment for filtering at the domain level.

        // === Quality Score (pre-computed ranking) ===
        // TODO: Remove?
        { name: 'quality_score', type: 'int32', facet: false, index: true },

        // === Timestamps ===
        { name: 'indexed_at', type: 'int64', facet: false, index: true },
    ],
    default_sorting_field: 'quality_score',
};

/**
 * Document structure for indexing
 */
export interface McpResourceDocument {
    id: string;
    uri: string;
    domain: string;
    path: string;
    source_id: string;
    scopes?: string[];
    is_unrestricted: boolean;
    name: string;
    content: string;
    description: string;
    content_size: number;
    child_count: number;
    resource_type: string;
    path_segment: string;
    quality_score: number;
    indexed_at: number;
}

/**
 * Search result structure
 */
export interface McpResourceSearchResult {
    uri: string;
    domain: string;
    scopes?: string[];
    name: string;
    description: string;
    content_size: number;
    child_count: number;
    relevance: number;
    descriptionSnippet?: string;
    contentSnippet?: string;
}
