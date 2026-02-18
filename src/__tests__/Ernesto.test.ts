import { vi } from 'vitest';
import { Ernesto } from '../Ernesto';
import { SystemPromptBuilder } from '../system-prompt';
import { SkillRegistry } from '../skill-registry';
import { createTestSkill, createTestTool } from './helpers';

describe('Ernesto', () => {
  const mockTypesense = {} as any;

  describe('constructor', () => {
    it('registers skills directly when skills provided', () => {
      const skill1 = createTestSkill({ name: 'test-skill-1' });
      const skill2 = createTestSkill({ name: 'test-skill-2' });

      const ernesto = new Ernesto({
        skills: [skill1, skill2],
        typesense: mockTypesense,
      });

      expect(ernesto.skills.get('test-skill-1')).toBe(skill1);
      expect(ernesto.skills.get('test-skill-2')).toBe(skill2);
    });

    it('stores and provides access to soul via getter', () => {
      const soul = {
        name: 'TestBot',
        persona: 'A helpful test bot',
      };

      const ernesto = new Ernesto({
        soul,
        typesense: mockTypesense,
      });

      expect(ernesto.soul).toBe(soul);
    });

    it('stores and provides access to memory via getter', () => {
      const memory = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        search: vi.fn(async () => []),
        delete: vi.fn(async () => {}),
      };

      const ernesto = new Ernesto({
        memory,
        typesense: mockTypesense,
      });

      expect(ernesto.memory).toBe(memory);
    });

    it('stores and provides access to heartbeat via getter', () => {
      const heartbeat = {
        enabled: true,
        every: '30m',
      };

      const ernesto = new Ernesto({
        heartbeat,
        typesense: mockTypesense,
      });

      expect(ernesto.heartbeat).toBe(heartbeat);
    });

    it('adds custom system prompt section when string provided', () => {
      const customPrompt = 'You are a helpful assistant.';

      const ernesto = new Ernesto({
        systemPrompt: customPrompt,
        typesense: mockTypesense,
      });

      const systemPrompt = ernesto.systemPrompt;
      expect(systemPrompt).toContain(customPrompt);
    });

    it('uses SystemPromptBuilder directly when provided', () => {
      const builder = new SystemPromptBuilder();
      builder.addSection('test', 'Test content', 100);

      const ernesto = new Ernesto({
        systemPrompt: builder,
        typesense: mockTypesense,
      });

      const systemPrompt = ernesto.systemPrompt;
      expect(systemPrompt).toContain('Test content');
    });
  });

  describe('accessors', () => {
    it('.skills returns SkillRegistry instance', () => {
      const ernesto = new Ernesto({
        typesense: mockTypesense,
      });

      expect(ernesto.skills).toBeDefined();
      expect(ernesto.skills).toBeInstanceOf(SkillRegistry);
      expect(typeof ernesto.skills.get).toBe('function');
      expect(typeof ernesto.skills.register).toBe('function');
    });

    it('.systemPrompt returns assembled string with skill catalog', () => {
      const tool = createTestTool({ name: 'query', description: 'Query data' });
      const skill = createTestSkill({
        name: 'test-skill',
        description: 'A test skill',
        tools: [tool],
      });

      const ernesto = new Ernesto({
        skills: [skill],
        typesense: mockTypesense,
      });

      const systemPrompt = ernesto.systemPrompt;
      expect(typeof systemPrompt).toBe('string');
      expect(systemPrompt.length).toBeGreaterThan(0);
      expect(systemPrompt).toContain('test-skill');
    });
  });

  describe('toJSON', () => {
    it('returns serializable ErnestoSnapshot with correct fields', () => {
      const tool = createTestTool({ name: 'test-tool' });
      const skill = createTestSkill({ name: 'test-skill', tools: [tool] });

      const soul = {
        name: 'TestBot',
        persona: 'A helpful test bot',
      };

      const memory = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        search: vi.fn(async () => []),
        delete: vi.fn(async () => {}),
      };

      const heartbeat = {
        enabled: true,
        every: '30m',
      };

      const ernesto = new Ernesto({
        skills: [skill],
        soul,
        memory,
        heartbeat,
        typesense: mockTypesense,
      });

      const snapshot = ernesto.toJSON();

      expect(snapshot).toHaveProperty('skills');
      expect(snapshot).toHaveProperty('toolCount');
      expect(snapshot).toHaveProperty('soul');
      expect(snapshot).toHaveProperty('memory');
      expect(snapshot).toHaveProperty('heartbeat');

      expect(Array.isArray(snapshot.skills)).toBe(true);
      expect(snapshot.skills).toHaveLength(1);
      expect(snapshot.skills[0].name).toBe('test-skill');

      expect(snapshot.toolCount).toBe(1);
      expect(snapshot.soul).toBe(soul);
      expect(snapshot.memory).toBe(true);
      expect(snapshot.heartbeat).toBe(heartbeat);
    });

    it('handles missing optional fields in snapshot', () => {
      const ernesto = new Ernesto({
        typesense: mockTypesense,
      });

      const snapshot = ernesto.toJSON();

      expect(snapshot.skills).toEqual([]);
      expect(snapshot.toolCount).toBe(0);
      expect(snapshot.soul).toBeNull();
      expect(snapshot.memory).toBe(false);
      expect(snapshot.heartbeat).toBeNull();
    });
  });
});
