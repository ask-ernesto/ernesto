import { vi } from 'vitest';

// Mock dependencies
vi.mock('../tools/ask', () => ({
    createAskTool: vi.fn(() => ({
        name: 'ask',
        description: 'Search',
        inputSchema: {},
        handler: vi.fn(),
    })),
}));

vi.mock('../tools/run', () => ({
    createRunTool: vi.fn(() => ({
        name: 'get',
        description: 'Execute',
        inputSchema: {},
        handler: vi.fn(),
    })),
}));

vi.mock('../instructions/context', () => ({
    buildInstructionContext: vi.fn().mockResolvedValue({
        domainCount: 5,
        resourceCount: 100,
        routeCount: 50,
        domains: ['redshift', 'code', 'teams', 'qa', 'blockchain'],
    }),
}));

import { attachErnestoTools } from '../ernesto-tools';
import { createAskTool } from '../tools/ask';
import { createRunTool } from '../tools/run';
import { Ernesto } from '../Ernesto';
import { ToolContext } from '../skill';
import { SkillRegistry } from '../skill-registry';

describe('attachErnestoTools', () => {
    const mockTypesense = {} as any;

    const createMockServer = () => ({
        registerTool: vi.fn(),
    });

    const createContext = (): ToolContext => ({
        user: { id: 'test', email: 'test@example.com' },
        scopes: [],
        requestId: 'req-123',
        timestamp: Date.now(),
        ernesto: null as any,
        callStack: [],
    });

    it('registers ask and get tools on the MCP server', async () => {
        const ernesto = new Ernesto({ typesense: mockTypesense });
        const server = createMockServer();
        const context = createContext();

        await attachErnestoTools(ernesto, server as any, context);

        expect(server.registerTool).toHaveBeenCalledTimes(2);
        // First call registers 'ask'
        expect(server.registerTool.mock.calls[0][0]).toBe('ask');
        // Second call registers 'get'
        expect(server.registerTool.mock.calls[1][0]).toBe('get');
    });

    it('sets ernesto on the context', async () => {
        const ernesto = new Ernesto({ typesense: mockTypesense });
        const server = createMockServer();
        const context = createContext();

        await attachErnestoTools(ernesto, server as any, context);

        expect(context.ernesto).toBe(ernesto);
    });

    it('uses instructionRegistry descriptions when available', async () => {
        const instructionRegistry = {
            renderAskTool: vi.fn().mockReturnValue('Custom ask description'),
            renderGetTool: vi.fn().mockReturnValue('Custom get description'),
        };

        const ernesto = new Ernesto({
            typesense: mockTypesense,
            instructionRegistry: instructionRegistry as any,
        });
        const server = createMockServer();
        const context = createContext();

        await attachErnestoTools(ernesto, server as any, context);

        expect(instructionRegistry.renderAskTool).toHaveBeenCalled();
        expect(instructionRegistry.renderGetTool).toHaveBeenCalled();
    });

    it('falls back to default descriptions without instructionRegistry', async () => {
        const ernesto = new Ernesto({ typesense: mockTypesense });
        const server = createMockServer();
        const context = createContext();

        await attachErnestoTools(ernesto, server as any, context);

        // createAskTool should be called with default description
        expect(vi.mocked(createAskTool)).toHaveBeenCalledWith(
            context,
            expect.stringContaining('Semantic search'),
        );
    });

    it('passes context to createAskTool and createRunTool', async () => {
        const ernesto = new Ernesto({ typesense: mockTypesense });
        const server = createMockServer();
        const context = createContext();

        await attachErnestoTools(ernesto, server as any, context);

        expect(vi.mocked(createAskTool)).toHaveBeenCalledWith(context, expect.any(String));
        expect(vi.mocked(createRunTool)).toHaveBeenCalledWith(context, expect.any(String));
    });

    it('registers tools with description and inputSchema', async () => {
        const ernesto = new Ernesto({ typesense: mockTypesense });
        const server = createMockServer();
        const context = createContext();

        await attachErnestoTools(ernesto, server as any, context);

        // Each registerTool call should have: (name, { description, inputSchema }, handler)
        const askCall = server.registerTool.mock.calls[0];
        expect(askCall[1]).toHaveProperty('description');
        expect(askCall[1]).toHaveProperty('inputSchema');
        expect(typeof askCall[2]).toBe('function');

        const getCall = server.registerTool.mock.calls[1];
        expect(getCall[1]).toHaveProperty('description');
        expect(getCall[1]).toHaveProperty('inputSchema');
        expect(typeof getCall[2]).toBe('function');
    });
});
