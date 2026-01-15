import type { Ernesto } from './Ernesto';
import type { RouteContext } from './route';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildInstructionContext } from './instructions/context';
import { createAskTool } from './tools/ask';
import { createGetTool } from './tools/get';

export async function attachErnestoTools(ernesto: Ernesto, server: McpServer, context: RouteContext): Promise<void> {
    context.ernesto = ernesto;

    // Build instruction context
    const instructionContext = await buildInstructionContext(ernesto);

    // Create tools with rendered descriptions
    const searchTool = createAskTool(context, ernesto.instructionRegistry.renderAskTool(instructionContext));
    const getTool = createGetTool(context, ernesto.instructionRegistry.renderGetTool(instructionContext));

    server.registerTool(
        searchTool.name,
        {
            description: searchTool.description,
            inputSchema: searchTool.inputSchema,
        },
        searchTool.handler,
    );

    server.registerTool(
        getTool.name,
        {
            description: getTool.description,
            inputSchema: getTool.inputSchema,
        },
        getTool.handler,
    );

    // Store rendered instructions on server for later access (used by HTTP server)
    const instructions = ernesto.instructionRegistry.render(instructionContext);
    (server as any).__ernestoInstructions = instructions;
}
