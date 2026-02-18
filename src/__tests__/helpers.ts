/**
 * Shared test utilities for OpenClaw skill system tests
 */

import { Skill, SkillTool, ToolContext, ToolResult, SkillContext } from '../skill';
import { PipelineConfig, ContentSource, ContentFormat, ResourceNode } from '../types';

/**
 * Create a minimal skill for testing
 */
export function createTestSkill(overrides?: Partial<Skill>): Skill {
    return {
        name: 'test-skill',
        slug: 'test-skill',
        description: 'A test skill',
        instruction: 'Test instruction',
        tools: [],
        ...overrides,
    };
}

/**
 * Create a minimal skill tool for testing
 */
export function createTestTool(overrides?: Partial<SkillTool>): SkillTool {
    return {
        name: 'test-tool',
        description: 'A test tool',
        execute: async () => ({ content: 'test result' }),
        ...overrides,
    };
}

/**
 * Create a mock content source for testing PipelineConfig
 */
export function createTestSource(name = 'test-source'): ContentSource {
    return {
        name,
        async listDocuments() { return []; },
        async fetchContent() { return { content: '', contentType: 'text/plain' }; },
    };
}

/**
 * Create a mock content format for testing PipelineConfig
 */
export function createTestFormat(name = 'test-format'): ContentFormat {
    return {
        name,
        canHandle: () => true,
        parse: () => [],
    };
}

/**
 * Create a mock PipelineConfig for testing resources/extractors
 */
export function createTestPipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
    return {
        source: createTestSource(),
        formats: [createTestFormat()],
        ...overrides,
    };
}
