/**
 * System Prompt Builder - OpenClaw-style composable prompt assembly
 *
 * Sections are assembled in priority order to form the final system prompt.
 *
 * Priority order:
 * 1. Soul (persona + tone)
 * 2. Org playbook (shared instructions)
 * 3. Skill catalog (auto-generated from registered skills)
 * 4. Memory context (recent memories)
 * 5. Tool instructions (how to use ask/run)
 * 6. Custom sections
 */

import { Skill } from './skill';
import { Soul, renderSoul } from './soul';

/**
 * Context for building system prompts
 */
export interface PromptContext {
    /** Available skills */
    skills: Skill[];
    /** User's soul config */
    soul?: Soul;
    /** Recent memory entries */
    memoryContext?: string;
    /** Custom data for template interpolation */
    [key: string]: any;
}

/**
 * A named section of the system prompt
 */
interface PromptSection {
    name: string;
    content: string | ((ctx: PromptContext) => string);
    priority: number;
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
                parts.push(`- **${skill.name}:${tool.name}**: ${tool.description}`);
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

    // Skill catalog (priority 30)
    builder.addSection('skills', (ctx) => {
        return buildSkillCatalog(ctx.skills);
    }, 30);

    // Memory context (priority 40)
    builder.addSection('memory', (ctx) => {
        if (!ctx.memoryContext) return '';
        return `# Memory\n\n${ctx.memoryContext}`;
    }, 40);

    return builder;
}
