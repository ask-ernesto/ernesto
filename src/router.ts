/**
 * Ernesto Internal Router
 * Used to build and make available Domain Routes
 *
 * Routes get()/execute() calls to appropriate routes based on URI.
 */

import { Route, RouteContext, RouteResult } from './types';
import debug from 'debug';
import { applyOutputFormatter } from './utils';
import { getDocumentByUri } from './typesense/client';

const log = debug('ernesto:router');

/**
 * Summarize Zod validation errors for user-friendly output
 */
function summarizeValidationErrors(errors: any[]): any {
    // Group errors by path for better readability
    const errorsByPath = new Map<string, any[]>();

    for (const error of errors) {
        const path = error.path.join('.') || 'root';
        if (!errorsByPath.has(path)) {
            errorsByPath.set(path, []);
        }
        errorsByPath.get(path)!.push(error);
    }

    // If too many unique paths, summarize
    if (errorsByPath.size > 10) {
        const pathCounts = new Map<string, number>();
        for (const error of errors) {
            const rootPath = error.path[0] || 'root';
            pathCounts.set(rootPath, (pathCounts.get(rootPath) || 0) + 1);
        }

        return {
            summary: `Validation failed for ${errorsByPath.size} fields across ${errors.length} errors`,
            error_counts: Object.fromEntries(pathCounts),
            sample_errors: errors.slice(0, 3),
            hint: 'Check route output matches schema. Full errors logged server-side.',
        };
    }

    // Return detailed errors for small counts
    return errors;
}

/**
 * Route registry
 *
 * Maps route URIs to route implementations.
 */
export class RouteRegistry {
    private routes = new Map<string, Route>();

    /**
     * Register a route (silent - no per-route logging)
     *
     * Overwrites existing routes by default.
     */
    register(route: Route): void {
        this.routes.set(route.route, route);
    }

    /**
     * Register multiple routes
     *
     * Logs summary at end, not per-route.
     */
    registerAll(routes: Route[]): void {
        const before = this.routes.size;

        for (const route of routes) {
            this.register(route);
        }
        const added = this.routes.size - before;
        const replaced = routes.length - added;

        log('Batch registered', {
            total: routes.length,
            added,
            replaced,
        });
    }

    /**
     * Get route by URI
     */
    get(route: string): Route | undefined {
        return this.routes.get(route);
    }

    /**
     * Get all registered routes
     */
    getAll(): Route[] {
        return Array.from(this.routes.values());
    }

    /**
     * Clear all registered routes
     *
     * Used during restart to remove stale routes before re-registering.
     */
    clear(): void {
        const count = this.routes.size;
        this.routes.clear();
        log('Cleared all routes', { count });
    }

    /**
     * Get routes filtered by permissions
     */
    getVisible(ctx: RouteContext): Route[] {
        const userPermissions = ctx.scopes || [];

        return this.getAll().filter((route) => {
            // No permission requirement = visible to all
            if (!route.requiredScopes || route.requiredScopes.length === 0) {
                return true;
            }

            // Check if user has all required permissions
            return route.requiredScopes.every((p) => userPermissions.includes(p));
        });
    }
}

/**
 * Fetch resource directly from Typesense
 *
 * Used for resources that don't have registered routes.
 * This bypasses route generation - content is served directly from the index.
 */
async function fetchFromTypesense(route: string, ctx: RouteContext): Promise<RouteResult> {
    try {
        const doc = await getDocumentByUri(ctx.ernesto, route);

        if (!doc) {
            return {
                success: false,
                error: {
                    code: 'ROUTE_NOT_FOUND',
                    message: `Route not found: ${route}`,
                },
            };
        }

        log('Serving from Typesense', {
            route,
            contentSize: doc.content.length,
        });

        return {
            success: true,
            data: {
                uri: route,
                domain: doc.domain,
                name: doc.name,
                type: doc.type,
                content: doc.content,
                content_size: doc.content_size,
                child_count: doc.child_count || 0,
            },
        };
    } catch (error: any) {
        log('Typesense fetch failed', { route, error });
        return {
            success: false,
            error: {
                code: 'FETCH_ERROR',
                message: error.message || 'Failed to fetch from index',
            },
        };
    }
}

/**
 * Execute a route
 *
 * @param route - Route URI (e.g., "data-warehouse://query")
 * @param params - Parameters matching route's input schema
 * @param ctx - Execution context
 * @returns Route result
 */
export async function routeExecution(route: string, params: unknown, ctx: RouteContext): Promise<RouteResult> {
    try {
        // Find route in registry (tools, templates, instructions)
        const routeDef = ctx.ernesto.routeRegistry.get(route);

        // If not in registry, try Typesense (resources)
        if (!routeDef) {
            return fetchFromTypesense(route, ctx);
        }

        // Check permissions
        if (routeDef.requiredScopes && routeDef.requiredScopes.length > 0) {
            const userPermissions = ctx.scopes || [];
            const hasPermissions = routeDef.requiredScopes.every((p) => userPermissions.includes(p));

            if (!hasPermissions) {
                return {
                    success: false,
                    error: {
                        code: 'PERMISSION_DENIED',
                        message: `Missing required permissions: ${routeDef.requiredScopes.join(', ')}`,
                    },
                };
            }
        }

        // Validate input schema (if route has one)
        if (routeDef.inputSchema) {
            const validated = routeDef.inputSchema.safeParse(params);
            if (!validated.success) {
                log('Input validation failed', {
                    route,
                    errors: validated.error.issues,
                });

                return {
                    success: false,
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Input validation failed',
                        details: summarizeValidationErrors(validated.error.issues),
                    },
                };
            }
            params = validated.data;
        }

        // Execute route
        log('Executing route', { route, ctx: ctx.requestId });
        const startTime = Date.now();

        const result = await routeDef.execute(params, ctx);

        const duration = Date.now() - startTime;
        log('Route executed', { route, duration });

        // Validate output schema
        const validatedOutput = routeDef.outputSchema.safeParse(result);
        if (!validatedOutput.success) {
            log('Output validation failed', {
                route,
                errorCount: validatedOutput.error.issues.length,
                errors: validatedOutput.error.issues,
            });

            return {
                success: false,
                error: {
                    code: 'INVALID_OUTPUT',
                    message: 'Route returned invalid output',
                    details: summarizeValidationErrors(validatedOutput.error.issues),
                },
            };
        }

        // Apply output formatter if specified
        let finalData = validatedOutput.data;
        if (routeDef.outputFormatter) {
            try {
                const formatted = applyOutputFormatter(validatedOutput.data, routeDef.outputFormatter);
                log('Applied output formatter', {
                    route,
                    formatter: typeof routeDef.outputFormatter === 'string' ? routeDef.outputFormatter : 'custom',
                });
                finalData = formatted;
            } catch (error) {
                log('Output formatter failed', { route, error });
                // Don't fail the request - fall back to unformatted data
            }
        }

        // For instructions with unlocks, include the unlocked tools in the response
        if (routeDef.type === 'instruction' && routeDef.unlocks && routeDef.unlocks.length > 0) {
            const unlockedTools: Record<string, unknown>[] = [];
            for (const toolRoute of routeDef.unlocks) {
                const toolDef = ctx.ernesto.routeRegistry.get(toolRoute);
                if (toolDef) {
                    // Check permissions for this tool
                    if (toolDef.requiredScopes && toolDef.requiredScopes.length > 0) {
                        const userPermissions = ctx.scopes || [];
                        const hasPermissions = toolDef.requiredScopes.every((p) => userPermissions.includes(p));
                        if (!hasPermissions) continue;
                    }

                    // Format parameters from Zod schema
                    const { formatZodSchemaForAgent } = require('./schema-formatter');
                    const parameters = formatZodSchemaForAgent(toolDef.inputSchema, 'Parameters');

                    unlockedTools.push({
                        route: toolDef.route,
                        description: toolDef.description,
                        freshness: toolDef.freshness,
                        ...(parameters && { parameters }),
                        ...(toolDef.requiredScopes && {
                            permissions: toolDef.requiredScopes,
                        }),
                    });
                }
            }

            if (unlockedTools.length > 0) {
                // Augment the response with unlocked tools
                if (typeof finalData === 'object' && finalData !== null) {
                    finalData = { ...finalData, tools: unlockedTools };
                } else {
                    // For string content (like markdown instructions), wrap in object
                    finalData = { content: finalData, tools: unlockedTools };
                }

                log('Instruction unlocked tools', {
                    route,
                    toolCount: unlockedTools.length,
                });
            }
        }

        return {
            success: true,
            data: finalData,
        };
    } catch (error) {
        log('Route execution failed', { route, error });
        return {
            success: false,
            error: {
                code: 'EXECUTION_ERROR',
                message: error.message || 'Route execution failed',
                details: error.stack,
            },
        };
    }
}
