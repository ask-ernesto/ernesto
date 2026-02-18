/**
 * MCP Tool: run
 *
 * Execute skill tools by "skill:tool" identifier.
 *
 * Supported formats:
 * - "skill:tool" → execute specific tool
 * - "skill" (no colon) → return skill instruction
 */

import { z } from 'zod';
import { ToolContext, ToolResult } from '../skill';
import { formatZodSchemaForAgent } from '../schema-formatter';
import { getDocumentByUri } from '../typesense/client';
import debug from 'debug';

const log = debug('run');

const inputSchema = z.object({
    routes: z
        .array(
            z.object({
                route: z.string().describe('Tool identifier — format: "skill:tool"'),
                params: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe("Parameters for the tool (optional)"),
            }),
        )
        .min(1)
        .describe('Array of tools to execute. Executed in parallel when possible.'),
});

export function createRunTool(context: ToolContext, description: string) {
    return {
        name: 'get',  // Keep 'get' as tool name for backward compat with agents
        description,
        inputSchema,
        handler: async ({ routes }: any, _extra: any) => {
            log('run called', {
                toolCount: routes.length,
                tools: routes.map((r: { route: string }) => r.route),
                userId: context.user?.id,
                requestId: context.requestId,
            });

            const results = await Promise.all(
                routes.map(async ({ route, params = {} }: { route: string; params?: Record<string, unknown> }) => {
                    try {
                        const result = await resolveAndExecute(route, params, context);
                        return {
                            route,
                            success: true,
                            data: result.content,
                            ...(result.structured !== undefined && { structured: result.structured }),
                            ...(result.suggestions?.length && { suggestions: result.suggestions }),
                        };
                    } catch (error) {
                        log('Tool execution failed', { route, error });
                        return {
                            route,
                            success: false,
                            error: {
                                code: 'EXECUTION_ERROR',
                                message: error instanceof Error ? error.message : 'Unknown error',
                            },
                        };
                    }
                }),
            );

            const successCount = results.filter((r: any) => r.success).length;
            const failureCount = results.length - successCount;

            log('run complete', { total: routes.length, successCount, failureCount });

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
                ],
            };
        },
    };
}

async function resolveAndExecute(
    identifier: string,
    params: Record<string, unknown>,
    ctx: ToolContext,
): Promise<ToolResult> {
    // Resource URI format: domain://resources/path — fetch from Typesense
    if (identifier.includes('://resources/')) {
        return fetchResource(identifier, ctx);
    }

    const colonIdx = identifier.indexOf(':');

    // No colon → skill name only → return instruction
    if (colonIdx === -1) {
        return getSkillInstruction(identifier, ctx);
    }

    // skill:tool → resolve and execute
    const skillName = identifier.substring(0, colonIdx);
    const toolName = identifier.substring(colonIdx + 1);

    return executeSkillTool(skillName, toolName, params, ctx);
}

async function executeSkillTool(
    skillName: string,
    toolName: string,
    params: Record<string, unknown>,
    ctx: ToolContext,
): Promise<ToolResult> {
    const toolRef = ctx.ernesto.skillRegistry.resolveTool(`${skillName}:${toolName}`);
    if (!toolRef) {
        return {
            content: `Tool not found: ${skillName}:${toolName}`,
        };
    }

    // Permission check
    const skill = ctx.ernesto.skillRegistry.get(skillName);
    const requiredScopes = [
        ...(skill?.requiredScopes || []),
        ...(toolRef.tool.requiredScopes || []),
    ];

    if (requiredScopes.length > 0) {
        const userScopes = ctx.scopes || [];
        const missing = requiredScopes.filter((s) => !userScopes.includes(s));
        if (missing.length > 0) {
            return {
                content: `Permission denied: missing scopes ${missing.join(', ')}`,
            };
        }
    }

    // Input validation
    if (toolRef.tool.inputSchema) {
        const validated = toolRef.tool.inputSchema.safeParse(params);
        if (!validated.success) {
            return {
                content: `Input validation failed: ${JSON.stringify(validated.error.issues)}`,
            };
        }
        params = validated.data as Record<string, unknown>;
    }

    return toolRef.tool.execute(params, ctx);
}

async function getSkillInstruction(skillName: string, ctx: ToolContext): Promise<ToolResult> {
    const skill = ctx.ernesto.skillRegistry.get(skillName);
    if (!skill) {
        return { content: `Skill not found: ${skillName}` };
    }

    const instruction = typeof skill.instruction === 'function'
        ? await skill.instruction({ user: ctx.user, scopes: ctx.scopes, ernesto: ctx.ernesto })
        : skill.instruction;

    const toolListing = skill.tools.map((t) => {
        const params = t.inputSchema ? formatZodSchemaForAgent(t.inputSchema) : undefined;
        return `- **${skill.name}:${t.name}**: ${t.description}${params ? `\n  *${params}*` : ''}`;
    }).join('\n');

    const content = toolListing
        ? `${instruction}\n\n## Tools\n\n${toolListing}`
        : instruction;

    return { content };
}

async function fetchResource(uri: string, ctx: ToolContext): Promise<ToolResult> {
    const doc = await getDocumentByUri(ctx.ernesto, uri);
    if (!doc) {
        return { content: `Resource not found: ${uri}` };
    }
    return { content: doc.content };
}
