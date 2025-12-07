/**
 * Typesense Schema for MCP Resources
 *
 * This collection enables semantic search across all MCP resources.
 * Instead of dumping the entire resource tree into tool descriptions,
 * we index resources and let agents discover them semantically.
 */

import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';

export const MCP_RESOURCES_COLLECTION = 'mcp_resources';

export const mcpResourcesSchema: CollectionCreateSchema = {
    name: MCP_RESOURCES_COLLECTION,
    fields: [
        // === Identity ===
        { name: 'uri', type: 'string', facet: false, index: true },
        { name: 'domain', type: 'string', facet: true, index: true },
        { name: 'path', type: 'string', facet: false, index: true },
        {
            name: 'scopes',
            type: 'string[]',
            facet: false,
            index: true,
            optional: true,
        },

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
        { name: 'type', type: 'string', facet: true, index: true }, // Route type: instruction, resource, template (tools excluded from index)
        { name: 'resource_type', type: 'string', facet: true, index: true }, // Semantic type: column, table, page, doc, etc.
        { name: 'path_segment', type: 'string', facet: true, index: true }, // First path segment for filtering (aggregates, facts, dimensions, etc.)

        // === Quality Score (pre-computed ranking) ===
        // Combines structure and type signals into a single 0-100 score
        // Higher = better quality (better structured, more valuable type)
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
    id: string; // Stable ID for upsert (typically same as uri)
    uri: string;
    domain: string;
    path: string;
    source_id: string; // Identifies which extractor/source produced this document
    scopes?: string[];
    name: string;
    content: string;
    description: string;
    content_size: number;
    child_count: number;
    type: string; // Route type: instruction, resource, template (tools excluded)
    resource_type: string; // Semantic type: column, table, page, doc, etc.
    path_segment: string; // First path segment for filtering (aggregates, facts, dimensions, etc.)
    quality_score: number; // Pre-computed 0-100 quality score
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
