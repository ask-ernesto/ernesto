/**
 * Ernesto Router
 * Routes execute() calls to appropriate routes based on URI.
 */

import { Route, RouteContext, RouteResult } from './route';
import debug from 'debug';
import { getDocumentByUri } from './typesense/client';
import { formatZodSchemaForAgent } from './schema-formatter';
import { buildGuidanceSection, RouteInfo } from './guidance';

const log = debug('router');

const MAX_CALL_DEPTH = 10;

function summarizeValidationErrors(errors: any[]): any {
    const errorsByPath = new Map<string, any[]>();

    for (const error of errors) {
        const path = error.path.join('.') || 'root';
        if (!errorsByPath.has(path)) {
            errorsByPath.set(path, []);
        }
        errorsByPath.get(path)!.push(error);
    }

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

    return errors;
}

/**
 * Route registry - maps URIs to route implementations
 */
export class RouteRegistry {
    private routes = new Map<string, Route>();

    register(route: Route): void {
        this.routes.set(route.route, route);
    }

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

    get(route: string): Route | undefined {
        return this.routes.get(route);
    }

    getAll(): Route[] {
        return Array.from(this.routes.values());
    }

    clear(): void {
        const count = this.routes.size;
        this.routes.clear();
        log('Cleared all routes', { count });
    }

    getVisible(ctx: RouteContext): Route[] {
        return this.getAll().filter((route) => this.hasPermission(route, ctx.scopes));
    }

    hasPermission(route: Route, scopes?: string[]): boolean {
        if (!route.requiredScopes || route.requiredScopes.length === 0) {
            return true;
        }
        const userScopes = scopes || [];
        return route.requiredScopes.every((s) => userScopes.includes(s));
    }
}

/**
 * Fetch resource directly from Typesense (for indexed content)
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
            data: doc.content,
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

function createRouteLookup(ctx: RouteContext): (route: string) => RouteInfo | undefined {
    return (uri: string) => {
        const routeDef = ctx.ernesto.routeRegistry.get(uri);
        if (!routeDef) {
            return undefined;
        }

        if (!ctx.ernesto.routeRegistry.hasPermission(routeDef, ctx.scopes)) {
            return undefined;
        }

        const parameters = formatZodSchemaForAgent(routeDef.inputSchema, 'Parameters');

        return {
            route: routeDef.route,
            description: routeDef.description,
            inputSchema: parameters || undefined,
            freshness: routeDef.freshness,
        };
    };
}

/**
 * Execute a route
 */
export async function routeExecution(route: string, params: unknown, ctx: RouteContext): Promise<RouteResult> {
    try {
        const callStack = ctx.callStack || [];

        // Cycle detection
        if (callStack.includes(route)) {
            log('Cycle detected', { route, callStack });
            return {
                success: false,
                error: { code: 'CYCLE_DETECTED', message: `Cyclic call to ${route}` },
            };
        }

        // Depth limit
        if (callStack.length >= MAX_CALL_DEPTH) {
            log('Max depth exceeded', { route, depth: callStack.length });
            return {
                success: false,
                error: { code: 'MAX_DEPTH_EXCEEDED', message: `Call depth limit (${MAX_CALL_DEPTH}) reached` },
            };
        }

        // Find route in registry
        const routeDef = ctx.ernesto.routeRegistry.get(route);
        if (!routeDef) {
            return fetchFromTypesense(route, ctx);
        }

        // Permission check
        if (!ctx.ernesto.routeRegistry.hasPermission(routeDef, ctx.scopes)) {
            return {
                success: false,
                error: { code: 'PERMISSION_DENIED', message: `Missing required permissions: ${routeDef.requiredScopes?.join(', ')}` },
            };
        }

        // Input validation
        if (routeDef.inputSchema) {
            const validated = routeDef.inputSchema.safeParse(params);
            if (!validated.success) {
                log('Input validation failed', { route, errors: validated.error.issues });
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

        const childCtx: RouteContext = {
            ...ctx,
            callStack: [...callStack, route],
        };

        log('Executing route', { route, ctx: ctx.requestId, depth: callStack.length });
        const startTime = Date.now();

        // Execute route
        const { content, guidance } = await routeDef.execute(params, childCtx);

        const duration = Date.now() - startTime;
        log('Route executed', { route, duration });

        // Append markdown guidance for human readability
        let finalContent = content;
        if (guidance.length > 0) {
            const routeLookup = createRouteLookup(ctx);
            const guidanceSection = buildGuidanceSection(guidance, routeLookup);
            if (guidanceSection) {
                finalContent = `${content}\n\n${guidanceSection}`;
            }
        }

        // Return both data (with markdown) AND structured guidance as separate fields
        return {
            success: true,
            data: finalContent,
            guidance: guidance.length > 0 ? guidance : undefined,
        };
    } catch (error: any) {
        log('Unexpected error in route execution', { route, error });
        return {
            success: false,
            error: {
                code: 'UNEXPECTED_ERROR',
                message: error.message || 'Unexpected error in route execution',
                details: error.stack,
            },
        };
    }
}
