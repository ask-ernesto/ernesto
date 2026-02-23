/**
 * Skill I/O - OpenClaw format interop
 *
 * Export: Ernesto skill → OpenClaw SKILL.md directory
 * Import: OpenClaw SKILL.md directory → Ernesto skill
 *
 * This ensures skills are portable between OpenClaw and Ernesto.
 *
 * OpenClaw SKILL.md format:
 * ```
 * ---
 * name: redshift
 * slug: redshift
 * version: 1.0.0
 * description: Data warehouse access
 * tags: [analytics]
 * triggers: [revenue, SQL, data]
 * ---
 *
 * # Redshift Analyst
 *
 * You are a data analyst with access to Bitrefill's Redshift warehouse...
 *
 * ## Tools
 *
 * - **query**: Execute custom SQL queries
 * - **revenue-breakdown**: Pre-built revenue analysis template
 * ```
 */

import { Skill, SkillTool, createSkill } from './skill';
import { formatZodSchemaForAgent } from './schema-formatter';

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT: Ernesto → OpenClaw SKILL.md
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Serialize a skill to OpenClaw SKILL.md format (frontmatter + body)
 */
export function skillToMarkdown(skill: Skill): string {
    const parts: string[] = [];

    // YAML frontmatter
    parts.push('---');
    parts.push(`name: ${skill.name}`);
    parts.push(`slug: ${skill.slug}`);
    if (skill.version) parts.push(`version: ${skill.version}`);
    parts.push(`description: ${skill.description}`);
    if (skill.tags?.length) parts.push(`tags: [${skill.tags.join(', ')}]`);
    if (skill.triggers?.length) parts.push(`triggers: [${skill.triggers.join(', ')}]`);
    if (skill.requiredScopes?.length) parts.push(`requires: [${skill.requiredScopes.join(', ')}]`);
    if (skill.icon) parts.push(`icon: ${skill.icon}`);
    parts.push('---');
    parts.push('');

    // Instruction body
    const instruction = typeof skill.instruction === 'string' ? skill.instruction : '<!-- Dynamic instruction (generated at runtime) -->';
    parts.push(instruction);
    parts.push('');

    // Tools section
    if (skill.tools.length > 0) {
        parts.push('## Tools');
        parts.push('');
        for (const tool of skill.tools) {
            const params = tool.inputSchema ? formatZodSchemaForAgent(tool.inputSchema) : undefined;
            parts.push(`- **${tool.name}**: ${tool.description}`);
            if (params) {
                parts.push(`  Parameters: ${params}`);
            }
        }
        parts.push('');
    }

    return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT: OpenClaw SKILL.md → Ernesto
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedFrontmatter {
    name?: string;
    slug?: string;
    version?: string;
    description?: string;
    tags?: string[];
    triggers?: string[];
    requires?: string[];
    icon?: string;
}

/**
 * Parse YAML frontmatter from SKILL.md content
 */
function parseFrontmatter(content: string): { frontmatter: ParsedFrontmatter; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content };
    }

    const yaml = match[1];
    const body = match[2].trim();
    const frontmatter: ParsedFrontmatter = {};

    for (const line of yaml.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();

        // Parse array values: [item1, item2]
        const arrayMatch = value.match(/^\[(.*)\]$/);
        if (arrayMatch) {
            (frontmatter as any)[key] = arrayMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean);
        } else {
            (frontmatter as any)[key] = value;
        }
    }

    return { frontmatter, body };
}

/**
 * Import an OpenClaw SKILL.md string into an Ernesto Skill
 *
 * Note: Tools cannot be imported from markdown (they're TypeScript functions).
 * The imported skill will have an empty tools array — tools must be wired separately.
 */
export function skillFromMarkdown(markdown: string): Skill {
    const { frontmatter, body } = parseFrontmatter(markdown);

    return createSkill({
        name: frontmatter.name || 'unnamed',
        slug: frontmatter.slug || frontmatter.name || 'unnamed',
        version: frontmatter.version,
        description: frontmatter.description || '',
        instruction: body,
        tools: [], // Tools can't be imported from markdown
        requiredScopes: frontmatter.requires,
        triggers: frontmatter.triggers,
        tags: frontmatter.tags,
        icon: frontmatter.icon,
    });
}
