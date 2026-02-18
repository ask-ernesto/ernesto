import { vi } from 'vitest';

// Mock the search module
vi.mock('../typesense/search', () => ({
    searchResources: vi.fn(),
}));

import { createAskTool } from '../tools/ask';
import { searchResources } from '../typesense/search';
import { Ernesto } from '../Ernesto';
import { ToolContext } from '../skill';
import { createTestSkill, createTestTool } from './helpers';

const mockSearchResources = vi.mocked(searchResources);

describe('createAskTool', () => {
    const mockTypesense = {} as any;

    const createErnesto = (skills: any[] = []) =>
        new Ernesto({ skills, typesense: mockTypesense });

    const createContext = (ernesto: Ernesto, overrides: Partial<ToolContext> = {}): ToolContext => ({
        user: { id: 'test-user', email: 'test@example.com' },
        scopes: ['read', 'write'],
        requestId: 'test-req-123',
        timestamp: Date.now(),
        ernesto,
        callStack: [],
        ...overrides,
    });

    beforeEach(() => {
        mockSearchResources.mockReset();
        mockSearchResources.mockResolvedValue([]);
    });

    it('returns tool with name "ask"', () => {
        const ernesto = createErnesto();
        const ctx = createContext(ernesto);
        const tool = createAskTool(ctx, 'Test description');
        expect(tool.name).toBe('ask');
    });

    it('uses provided description', () => {
        const ernesto = createErnesto();
        const ctx = createContext(ernesto);
        const tool = createAskTool(ctx, 'Custom search description');
        expect(tool.description).toBe('Custom search description');
    });

    it('returns "No matching routes found" when no skills registered', async () => {
        const ernesto = createErnesto();
        const ctx = createContext(ernesto);
        const tool = createAskTool(ctx, 'desc');
        const result = await tool.handler({ query: 'test', perDomain: 10 }, {});
        expect(result.content[0].text).toContain('No matching routes found');
    });

    it('includes skill tool listings in results', async () => {
        const tool1 = createTestTool({ name: 'analyst', description: 'Run SQL queries' });
        const skill = createTestSkill({ name: 'redshift', description: 'Data warehouse', tools: [tool1] });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'revenue data', perDomain: 10 }, {});
        const text = result.content[0].text;

        expect(text).toContain('redshift');
        expect(text).toContain('Data warehouse');
    });

    it('includes resource results from Typesense search', async () => {
        const skill = createTestSkill({ name: 'code', description: 'Code search', tools: [] });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto);

        mockSearchResources.mockResolvedValue([
            { uri: 'code://resources/prs/123', description: 'Fix auth bug', segment: 'resources' },
        ]);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'auth bug', perDomain: 10 }, {});
        const text = result.content[0].text;

        expect(text).toContain('code://resources/prs/123');
        expect(text).toContain('Fix auth bug');
    });

    it('filters by domain when domain parameter provided', async () => {
        const skill1 = createTestSkill({ name: 'redshift', description: 'Data', tools: [] });
        const skill2 = createTestSkill({ name: 'code', description: 'Code', tools: [] });
        const ernesto = createErnesto([skill1, skill2]);
        const ctx = createContext(ernesto);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'test', domain: 'redshift', perDomain: 10 }, {});
        const text = result.content[0].text;

        expect(text).toContain('redshift');
        expect(text).not.toContain('## code');
    });

    it('respects perDomain limit on resources', async () => {
        const skill = createTestSkill({ name: 'code', description: 'Code', tools: [] });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto);

        mockSearchResources.mockResolvedValue([
            { uri: 'code://r/1', description: 'Result 1', segment: 'resources' },
            { uri: 'code://r/2', description: 'Result 2', segment: 'resources' },
            { uri: 'code://r/3', description: 'Result 3', segment: 'resources' },
        ]);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'test', perDomain: 2 }, {});
        const text = result.content[0].text;

        // Should limit resources to 2 (perDomain) but still include the skill route
        expect(text).toContain('code://r/1');
        expect(text).toContain('code://r/2');
        // The third resource should be trimmed
        expect(text).not.toContain('code://r/3');
    });

    it('skips skills where user lacks required scopes', async () => {
        const skill = createTestSkill({
            name: 'admin-skill',
            description: 'Admin only',
            requiredScopes: ['admin'],
            tools: [],
        });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto, { scopes: ['read'] });

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'test', perDomain: 10 }, {});
        const text = result.content[0].text;

        expect(text).toContain('No matching routes found');
    });

    it('includes skills when user has all required scopes', async () => {
        const skill = createTestSkill({
            name: 'admin-skill',
            description: 'Admin only',
            requiredScopes: ['admin'],
            tools: [],
        });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto, { scopes: ['admin', 'read'] });

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'test', perDomain: 10 }, {});
        const text = result.content[0].text;

        expect(text).toContain('admin-skill');
    });

    it('passes searchConfig to searchResources', async () => {
        const skill = createTestSkill({
            name: 'custom',
            description: 'Custom search',
            tools: [],
            searchConfig: {
                segments: [{ name: 'docs', filter: 'type:=doc', limit: 5, description: 'Docs', priority: 1 }],
                queryBy: 'title,content',
                weights: '3,1',
            },
        });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto);

        const askTool = createAskTool(ctx, 'desc');
        await askTool.handler({ query: 'test', perDomain: 10 }, {});

        expect(mockSearchResources).toHaveBeenCalledWith(
            ernesto,
            expect.objectContaining({
                query: 'test',
                domain: 'custom',
                segments: skill.searchConfig!.segments,
                queryBy: 'title,content',
                weights: '3,1',
            }),
        );
    });

    it('shows "more_available" count when results exceed perDomain', async () => {
        const skill = createTestSkill({ name: 'code', description: 'Code', tools: [] });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto);

        const manyResults = Array.from({ length: 5 }, (_, i) => ({
            uri: `code://r/${i}`,
            description: `Result ${i}`,
            segment: 'resources',
        }));
        mockSearchResources.mockResolvedValue(manyResults);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'test', perDomain: 2 }, {});
        const text = result.content[0].text;

        expect(text).toContain('more available');
    });

    it('returns results for all skills even when one has no resources', async () => {
        const skill1 = createTestSkill({ name: 'redshift', description: 'Data warehouse', tools: [] });
        const skill2 = createTestSkill({ name: 'code', description: 'Code search', tools: [] });
        const ernesto = createErnesto([skill1, skill2]);
        const ctx = createContext(ernesto);

        // Both return empty resources but skills should still appear
        mockSearchResources.mockResolvedValue([]);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'test', perDomain: 10 }, {});
        const text = result.content[0].text;

        expect(text).toContain('redshift');
        expect(text).toContain('code');
    });

    it('handles searchResources returning empty gracefully', async () => {
        const skill = createTestSkill({ name: 'empty', description: 'Empty skill', tools: [] });
        const ernesto = createErnesto([skill]);
        const ctx = createContext(ernesto);

        mockSearchResources.mockResolvedValue([]);

        const askTool = createAskTool(ctx, 'desc');
        const result = await askTool.handler({ query: 'anything', perDomain: 10 }, {});
        const text = result.content[0].text;

        // Still shows the skill as a route
        expect(text).toContain('empty');
    });
});
