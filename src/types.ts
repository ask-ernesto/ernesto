/**
 * Route Interface
 *
 * Routes are the primitive of the Ernesto.
 * Everything is a route - operations, documentation, knowledge.
 */

import { z } from 'zod';
// eslint-disable-next-line import/no-cycle -- Type-only import, no runtime cycle
import type { Ernesto } from './Ernesto';
import type { OutputFormatter } from './utils';

/**
 * Execution context passed to routes
 */
export interface RouteContext {
    /** Authenticated user (if applicable) */
    user?: {
        id: string;
    };

    /** Permission scopes for this request */
    scopes?: string[];

    /** Request metadata */
    requestId?: string;
    timestamp: number;

    /** Reference to Ernesto orchestrator */
    ernesto: Ernesto;
}

/**
 * Data freshness indicator
 *
 * - 'live' - Data fetched in real-time (queries, API calls, live operations)
 * - 'unknown' - Freshness cannot be determined
 * - ISO timestamp - When cached content was last updated (e.g., "2025-01-15T10:30:00Z")
 */
export type Freshness = 'live' | 'unknown' | string;

/**
 * Route type classification
 *
 * - 'instruction' - Workflow guidance that unlocks tools (domain://instructions/query-builder)
 * - 'tool' - Operations requiring parameters, hidden from search (data-warehouse://query)
 * - 'resource' - Extracted knowledge without parameters (qa://tests/payment-timeout)
 * - 'template' - Pre-built operations that execute internally and return MarkdownUI (data-warehouse://templates/revenue-breakdown)
 */
export type RouteType = 'instruction' | 'tool' | 'resource' | 'template';

/**
 * Markdown UI Component
 *
 * The universal output format for templates. Clients render markdown however they want.
 * Templates execute tools internally and return rendered results as MarkdownUI.
 */
export interface MarkdownUI {
    type: 'markdown';
    content: string;
    metadata?: Record<string, string>;
}

/**
 * Create a MarkdownUI response
 *
 * @param content - Markdown content to render
 * @param metadata - Optional metadata (title, timeframe, etc.)
 */
export function markdown(content: string, metadata?: Record<string, string>): MarkdownUI {
    return { type: 'markdown', content, metadata };
}

/**
 * Instruction Definition
 *
 * TypeScript-defined workflow guidance that unlocks tools.
 * Instructions are indexed for semantic search and returned with their tools when loaded.
 *
 * When an agent loads an instruction via get(), they receive:
 * - content: The workflow guidance
 * - tools: Array of tools now available to the agent
 *
 * Benefits over markdown prompts:
 * - Type-safe: Compiler catches wrong tool references
 * - Co-located: Instruction lives with its domain
 * - Refactorable: Rename a tool, references update
 * - No parsing: No YAML frontmatter at runtime
 */
export interface Instruction {
    /** Route URI (e.g., "data-warehouse://instructions/query-builder") */
    route: string;

    /** Always 'instruction' */
    type: 'instruction';

    /** Human-readable name for display */
    name: string;

    /**
     * Description for semantic search
     *
     * This is indexed and used for discovery. Write a keyword-dense description
     * that helps agents find this instruction when they need it.
     */
    description: string;

    /**
     * Tools this instruction unlocks
     *
     * When the instruction is loaded, these tools are returned to the agent.
     * Reference the actual Route objects, not string routes.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: Route<any, any>[];

    /**
     * The instruction content (markdown)
     *
     * This is the actual guidance shown to the agent.
     * Use template literals for multi-line content.
     */
    content: string;
}

/**
 * Convert an Instruction to a Route
 *
 * Creates an executable route that returns the instruction content
 * along with its unlocked tools (as JSON schemas for the agent).
 */
export function instructionToRoute(instruction: Instruction): Route {
    return {
        route: instruction.route,
        type: 'instruction',
        description: instruction.description,
        freshness: 'unknown',
        unlocks: instruction.tools.map((t) => t.route),
        inputSchema: undefined,
        outputSchema: z.object({
            content: z.string(),
            tools: z.array(
                z.object({
                    route: z.string(),
                    name: z.string().optional(),
                    description: z.string(),
                    inputSchema: z.unknown().optional(),
                }),
            ),
        }),
        async execute() {
            return {
                content: instruction.content,
                tools: instruction.tools.map((t) => ({
                    route: t.route,
                    name: t.route.split('://')[1]?.split('/').pop() || t.route,
                    description: t.description,
                    inputSchema: t.inputSchema ? zodToJsonSchema(t.inputSchema) : undefined,
                })),
            };
        },
    };
}

/**
 * Convert Zod schema to JSON Schema (simplified)
 *
 * Used to serialize input schemas for tools returned with instructions.
 */
function zodToJsonSchema(schema: z.ZodSchema): unknown {
    // Use zod's built-in JSON schema generation if available
    // Otherwise return a basic representation
    try {
        // Access internal Zod structure (fragile but necessary)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const def = (schema as any)._def;
        if (def?.typeName === 'ZodObject') {
            const shape = typeof def.shape === 'function' ? def.shape() : def.shape || {};
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const [key, value] of Object.entries(shape)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const fieldDef = (value as any)?._def;
                properties[key] = {
                    type: getZodTypeName(fieldDef?.typeName),
                    description: fieldDef?.description,
                };
                if (fieldDef?.typeName !== 'ZodOptional') {
                    required.push(key);
                }
            }

            return {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
            };
        }
        return { type: 'unknown' };
    } catch {
        return { type: 'unknown' };
    }
}

/**
 * Map Zod type names to JSON Schema types
 */
function getZodTypeName(typeName: string | undefined): string {
    const mapping: Record<string, string> = {
        ZodString: 'string',
        ZodNumber: 'number',
        ZodBoolean: 'boolean',
        ZodArray: 'array',
        ZodObject: 'object',
        ZodOptional: 'string', // Unwrap optional
        ZodNullable: 'string',
        ZodEnum: 'string',
        ZodDefault: 'string',
    };
    return mapping[typeName || ''] || 'unknown';
}

/**
 * Unified Route Interface
 *
 * Everything is a route. The type tells the purpose.
 * The description tells what it does. The freshness tells when data is from.
 */
export interface Route<TInput = unknown, TOutput = unknown> {
    /** URI-like route (e.g., "data-warehouse://query") */
    route: string;

    /**
     * Route type classification (REQUIRED)
     *
     * - 'instruction' - Workflow guidance that unlocks tools
     * - 'tool' - Operations requiring parameters (hidden from search)
     * - 'resource' - Extracted knowledge without parameters
     * - 'template' - Pre-built operations returning MarkdownUI
     */
    type: RouteType;

    /**
     * Description for search and discovery
     *
     * Tell the complete story - what happens when executed, what data is returned.
     * Examples:
     * - "Execute SQL query on data warehouse with 30s timeout, return result rows"
     * - "Transcript of Product Sync meeting from 2025-01-15"
     * - "Test cases from project - includes authentication, payment flows, and edge cases"
     */
    description: string;

    /**
     * Data freshness indicator
     *
     * - 'live' - Data fetched in real-time (queries, API calls, live operations)
     * - 'unknown' - Freshness cannot be determined
     * - ISO timestamp - When cached content was last updated (e.g., "2025-01-15T10:30:00Z")
     *
     * Helps agents choose between fresh live data vs cached historical content.
     */
    freshness: Freshness;

    /** Input parameter schema (optional - only for 'tool' type) */
    inputSchema?: z.ZodSchema<TInput>;

    /** Output schema */
    outputSchema: z.ZodSchema<TOutput>;

    /** Execution function */
    execute: (params: TInput, ctx: RouteContext) => Promise<TOutput>;

    /** Required scopes (optional) */
    requiredScopes?: string[];

    /**
     * Tool routes this instruction unlocks (optional)
     *
     * For instruction routes only. Lists tool routes that become available
     * when this instruction is loaded. Tools listed here are hidden from
     * ask() results and only revealed when the instruction is loaded via get().
     *
     * Example: ['qa://next-unreviewed', 'qa://update-test', 'qa://mark-reviewed']
     */
    unlocks?: string[];

    /**
     * Semantic resource type (optional)
     *
     * For resource routes, preserves the original type from the source
     * (e.g., 'column', 'table', 'page', 'doc'). Used for semantic filtering
     * in search segments.
     */
    resourceType?: string;

    /**
     * Source identifier (optional)
     *
     * Identifies which content pipeline/extractor produced this route.
     * Used for per-source freshness tracking in Typesense.
     * Format: "{source_name}__{base_path}" (e.g., "clickup__marketing")
     */
    sourceId?: string;

    /**
     * Output formatter (optional)
     *
     * Transform route output into a more token-efficient or user-friendly format.
     * - 'toon' - TOON format (30-40% token reduction for tabular data)
     * - 'json' - Standard JSON (default if not specified)
     * - 'csv' - CSV format for spreadsheet-like data
     * - 'markdown' - Markdown table format
     * - Custom function - Provide your own formatter
     *
     * Example: outputFormatter: 'toon' for database queries
     */
    outputFormatter?: OutputFormatter;

    /**
     * Human-readable name (optional)
     *
     * For instructions and templates, provides a display name.
     */
    name?: string;

    /**
     * Inline content (optional)
     *
     * For instructions, contains the workflow guidance markdown.
     * For resources, contains the extracted content.
     */
    content?: string;
}

/**
 * Route execution result
 */
export interface RouteResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}

/**
 * Search segment configuration
 *
 * Allows domains to organize search results by resource categories
 * (e.g., aggregates vs facts, docs vs tests). Each segment runs as
 * a separate filtered search pass with its own limit and priority.
 */
export interface SearchSegment {
    /** Segment name (displayed in results, e.g., "aggregates", "facts") */
    name: string;

    /**
     * Typesense filter expression for this segment
     *
     * Examples:
     * - 'resource_type:=column' - Match by semantic type
     * - 'uri:data-warehouse://aggregates*' - Match by URI prefix
     * - 'resource_type:=table && uri:data-warehouse://facts*' - Combined filter
     */
    filter: string;

    /** Maximum results for this segment */
    limit: number;

    /** Optional description explaining when to use this segment */
    description?: string;

    /** Search priority (1 = highest). Segments searched in priority order. */
    priority: number;
}

/**
 * Domain-specific search configuration
 *
 * Each domain can define how its content should be ranked in search.
 * All searches use semantic mode (meaning-based) for best discovery.
 * If not provided, sensible defaults are used.
 */
export interface DomainSearchConfig {
    /**
     * Fields to search, in order
     * Default: 'content,name,description'
     */
    queryBy?: string;

    /**
     * Weights for each field in queryBy
     * Example: '4,2,1' means first field weighted 4x, second 2x, third 1x
     * Default: '4,2,1' (content-first for semantic search)
     */
    weights?: string;

    /**
     * Optional search segments for organizing results by category
     * When provided, ask() groups results by segment instead of flat list.
     * Each segment = separate filtered search with its own limit and priority.
     */
    segments?: SearchSegment[];
}
