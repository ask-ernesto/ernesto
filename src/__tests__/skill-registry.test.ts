import { SkillRegistry } from '../skill-registry';
import { generateSourceId } from '../pipelines';
import { createTestSkill, createTestTool, createTestPipelineConfig, createTestSource } from './helpers';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('register()', () => {
    it('should register a skill and make it accessible via get()', () => {
      const skill = createTestSkill({ name: 'test-skill', description: 'Test skill' });
      registry.register(skill);

      const retrieved = registry.get('test-skill');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-skill');
      expect(retrieved?.description).toBe('Test skill');
    });

    it('should overwrite existing skill with same name', () => {
      const skill1 = createTestSkill({ name: 'test-skill', description: 'Original description' });
      const skill2 = createTestSkill({ name: 'test-skill', description: 'New description' });

      registry.register(skill1);
      registry.register(skill2);

      const retrieved = registry.get('test-skill');
      expect(retrieved?.description).toBe('New description');
    });
  });

  describe('registerAll()', () => {
    it('should register all skills', () => {
      const skills = [
        createTestSkill({ name: 'skill-1', description: 'Skill 1' }),
        createTestSkill({ name: 'skill-2', description: 'Skill 2' }),
        createTestSkill({ name: 'skill-3', description: 'Skill 3' }),
      ];

      registry.registerAll(skills);

      expect(registry.get('skill-1')).toBeDefined();
      expect(registry.get('skill-2')).toBeDefined();
      expect(registry.get('skill-3')).toBeDefined();
    });
  });

  describe('get()', () => {
    it('should return undefined for nonexistent skill', () => {
      const result = registry.get('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('has()', () => {
    it('should return true for registered skill', () => {
      const skill = createTestSkill({ name: 'test-skill' });
      registry.register(skill);

      expect(registry.has('test-skill')).toBe(true);
    });

    it('should return false for nonexistent skill', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('should return all skills as array', () => {
      const skills = [
        createTestSkill({ name: 'skill-1' }),
        createTestSkill({ name: 'skill-2' }),
        createTestSkill({ name: 'skill-3' }),
      ];

      registry.registerAll(skills);

      const allSkills = registry.getAll();
      expect(allSkills).toHaveLength(3);
      expect(allSkills.map(s => s.name)).toEqual(['skill-1', 'skill-2', 'skill-3']);
    });

    it('should return empty array when no skills registered', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('getAllTools()', () => {
    it('should return flat ToolRef[] across all skills', () => {
      const tool1 = createTestTool({ name: 'tool-1' });
      const tool2 = createTestTool({ name: 'tool-2' });
      const tool3 = createTestTool({ name: 'tool-3' });

      const skill1 = createTestSkill({ name: 'skill-1', tools: [tool1, tool2] });
      const skill2 = createTestSkill({ name: 'skill-2', tools: [tool3] });

      registry.registerAll([skill1, skill2]);

      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(3);
      expect(allTools.map(t => t.id)).toEqual(['skill-1:tool-1', 'skill-1:tool-2', 'skill-2:tool-3']);
      expect(allTools[0].skill).toBe('skill-1');
      expect(allTools[2].skill).toBe('skill-2');
    });

    it('should return empty array when no tools exist', () => {
      const skill = createTestSkill({ name: 'skill-1', tools: [] });
      registry.register(skill);

      expect(registry.getAllTools()).toEqual([]);
    });
  });

  describe('resolveTool()', () => {
    beforeEach(() => {
      const tool1 = createTestTool({ name: 'tool-1' });
      const tool2 = createTestTool({ name: 'tool-2' });
      const skill = createTestSkill({ name: 'test-skill', tools: [tool1, tool2] });
      registry.register(skill);
    });

    it('should find correct tool with "skill:tool" format', () => {
      const result = registry.resolveTool('test-skill:tool-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-skill:tool-1');
      expect(result?.skill).toBe('test-skill');
      expect(result?.tool.name).toBe('tool-1');
    });

    it('should return undefined for nonexistent tool in existing skill', () => {
      const result = registry.resolveTool('test-skill:nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for nonexistent skill', () => {
      const result = registry.resolveTool('nonexistent:tool-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined for identifier without colon', () => {
      const result = registry.resolveTool('nocolon');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllSources()', () => {
    it('should return SkillSourceInfo[] from skill resources', () => {
      const source1 = createTestSource('source-1');
      const source2 = createTestSource('source-2');
      const pipeline1 = createTestPipelineConfig({ source: source1, basePath: 'path1' });
      const pipeline2 = createTestPipelineConfig({ source: source2, basePath: 'path2' });

      const skill = createTestSkill({
        name: 'test-skill',
        resources: [pipeline1, pipeline2],
      });

      registry.register(skill);

      const sources = registry.getAllSources();
      expect(sources).toHaveLength(2);
      expect(sources[0].skill).toBe('test-skill');
      expect(sources[1].skill).toBe('test-skill');
    });

    it('should return empty array when no resources exist', () => {
      const skill = createTestSkill({ name: 'test-skill' });
      registry.register(skill);

      expect(registry.getAllSources()).toEqual([]);
    });
  });

  describe('findSource()', () => {
    it('should find extractor by source ID', () => {
      const source = createTestSource('test-source');
      const pipeline = createTestPipelineConfig({ source, basePath: 'base/path' });
      const skill = createTestSkill({
        name: 'test-skill',
        resources: [pipeline],
      });

      registry.register(skill);

      const sourceId = generateSourceId('test-source', 'base/path');
      const result = registry.findSource(sourceId);

      expect(result).toBeDefined();
      expect(result?.skillName).toBe('test-skill');
      expect(result?.extractor).toBe(pipeline);
    });

    it('should return null for nonexistent source ID', () => {
      const source = createTestSource('test-source');
      const pipeline = createTestPipelineConfig({ source, basePath: 'base/path' });
      const skill = createTestSkill({
        name: 'test-skill',
        resources: [pipeline],
      });

      registry.register(skill);

      const result = registry.findSource('nonexistent__source');
      expect(result).toBeNull();
    });
  });

  describe('toJSON()', () => {
    it('should return serializable SkillSnapshot[] with correct fields', () => {
      const tool1 = createTestTool({ name: 'tool-1', description: 'Tool 1 description' });
      const skill1 = createTestSkill({
        name: 'skill-1',
        description: 'Skill 1',
        version: '1.0.0',
        tools: [tool1],
      });

      const skill2 = createTestSkill({
        name: 'skill-2',
        description: 'Skill 2',
        version: '2.0.0',
      });

      registry.registerAll([skill1, skill2]);

      const snapshots = registry.toJSON();
      expect(snapshots).toHaveLength(2);

      expect(snapshots[0].name).toBe('skill-1');
      expect(snapshots[0].description).toBe('Skill 1');
      expect(snapshots[0].version).toBe('1.0.0');
      expect(snapshots[0].tools).toHaveLength(1);

      expect(snapshots[1].name).toBe('skill-2');
      expect(snapshots[1].description).toBe('Skill 2');
      expect(snapshots[1].version).toBe('2.0.0');
    });

    it('should return empty array when no skills registered', () => {
      expect(registry.toJSON()).toEqual([]);
    });
  });
});
