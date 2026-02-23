/**
 * Skill Visibility - Per-user skill filtering primitive
 *
 * Single source of truth for which skills a user can discover.
 * Used by system prompt, CLI help, and ask tool.
 */

import { Skill, ToolContext } from './skill';

/**
 * Get the skills visible to a user based on their ToolContext.
 *
 * Filtering logic:
 * - Always filters out disabled skills (enabled === false)
 * - If visibleSkills is set and non-empty, only matching slugs are returned
 * - If visibleSkills is unset or empty, all enabled skills are returned
 */
export function getVisibleSkills(ctx: ToolContext): Skill[] {
    const all = ctx.ernesto.skillRegistry.getAll().filter(s => s.enabled !== false);
    if (!ctx.visibleSkills || ctx.visibleSkills.length === 0) return all;
    const allowed = new Set(ctx.visibleSkills);
    return all.filter(s => allowed.has(s.slug));
}
