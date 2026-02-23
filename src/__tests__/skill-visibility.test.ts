import { describe, it, expect } from 'vitest';
import { getVisibleSkills } from '../skill-visibility';
import { ToolContext } from '../skill';
import { SkillRegistry } from '../skill-registry';
import { Ernesto } from '../Ernesto';
import { createTestSkill } from './helpers';

function createContextWithSkills(
    skills: ReturnType<typeof createTestSkill>[],
    visibleSkills?: string[],
): ToolContext {
    const registry = new SkillRegistry();
    registry.registerAll(skills);

    // Minimal Ernesto mock — only skillRegistry is used
    const ernesto = { skillRegistry: registry } as unknown as Ernesto;

    return {
        timestamp: Date.now(),
        ernesto,
        ...(visibleSkills !== undefined && { visibleSkills }),
    };
}

describe('getVisibleSkills', () => {
    const redshift = createTestSkill({ name: 'redshift', slug: 'redshift' });
    const blockchain = createTestSkill({ name: 'blockchain', slug: 'blockchain' });
    const striga = createTestSkill({ name: 'striga', slug: 'striga' });
    const disabled = createTestSkill({ name: 'disabled', slug: 'disabled', enabled: false });

    it('returns all enabled skills when visibleSkills is not set', () => {
        const ctx = createContextWithSkills([redshift, blockchain, striga, disabled]);
        const result = getVisibleSkills(ctx);

        expect(result).toHaveLength(3);
        expect(result.map(s => s.slug)).toEqual(['redshift', 'blockchain', 'striga']);
    });

    it('returns all enabled skills when visibleSkills is empty array', () => {
        const ctx = createContextWithSkills([redshift, blockchain, striga], []);
        const result = getVisibleSkills(ctx);

        expect(result).toHaveLength(3);
    });

    it('filters to only matching slugs when visibleSkills is set', () => {
        const ctx = createContextWithSkills(
            [redshift, blockchain, striga],
            ['redshift', 'striga'],
        );
        const result = getVisibleSkills(ctx);

        expect(result).toHaveLength(2);
        expect(result.map(s => s.slug)).toEqual(['redshift', 'striga']);
    });

    it('excludes disabled skills even if in visibleSkills', () => {
        const ctx = createContextWithSkills(
            [redshift, disabled],
            ['redshift', 'disabled'],
        );
        const result = getVisibleSkills(ctx);

        expect(result).toHaveLength(1);
        expect(result[0].slug).toBe('redshift');
    });

    it('silently ignores non-existent slugs in visibleSkills', () => {
        const ctx = createContextWithSkills(
            [redshift, blockchain],
            ['redshift', 'nonexistent'],
        );
        const result = getVisibleSkills(ctx);

        expect(result).toHaveLength(1);
        expect(result[0].slug).toBe('redshift');
    });
});
