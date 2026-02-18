import { vi } from 'vitest';
import { z } from 'zod';
import { createRunTool } from '../tools/run';
import { Ernesto } from '../Ernesto';
import { ToolContext } from '../skill';
import { createTestSkill, createTestTool } from './helpers';

describe('createRunTool', () => {
  const mockTypesense = {} as any;

  const createErnesto = (skills: any[] = []) =>
    new Ernesto({
      skills,
      typesense: mockTypesense,
    });

  const createContext = (ernesto: Ernesto, overrides: Partial<ToolContext> = {}): ToolContext => ({
    user: { id: 'test-user', email: 'test@example.com' },
    scopes: ['read', 'write'],
    requestId: 'test-req-123',
    timestamp: Date.now(),
    ernesto,
    callStack: [],
    ...overrides,
  });

  const parseResponse = (response: any) => {
    return JSON.parse(response.content[0].text);
  };

  describe('skill:tool identifier', () => {
    it('executes skill tool and returns success result', async () => {
      const tool = createTestTool({
        name: 'test-tool',
        execute: async () => ({ content: 'tool executed successfully' }),
      });
      const skill = createTestSkill({ name: 'test-skill', tools: [tool] });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'test-skill:test-tool', params: {} }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toBe('tool executed successfully');
    });

    it('returns error when tool not found', async () => {
      const skill = createTestSkill({ name: 'test-skill' });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'test-skill:unknown-tool' }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results).toHaveLength(1);
      // The tool returns success:true with "Tool not found" content (not an exception)
      expect(parsed.results[0].data).toContain('not found');
    });
  });

  describe('skill identifier (no colon)', () => {
    it('returns skill instruction content', async () => {
      const skill = createTestSkill({
        name: 'test-skill',
        instruction: 'This is a test skill instruction.',
      });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'test-skill' }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toContain('test skill instruction');
    });

    it('returns skill not found error for unknown skill', async () => {
      const ernesto = createErnesto();

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'unknown-skill' }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toContain('not found');
    });
  });

  describe('permission check', () => {
    it('denies when user lacks required scopes', async () => {
      const tool = createTestTool({
        name: 'admin-tool',
        execute: async () => ({ content: 'admin action' }),
        requiredScopes: ['admin'],
      });
      const skill = createTestSkill({
        name: 'admin-skill',
        requiredScopes: ['admin'],
        tools: [tool],
      });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto, {
        scopes: ['read', 'write'], // Missing 'admin'
      });
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'admin-skill:admin-tool' }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toContain('Permission denied');
    });
  });

  describe('input validation', () => {
    it('rejects invalid params when tool has inputSchema', async () => {
      const tool = createTestTool({
        name: 'validated-tool',
        execute: async () => ({ content: 'success' }),
      });
      tool.inputSchema = z.object({ query: z.string() });

      const skill = createTestSkill({ name: 'test-skill', tools: [tool] });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'test-skill:validated-tool', params: { query: 123 } }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toContain('validation failed');
    });

    it('accepts valid params when tool has inputSchema', async () => {
      const tool = createTestTool({
        name: 'validated-tool',
        execute: async () => ({ content: 'validated success' }),
      });
      tool.inputSchema = z.object({ query: z.string() });

      const skill = createTestSkill({ name: 'test-skill', tools: [tool] });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        { routes: [{ route: 'test-skill:validated-tool', params: { query: 'test' } }] },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toBe('validated success');
    });
  });

  describe('multiple routes', () => {
    it('executes all routes in parallel and returns all results', async () => {
      const tool1 = createTestTool({
        name: 'tool1',
        execute: async () => ({ content: 'result1' }),
      });
      const tool2 = createTestTool({
        name: 'tool2',
        execute: async () => ({ content: 'result2' }),
      });
      const skill = createTestSkill({ name: 'test-skill', tools: [tool1, tool2] });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        {
          routes: [
            { route: 'test-skill:tool1' },
            { route: 'test-skill:tool2' },
          ],
        },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toBe('result1');
      expect(parsed.results[1].success).toBe(true);
      expect(parsed.results[1].data).toBe('result2');
    });

    it('returns both success and error results for partial failures', async () => {
      const successTool = createTestTool({
        name: 'success-tool',
        execute: async () => ({ content: 'success' }),
      });
      const failTool = createTestTool({
        name: 'fail-tool',
        execute: async () => { throw new Error('tool failed'); },
      });
      const skill = createTestSkill({ name: 'test-skill', tools: [successTool, failTool] });
      const ernesto = createErnesto([skill]);

      const ctx = createContext(ernesto);
      const runTool = createRunTool(ctx, 'Run tool');
      const response = await runTool.handler(
        {
          routes: [
            { route: 'test-skill:success-tool' },
            { route: 'test-skill:fail-tool' },
          ],
        },
        {},
      );

      const parsed = parseResponse(response);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].success).toBe(true);
      expect(parsed.results[0].data).toBe('success');
      expect(parsed.results[1].success).toBe(false);
      expect(parsed.results[1].error).toBeDefined();
    });
  });
});
