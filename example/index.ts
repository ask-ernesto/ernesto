import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from 'typesense';
import { Ernesto } from '../src/Ernesto';
import { InstructionRegistry } from 'instructions/registry';

const ernesto = new Ernesto({
    domains: [],
    instructionRegistry: new InstructionRegistry({
        instructions: (context) => `You are an assistant that can help with tasks.`,
        askTool: (context) => `You can ask me questions.`,
        getTool: (context) => `You can get me information.`,
    }),
    typesense: new Client({
        nodes: [
            {
                host: 'localhost',
                port: 8108,
                protocol: 'http',
            },
        ],
        apiKey: process.env.TYPESENSE_API_KEY!,
    }),
});

const app = express();

app.use(express.json());

app.post('/mcp', async (req, res) => {
    const server = new McpServer({
        name: 'ernesto-example',
        version: '0.0.1',
    });

    ernesto.attachToMcpServer(server, {
        user: {
            id: '123',
        },
        scopes: ['public'],
        requestId: '123',
        ernesto,
        timestamp: Date.now(),
    });

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
    });

    res.on('close', async () => {
        await transport.close();
    });

    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);
});

app.listen(6969, () => {
    console.log('MCP server is running on http://localhost:6969');
});
