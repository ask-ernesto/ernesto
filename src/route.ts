/**
 * Route System - Types + Builders
 *
 * Core primitives for the route system.
 * Philosophy: One pattern - every route has execute() returning GuidedContent.
 *
 * Three levels of abstraction:
 * 1. contentOnly(string) - for routes without guidance
 * 2. Raw Route - full control, return { content, guidance }
 * 3. createRoute() + defineGuidance() - declarative conditional guidance
 *
 * @example
 * ```typescript
 * // ═══════════════════════════════════════════════════════════════════════════
 * // SCHEMA
 * // ═══════════════════════════════════════════════════════════════════════════
 *
 * const inputSchema = z.object({ user_id: z.string() });
 * type Input = z.infer<typeof inputSchema>;
 *
 * interface Result {
 *     lifetimeSpend: number;
 *     structuringCount: number;
 * }
 *
 * // ═══════════════════════════════════════════════════════════════════════════
 * // GUIDANCE
 * // ═══════════════════════════════════════════════════════════════════════════
 *
 * const guidance = defineGuidance<Input, Result>({
 *     logs: {
 *         always: true,
 *         route: 'app-logs://tools/user-activity',
 *         prose: (i) => `See logs for \`${i.user_id}\``,
 *     },
 *     highValue: {
 *         when: (r) => r.lifetimeSpend > 5000,
 *         route: 'redshift://tools/fincrime',
 *         prose: (i, r) => `**€${r.lifetimeSpend}!** Check anomalies`,
 *     },
 * });
 *
 * // ═══════════════════════════════════════════════════════════════════════════
 * // ROUTE
 * // ═══════════════════════════════════════════════════════════════════════════
 *
 * export const myRoute = createRoute({
 *     route: 'domain://tools/my-route',
 *     searchable: true,
 *     freshness: 'live',
 *     description: 'My route description',
 *     inputSchema,
 *     guidance,
 *     async execute(params, ctx) {
 *         const data = await query(params);
 *         return {
 *             content: format(data),
 *             result: { lifetimeSpend: data.spend, structuringCount: data.patterns },
 *         };
 *     },
 * });
 * ```
 */

import { z } from 'zod';
// eslint-disable-next-line import/no-cycle -- Type-only import, no runtime cycle
import type { Ernesto } from './Ernesto';

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execution context passed to routes
 */
export interface RouteContext {
    user?: { id: string; email?: string };
    scopes?: string[];
    requestId?: string;
    timestamp: number;
    ernesto: Ernesto;
    callStack?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A guidance suggestion - route URI with contextual prose
 */
export interface RouteGuidance {
    route: string;
    prose: string;
    params?: Record<string, any>;
}

/**
 * Route execution output - content with guidance
 */
export interface GuidedContent {
    content: string;
    guidance: RouteGuidance[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Data freshness indicator
 */
export type Freshness = 'live' | 'static' | 'unknown';

/**
 * The Route primitive
 *
 * One pattern: every route has execute() returning GuidedContent.
 * Use contentOnly() helper for routes without guidance.
 * Use createRoute() + defineGuidance() for declarative conditional guidance.
 */
export interface Route<TInput = unknown> {
    /** URI identifier: domain://path */
    route: string;

    /** Full description for search - tell the complete story */
    description: string;

    /** Visibility: true = searchable, false = hidden */
    searchable: boolean;

    /** Execute function - returns content + guidance */
    execute: (params: TInput, ctx: RouteContext) => Promise<GuidedContent>;

    // ─── Optional ──────────────────────────────────────────────────────────

    /** Human-readable name */
    name?: string;

    /** Data freshness */
    freshness?: Freshness;

    /** Zod input schema */
    inputSchema?: z.ZodSchema<TInput>;

    /** Required permission scopes */
    requiredScopes?: string[];

    /** Semantic resource type (for extracted resources) */
    resourceType?: string;

    /** Source identifier (for content pipelines) */
    sourceId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION RESULT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Route execution result from router
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

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH CONFIG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search segment for organizing results by category
 */
export interface SearchSegment {
    name: string;
    filter: string;
    limit: number;
    description?: string;
    priority: number;
}

/**
 * Domain-specific search configuration
 */
export interface DomainSearchConfig {
    queryBy?: string;
    weights?: string;
    segments?: SearchSegment[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrap content in GuidedContent with empty guidance.
 * Use for routes that don't provide guidance.
 *
 * @example
 * ```typescript
 * export const myRoute: Route<Input> = {
 *     route: 'domain://tools/query',
 *     description: '...',
 *     searchable: false,
 *     execute: async (params, ctx) => contentOnly(await runQuery(params)),
 * };
 * ```
 */
export function contentOnly(content: string): GuidedContent {
    return { content, guidance: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A guidance rule - either always included or conditionally included.
 *
 * @template I - Input params type
 * @template R - Result type from execute()
 */
export type GuidanceRule<I, R> = {
    route: string;
    prose: string | ((input: I, result: R) => string);
} & ({ always: true } | { when: (result: R) => boolean });

/**
 * Record of named guidance rules
 */
export type GuidanceRules<I, R> = Record<string, GuidanceRule<I, R>>;

/**
 * Compiled guidance schema
 */
export interface GuidanceSchema<I, R> {
    resolve(input: I, result: R): RouteGuidance[];
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Define guidance rules for a route.
 *
 * Each rule must specify either `always: true` or `when: fn`.
 * Rules are evaluated in definition order.
 */
export function defineGuidance<I, R>(rules: GuidanceRules<I, R>): GuidanceSchema<I, R> {
    return {
        resolve(input: I, result: R): RouteGuidance[] {
            const output: RouteGuidance[] = [];

            for (const rule of Object.values(rules)) {
                const include = 'always' in rule || rule.when(result);

                if (include) {
                    output.push({
                        route: rule.route,
                        prose: typeof rule.prose === 'function' ? rule.prose(input, result) : rule.prose,
                    });
                }
            }

            return output;
        },
    };
}

/**
 * Empty guidance - for routes that use createRoute but have no guidance rules
 */
export const noGuidance: GuidanceSchema<unknown, unknown> = {
    resolve: () => [],
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration for createRoute()
 */
export interface RouteConfig<I, R> {
    route: string;
    description: string;
    searchable: boolean;
    inputSchema: z.ZodSchema<I>;
    guidance: GuidanceSchema<I, R>;
    execute: (params: I, ctx: RouteContext) => Promise<{ content: string; result: R }>;
    name?: string;
    freshness?: Freshness;
    requiredScopes?: string[];
}

/**
 * Create a route with declarative guidance.
 *
 * Execute returns { content, result }. Guidance is resolved from result.
 */
export function createRoute<I, R>(config: RouteConfig<I, R>): Route<I> {
    return {
        route: config.route,
        name: config.name,
        searchable: config.searchable,
        freshness: config.freshness,
        description: config.description,
        inputSchema: config.inputSchema,
        requiredScopes: config.requiredScopes,

        async execute(params: I, ctx: RouteContext): Promise<GuidedContent> {
            const { content, result } = await config.execute(params, ctx);
            return {
                content,
                guidance: config.guidance.resolve(params, result),
            };
        },
    };
}
