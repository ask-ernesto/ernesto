/**
 * System Tool: get
 *
 * Retrieve or execute one or more routes in batch.
 */

import { z } from 'zod';
import { ImageBlock, RouteContext } from '../route';
import { routeExecution } from '../router';
import debug from 'debug';

const log = debug('get');

const inputSchema = z.object({
    routes: z
        .array(
            z.object({
                route: z.string().describe('Route URI - format: domain://path'),
                params: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe("Parameters for the route (optional - informational routes typically don't need params)"),
            }),
        )
        .min(1)
        .describe('Array of routes to execute. Executed in parallel when possible.'),
});

export function createGetTool(context: RouteContext, description: string) {
    return {
        name: 'get',
        description,
        inputSchema,
        handler: async ({ routes }: any, _extra: any) => {
            log('get called', {
                routeCount: routes.length,
                routes: routes.map((r: { route: any }) => r.route),
                userId: context.user?.id,
                requestId: context.requestId,
            });

            // Execute all routes in parallel, collecting results and images separately
            const images: ImageBlock[] = [];
            const results = await Promise.all(
                routes.map(async ({ route, params = {} }) => {
                    try {
                        const result = await routeExecution(route, params, context);

                        if (!result.success) {
                            log('Route execution failed', {
                                route,
                                error: result.error as any,
                            });
                        }

                        if (result.images) {
                            images.push(...result.images);
                        }

                        return {
                            route,
                            success: result.success,
                            data: result.data,
                            error: result.error,
                        };
                    } catch (error) {
                        log('Route execution threw error', {
                            route,
                            error,
                        });

                        return {
                            route,
                            success: false,
                            error: {
                                code: 'EXECUTION_ERROR',
                                message: error instanceof Error ? error.message : 'Unknown error',
                                details: error,
                            },
                        };
                    }
                }),
            );

            const successCount = results.filter((r) => r.success).length;
            const failureCount = results.length - successCount;

            log('get complete', {
                totalRoutes: routes.length,
                successCount,
                failureCount,
            });

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                results,
                                summary: {
                                    total: routes.length,
                                    success: successCount,
                                    failed: failureCount,
                                },
                            },
                            null,
                            2,
                        ),
                    },
                    ...images.map((img) => ({
                        type: 'image' as const,
                        data: img.data,
                        mimeType: img.mimeType,
                    })),
                ],
            };
        },
    };
}
