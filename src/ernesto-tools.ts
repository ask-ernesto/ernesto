import type { Ernesto } from './Ernesto';
import type { ToolContext } from './skill';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildInstructionContext } from './instructions/context';
import { createAskTool } from './tools/ask';
import { createRunTool } from './tools/run';

function defaultAskDescription(ctx: { domainCount: number; resourceCount: number; routeCount: number; domains: string[] }): string {
    return `Semantic search across ${ctx.domainCount} domains to discover available operations and knowledge.\n\nAvailable domains: ${ctx.domains.join(', ')}\n\nIndex size: ${ctx.resourceCount} resources, ${ctx.routeCount} routes`;
}

function defaultGetDescription(ctx: { routeCount: number }): string {
    return `Execute one or more routes in batch. Supports parallel execution.\n\n${ctx.routeCount} routes available.`;
}

export async function attachErnestoTools(ernesto: Ernesto, server: McpServer, context: ToolContext): Promise<void> {
    context.ernesto = ernesto;

    const instructionContext = await buildInstructionContext(ernesto);

    const askDescription = ernesto.instructionRegistry
        ? ernesto.instructionRegistry.renderAskTool(instructionContext)
        : defaultAskDescription(instructionContext);

    const getDescription = ernesto.instructionRegistry
        ? ernesto.instructionRegistry.renderGetTool(instructionContext)
        : defaultGetDescription(instructionContext);

    const searchTool = createAskTool(context, askDescription);
    const runTool = createRunTool(context, getDescription);

    server.registerTool(
        searchTool.name,
        {
            description: searchTool.description,
            inputSchema: searchTool.inputSchema,
        },
        searchTool.handler,
    );

    server.registerTool(
        runTool.name,
        {
            description: runTool.description,
            inputSchema: runTool.inputSchema,
        },
        runTool.handler,
    );
}
