import { vi } from 'vitest';
import { z } from 'zod';
import { SystemPromptBuilder, buildSkillCatalog, createDefaultPromptBuilder, PromptContext } from '../system-prompt';
import { Soul } from '../soul';
import { createTestSkill, createTestTool } from './helpers';

describe('SystemPromptBuilder', () => {
  it('should add section and include it in build output', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('test', 'Test content', 10);

    const context: PromptContext = { skills: [] };
    const output = builder.build(context);

    expect(output).toContain('Test content');
  });

  it('should sort multiple sections by priority (lower first)', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('third', 'Third section', 30);
    builder.addSection('first', 'First section', 10);
    builder.addSection('second', 'Second section', 20);

    const context: PromptContext = { skills: [] };
    const output = builder.build(context);

    const firstIndex = output.indexOf('First section');
    const secondIndex = output.indexOf('Second section');
    const thirdIndex = output.indexOf('Third section');

    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  it('should replace existing section when adding with same name', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('test', 'Original content', 10);
    builder.addSection('test', 'Replaced content', 15);

    const context: PromptContext = { skills: [] };
    const output = builder.build(context);

    expect(output).toContain('Replaced content');
    expect(output).not.toContain('Original content');
  });

  it('should exclude removed section from output', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('keep', 'Keep this', 10);
    builder.addSection('remove', 'Remove this', 20);
    builder.removeSection('remove');

    const context: PromptContext = { skills: [] };
    const output = builder.build(context);

    expect(output).toContain('Keep this');
    expect(output).not.toContain('Remove this');
  });

  it('should call dynamic section function with context', () => {
    const builder = new SystemPromptBuilder();
    const dynamicFn = vi.fn((ctx: PromptContext) => {
      return `Skills: ${ctx.skills.length}`;
    });
    builder.addSection('dynamic', dynamicFn, 10);

    const context: PromptContext = {
      skills: [createTestSkill({ name: 'test1' }), createTestSkill({ name: 'test2' })],
    };
    const output = builder.build(context);

    expect(dynamicFn).toHaveBeenCalledWith(context);
    expect(output).toContain('Skills: 2');
  });

  it('should skip sections with empty content', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('empty', '', 10);
    builder.addSection('withContent', 'Has content', 20);

    const context: PromptContext = { skills: [] };
    const output = builder.build(context);

    expect(output).toContain('Has content');
    expect(output.trim()).not.toMatch(/^\s*$/);
  });

  it('should skip dynamic sections that return empty string', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('empty', () => '', 10);
    builder.addSection('withContent', 'Has content', 20);

    const context: PromptContext = { skills: [] };
    const output = builder.build(context);

    expect(output).toContain('Has content');
  });

  it('should return sorted sections with getSections', () => {
    const builder = new SystemPromptBuilder();
    builder.addSection('third', 'Content', 30);
    builder.addSection('first', 'Content', 10);
    builder.addSection('second', 'Content', 20);

    const sections = builder.getSections();

    expect(sections).toEqual([
      { name: 'first', priority: 10 },
      { name: 'second', priority: 20 },
      { name: 'third', priority: 30 },
    ]);
  });
});

describe('buildSkillCatalog', () => {
  it('should return empty string for empty skills array', () => {
    const catalog = buildSkillCatalog([]);

    expect(catalog).toBe('');
  });

  it('should format skill with tools', () => {
    const tool1 = createTestTool({ name: 'query', description: 'Query data' });
    const tool2 = createTestTool({ name: 'update', description: 'Update data' });
    const skill = createTestSkill({
      name: 'test-skill',
      description: 'Test skill description',
      tools: [tool1, tool2],
    });

    const catalog = buildSkillCatalog([skill]);

    expect(catalog).toContain('# Available Skills');
    expect(catalog).toContain('## test-skill');
    expect(catalog).toContain('*Test skill description*');
    expect(catalog).toContain('- **test-skill:query**: Query data');
    expect(catalog).toContain('- **test-skill:update**: Update data');
  });

  it('should skip disabled skills', () => {
    const enabledSkill = createTestSkill({
      name: 'enabled',
      description: 'Enabled skill',
      enabled: true,
    });
    const disabledSkill = createTestSkill({
      name: 'disabled',
      description: 'Disabled skill',
      enabled: false,
    });

    const catalog = buildSkillCatalog([enabledSkill, disabledSkill]);

    expect(catalog).toContain('## enabled');
    expect(catalog).not.toContain('## disabled');
  });

  it('should format multiple skills', () => {
    const skill1 = createTestSkill({
      name: 'skill1',
      description: 'First skill',
      tools: [createTestTool({ name: 'tool1', description: 'Tool 1' })],
    });
    const skill2 = createTestSkill({
      name: 'skill2',
      description: 'Second skill',
      tools: [createTestTool({ name: 'tool2', description: 'Tool 2' })],
    });

    const catalog = buildSkillCatalog([skill1, skill2]);

    expect(catalog).toContain('## skill1');
    expect(catalog).toContain('*First skill*');
    expect(catalog).toContain('- **skill1:tool1**: Tool 1');
    expect(catalog).toContain('## skill2');
    expect(catalog).toContain('*Second skill*');
    expect(catalog).toContain('- **skill2:tool2**: Tool 2');
  });

  it('should handle skill with no tools', () => {
    const skill = createTestSkill({
      name: 'no-tools',
      description: 'Skill without tools',
      tools: [],
    });

    const catalog = buildSkillCatalog([skill]);

    expect(catalog).toContain('## no-tools');
    expect(catalog).toContain('*Skill without tools*');
  });

  it('should include param signatures when tools have inputSchema', () => {
    const schema = z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results'),
    });
    const tool = createTestTool({
      name: 'search',
      description: 'Search data',
      inputSchema: schema,
    });
    const skill = createTestSkill({
      name: 'test',
      description: 'Test skill',
      tools: [tool],
    });

    const catalog = buildSkillCatalog([skill]);

    expect(catalog).toContain('- **test:search**: Search data (');
    expect(catalog).toContain('query: string');
    expect(catalog).toContain('limit: number');
  });

  it('should not include params when tool has no inputSchema', () => {
    const tool = createTestTool({
      name: 'simple',
      description: 'Simple tool',
    });
    const skill = createTestSkill({
      name: 'test',
      description: 'Test skill',
      tools: [tool],
    });

    const catalog = buildSkillCatalog([skill]);

    expect(catalog).toContain('- **test:simple**: Simple tool');
    expect(catalog).not.toContain('(');
  });
});

describe('createDefaultPromptBuilder', () => {
  it('should create builder with soul and session-behavior sections (no skills)', () => {
    const builder = createDefaultPromptBuilder();
    const sections = builder.getSections();

    expect(sections).toEqual([
      { name: 'soul', priority: 10 },
      { name: 'session-behavior', priority: 40 },
    ]);
  });

  it('should render soul section first when soul is provided', () => {
    const builder = createDefaultPromptBuilder();
    const soul: Soul = {
      name: 'Test Assistant',
      persona: 'Help with testing',
    };
    const context: PromptContext = {
      skills: [],
      soul,
    };

    const output = builder.build(context);

    expect(output).toContain('Test Assistant');
    expect(output).toContain('Help with testing');
  });

  it('should skip soul section when soul is not provided', () => {
    const builder = createDefaultPromptBuilder();
    const context: PromptContext = {
      skills: [],
    };

    const output = builder.build(context);

    // Soul section should not appear (no persona header)
    expect(output).not.toContain('# OrgBot');
    // But session behavior should still be present
    expect(output).toContain('## Session Summary');
  });

  it('should NOT include skills in default prompt (agent discovers via ask)', () => {
    const builder = createDefaultPromptBuilder();
    const skill = createTestSkill({
      name: 'test-skill',
      description: 'Test skill',
      tools: [createTestTool({ name: 'tool1', description: 'Tool 1' })],
    });
    const context: PromptContext = {
      skills: [skill],
    };

    const output = builder.build(context);

    expect(output).not.toContain('# Available Skills');
    expect(output).not.toContain('## test-skill');
  });

  it('should include session behavior instructions', () => {
    const builder = createDefaultPromptBuilder();
    const context: PromptContext = {
      skills: [],
    };

    const output = builder.build(context);

    expect(output).toContain('## Session Summary');
    expect(output).toContain('## Session History');
    expect(output).toContain('ask("topic")');
  });

  it('should order sections by priority: soul, session-behavior', () => {
    const builder = createDefaultPromptBuilder();
    const soul: Soul = {
      name: 'Test Assistant',
      persona: 'Help',
    };
    const context: PromptContext = {
      skills: [],
      soul,
    };

    const output = builder.build(context);
    const soulIndex = output.indexOf('Test Assistant');
    const sessionIndex = output.indexOf('## Session Summary');

    expect(soulIndex).toBeLessThan(sessionIndex);
  });
});
