/**
 * System Prompt Builder - OpenClaw-style composable prompt assembly
 *
 * Sections are assembled in priority order to form the final system prompt.
 *
 * Default priority order:
 * 1. Soul (persona + tone)
 * 2. Org playbook (shared instructions)
 * 3. Session behavior (summary writing + history search)
 * 4. Tool instructions (how to use ask/run)
 * 5. Custom sections
 *
 * NOTE: Skills are NOT included in the system prompt. The agent discovers
 * tools at runtime via ask() — this avoids duplicating the catalog and
 * wasting tokens on every turn.
 */

import { Skill } from './skill';
import { Soul, renderSoul } from './soul';
import { formatZodSchemaForAgent } from './schema-formatter';

/**
 * Context for building system prompts
 */
export interface PromptContext {
    /** Available skills */
    skills: Skill[];
    /** User's soul config */
    soul?: Soul;
    /** Custom data for template interpolation */
    [key: string]: any;
}

/**
 * A named section of the system prompt (internal — content may be a function)
 */
interface PromptSection {
    name: string;
    content: string | ((ctx: PromptContext) => string);
    priority: number;
}

/**
 * A rendered section of the system prompt (content already resolved to string)
 */
export interface RenderedPromptSection {
    name: string;
    priority: number;
    content: string;
}

/**
 * Composable system prompt builder
 */
export class SystemPromptBuilder {
    private sections: PromptSection[] = [];

    /**
     * Add a section to the system prompt
     * Lower priority numbers = higher in the prompt.
     */
    addSection(name: string, content: string | ((ctx: PromptContext) => string), priority: number): void {
        // Replace existing section with same name
        this.sections = this.sections.filter((s) => s.name !== name);
        this.sections.push({ name, content, priority });
    }

    /**
     * Remove a section by name
     */
    removeSection(name: string): void {
        this.sections = this.sections.filter((s) => s.name !== name);
    }

    /**
     * Build the final system prompt
     */
    build(ctx: PromptContext): string {
        const parts: string[] = [];

        // Sort sections by priority (lower = first)
        const sorted = [...this.sections].sort((a, b) => a.priority - b.priority);

        for (const section of sorted) {
            const content = typeof section.content === 'function' ? section.content(ctx) : section.content;
            if (content.trim()) {
                parts.push(content);
            }
        }

        return parts.join('\n\n');
    }

    /**
     * Get section names (for debugging/dashboard)
     */
    getSections(): { name: string; priority: number }[] {
        return this.sections
            .sort((a, b) => a.priority - b.priority)
            .map((s) => ({ name: s.name, priority: s.priority }));
    }

    /**
     * Build and return individual rendered sections (for storage/dashboard).
     * Each section's content is resolved against the given context.
     */
    buildSections(ctx: PromptContext): RenderedPromptSection[] {
        return [...this.sections]
            .sort((a, b) => a.priority - b.priority)
            .map((s) => ({
                name: s.name,
                priority: s.priority,
                content: (typeof s.content === 'function' ? s.content(ctx) : s.content).trim(),
            }))
            .filter((s) => s.content.length > 0);
    }
}

/**
 * Build a skill catalog section for the system prompt
 */
export function buildSkillCatalog(skills: Skill[]): string {
    if (skills.length === 0) return '';

    const parts: string[] = [];
    parts.push('# Available Skills');
    parts.push('');

    for (const skill of skills) {
        if (skill.enabled === false) continue;

        parts.push(`## ${skill.name}`);
        parts.push(`*${skill.description}*`);

        if (skill.tools.length > 0) {
            parts.push('');
            for (const tool of skill.tools) {
                const params = tool.inputSchema ? formatZodSchemaForAgent(tool.inputSchema) : undefined;
                parts.push(`- **${skill.name}:${tool.name}**: ${tool.description}${params ? ` (${params})` : ''}`);
            }
        }

        parts.push('');
    }

    return parts.join('\n');
}

/**
 * Create a default SystemPromptBuilder with standard sections
 */
export function createDefaultPromptBuilder(): SystemPromptBuilder {
    const builder = new SystemPromptBuilder();

    // Soul section (priority 10 — first)
    builder.addSection('soul', (ctx) => {
        if (!ctx.soul) return '';
        return renderSoul(ctx.soul);
    }, 10);

    // NOTE: Skills are NOT injected into the system prompt.
    // The agent discovers tools via ask() at runtime — the skill catalog
    // was removed to avoid duplicating what ask() already provides and
    // wasting tokens on every turn.

    // Session behavior (priority 40)
    builder.addSection('session-behavior', `## Session Summary

Your structured output includes a \`summary\` field. Write a concise paragraph covering:
- What was accomplished and key findings
- Tools and data sources consulted
- Outcome or recommendation

Write "" for trivial interactions (greetings, simple lookups with no analysis).

## Session History

Past conversations are indexed and searchable. Use ask("topic") to find prior work, investigations, and decisions. Each session resource includes the original prompt, tools used with parameters, summary, and result. Follow-up conversations include the full parent chain for context.`, 40);

    return builder;
}
