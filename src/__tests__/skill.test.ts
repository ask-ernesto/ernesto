import { createSkill, toolResult, toolResultWithSuggestions } from '../skill';
import { createTestTool, createTestPipelineConfig } from './helpers';

describe('createSkill', () => {
    it('returns complete Skill object with all fields', () => {
        const instructionFn = async () => 'instruction';
        const tools = [createTestTool()];
        const resources = [createTestPipelineConfig()];
        const searchConfig = { enabled: true };

        const skill = createSkill({
            name: 'Test Skill',
            slug: 'test-skill',
            version: '1.0.0',
            description: 'A test skill',
            instruction: instructionFn,
            tools,
            resources,
            searchConfig,
            requiredScopes: ['read', 'write'],
            triggers: ['test'],
            icon: '🧪',
            tags: ['testing'],
            enabled: true,
        });

        expect(skill).toEqual({
            name: 'Test Skill',
            slug: 'test-skill',
            version: '1.0.0',
            description: 'A test skill',
            instruction: instructionFn,
            tools,
            resources,
            searchConfig,
            requiredScopes: ['read', 'write'],
            triggers: ['test'],
            icon: '🧪',
            tags: ['testing'],
            enabled: true,
        });
    });

    it('slug defaults to name and optional fields omitted', () => {
        const tools = [createTestTool()];

        const skill = createSkill({
            name: 'Test Skill',
            description: 'A test skill',
            instruction: 'Do something',
            tools,
        });

        expect(skill).toEqual({
            name: 'Test Skill',
            slug: 'Test Skill',
            description: 'A test skill',
            instruction: 'Do something',
            tools,
        });

        // Verify optional fields are not present
        expect(skill).not.toHaveProperty('version');
        expect(skill).not.toHaveProperty('resources');
        expect(skill).not.toHaveProperty('searchConfig');
        expect(skill).not.toHaveProperty('requiredScopes');
        expect(skill).not.toHaveProperty('triggers');
        expect(skill).not.toHaveProperty('icon');
        expect(skill).not.toHaveProperty('tags');
        expect(skill).not.toHaveProperty('enabled');
    });

    it('preserves dynamic instruction function', () => {
        const instructionFn = async () => 'dynamic instruction';
        const tools = [createTestTool()];

        const skill = createSkill({
            name: 'Test Skill',
            description: 'A test skill',
            instruction: instructionFn,
            tools,
        });

        expect(typeof skill.instruction).toBe('function');
        expect(skill.instruction).toBe(instructionFn);
    });
});

describe('toolResult', () => {
    it('returns object with content', () => {
        const result = toolResult('Test content');

        expect(result).toEqual({
            content: 'Test content',
        });
    });
});

describe('toolResultWithSuggestions', () => {
    it('returns object with content and suggestions', () => {
        const suggestions = [
            { text: 'Try this', action: 'do-something' },
        ];

        const result = toolResultWithSuggestions('Test content', suggestions);

        expect(result).toEqual({
            content: 'Test content',
            suggestions,
        });
    });
});
