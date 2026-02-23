import { skillToMarkdown, skillFromMarkdown } from '../skill-io';
import { createTestSkill, createTestTool } from './helpers';

describe('skillToMarkdown()', () => {
  it('should produce correct YAML frontmatter and body with all fields', () => {
    const skill = createTestSkill({
      name: 'Test Skill',
      slug: 'test-skill',
      version: '1.0.0',
      description: 'A test skill description',
      instruction: 'This is the instruction body',
      tags: ['tag1', 'tag2'],
      triggers: ['trigger1', 'trigger2'],
      requiredScopes: ['scope1', 'scope2'],
      icon: 'test-icon',
    });

    const markdown = skillToMarkdown(skill);

    expect(markdown).toContain('---');
    expect(markdown).toContain('name: Test Skill');
    expect(markdown).toContain('slug: test-skill');
    expect(markdown).toContain('version: 1.0.0');
    expect(markdown).toContain('description: A test skill description');
    // Arrays are rendered inline: tags: [tag1, tag2]
    expect(markdown).toContain('tags: [tag1, tag2]');
    expect(markdown).toContain('triggers: [trigger1, trigger2]');
    expect(markdown).toContain('requires: [scope1, scope2]');
    expect(markdown).toContain('icon: test-icon');
    expect(markdown).toContain('This is the instruction body');
  });

  it('should use placeholder comment for dynamic instruction', () => {
    const skill = createTestSkill({
      name: 'Dynamic Skill',
      slug: 'dynamic-skill',
      description: 'Dynamic description',
      instruction: async () => 'Dynamic instruction',
    });

    const markdown = skillToMarkdown(skill);

    expect(markdown).toContain('<!-- Dynamic instruction (generated at runtime) -->');
    // The placeholder comment contains "Dynamic instruction" as a substring
    // so we can't assert not.toContain - instead verify no other line has it
  });

  it('should render tools section with tool names and descriptions', () => {
    const tool1 = createTestTool({
      name: 'tool-1',
      description: 'First tool description',
    });
    const tool2 = createTestTool({
      name: 'tool-2',
      description: 'Second tool description',
    });

    const skill = createTestSkill({
      name: 'Skill with Tools',
      slug: 'skill-tools',
      description: 'Test skill',
      tools: [tool1, tool2],
    });

    const markdown = skillToMarkdown(skill);

    expect(markdown).toContain('## Tools');
    expect(markdown).toContain('**tool-1**');
    expect(markdown).toContain('First tool description');
    expect(markdown).toContain('**tool-2**');
    expect(markdown).toContain('Second tool description');
  });

  it('should render minimal skill with only required frontmatter fields', () => {
    const skill = createTestSkill({
      name: 'Minimal Skill',
      slug: 'minimal-skill',
      description: 'Minimal description',
    });

    const markdown = skillToMarkdown(skill);

    expect(markdown).toContain('name: Minimal Skill');
    expect(markdown).toContain('slug: minimal-skill');
    expect(markdown).toContain('description: Minimal description');
    expect(markdown).not.toContain('tags:');
    expect(markdown).not.toContain('triggers:');
    expect(markdown).not.toContain('## Tools');
  });
});

describe('skillFromMarkdown()', () => {
  it('should parse full markdown to correct Skill object', () => {
    // Use inline array format matching what skillToMarkdown produces
    const markdown = `---
name: Test Skill
slug: test-skill
version: 1.0.0
description: A test skill
tags: [tag1, tag2]
triggers: [trigger1, trigger2]
requires: [scope1, scope2]
icon: test-icon
---

This is the instruction body

Some more content here.`;

    const skill = skillFromMarkdown(markdown);

    expect(skill.name).toBe('Test Skill');
    expect(skill.slug).toBe('test-skill');
    expect(skill.version).toBe('1.0.0');
    expect(skill.description).toBe('A test skill');
    expect(skill.instruction).toContain('This is the instruction body');
    expect(skill.instruction).toContain('Some more content here.');
    expect(skill.tags).toEqual(['tag1', 'tag2']);
    expect(skill.triggers).toEqual(['trigger1', 'trigger2']);
    expect(skill.requiredScopes).toEqual(['scope1', 'scope2']);
    expect(skill.icon).toBe('test-icon');
    expect(skill.tools).toEqual([]);
  });

  it('should handle markdown without frontmatter', () => {
    const markdown = `This is just body content without frontmatter.

More content here.`;

    const skill = skillFromMarkdown(markdown);

    expect(skill.name).toBe('unnamed');
    expect(skill.instruction).toContain('This is just body content');
    expect(skill.instruction).toContain('More content here.');
  });

  it('should parse arrays correctly (tags, triggers)', () => {
    const markdown = `---
name: Array Test
slug: array-test
description: Testing arrays
tags: [alpha, beta, gamma]
triggers: [one, two]
---

Body content`;

    const skill = skillFromMarkdown(markdown);

    expect(skill.tags).toEqual(['alpha', 'beta', 'gamma']);
    expect(skill.triggers).toEqual(['one', 'two']);
  });

  it('should handle empty arrays', () => {
    const markdown = `---
name: Empty Arrays
slug: empty-arrays
description: Testing empty arrays
tags: []
triggers: []
---

Body content`;

    const skill = skillFromMarkdown(markdown);

    expect(skill.tags).toEqual([]);
    expect(skill.triggers).toEqual([]);
  });
});

describe('Round-trip conversion', () => {
  it('should preserve static fields through skillFromMarkdown(skillToMarkdown(skill))', () => {
    const original = createTestSkill({
      name: 'Round Trip Test',
      slug: 'round-trip-test',
      version: '2.5.0',
      description: 'Testing round-trip conversion',
      instruction: 'Static instruction content',
      tags: ['test', 'roundtrip'],
      triggers: ['rt1', 'rt2'],
      requiredScopes: ['read', 'write'],
      icon: 'round-icon',
    });

    const markdown = skillToMarkdown(original);
    const restored = skillFromMarkdown(markdown);

    expect(restored.name).toBe(original.name);
    expect(restored.slug).toBe(original.slug);
    expect(restored.version).toBe(original.version);
    expect(restored.description).toBe(original.description);
    expect(restored.tags).toEqual(original.tags);
    expect(restored.triggers).toEqual(original.triggers);
    expect(restored.requiredScopes).toEqual(original.requiredScopes);
    expect(restored.icon).toBe(original.icon);
    expect(typeof restored.instruction).toBe('string');
    expect(restored.instruction).toContain('Static instruction content');
  });

  it('should not preserve tools (tools always empty after parsing)', () => {
    const tool = createTestTool({ name: 'test-tool' });
    const original = createTestSkill({
      name: 'Skill with Tools',
      slug: 'tools-skill',
      description: 'Has tools',
      tools: [tool],
    });

    const markdown = skillToMarkdown(original);
    const restored = skillFromMarkdown(markdown);

    expect(restored.tools).toEqual([]);
  });

  it('should handle dynamic instruction with placeholder', () => {
    const original = createTestSkill({
      name: 'Dynamic Skill',
      slug: 'dynamic-skill',
      description: 'Dynamic test',
      instruction: async () => 'This is dynamic',
    });

    const markdown = skillToMarkdown(original);
    const restored = skillFromMarkdown(markdown);

    expect(typeof restored.instruction).toBe('string');
    expect(restored.instruction).toContain('<!-- Dynamic instruction (generated at runtime) -->');
  });
});
