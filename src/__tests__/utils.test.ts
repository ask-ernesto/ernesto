import { truncateText, flattenResources } from '../utils';
import { ResourceNode } from '../types';

describe('truncateText', () => {
    it('returns empty string unchanged', () => {
        expect(truncateText('')).toBe('');
    });

    it('returns falsy values unchanged', () => {
        expect(truncateText(null as any)).toBe(null);
        expect(truncateText(undefined as any)).toBe(undefined);
    });

    it('returns short text unchanged', () => {
        expect(truncateText('Hello world')).toBe('Hello world');
    });

    it('returns text at exactly maxLength unchanged', () => {
        const text = 'a'.repeat(200);
        expect(truncateText(text)).toBe(text);
    });

    it('truncates at sentence boundary (period)', () => {
        const text = 'This is a complete sentence that is definitely long enough to be over fifty chars. ' +
            'And this is extra text that pushes it over the two hundred character limit to trigger truncation behavior. ' +
            'More padding text here to ensure we exceed the default max length of two hundred characters easily.';
        const result = truncateText(text);
        expect(result).toMatch(/\.$/);
        expect(result.length).toBeLessThanOrEqual(200);
    });

    it('truncates at sentence boundary (exclamation mark)', () => {
        // This text must be > 200 chars total and have ! within first 200 chars but > 50 chars from start
        const text = 'This is a really exciting sentence that is definitely long enough to exceed fifty characters in total! ' +
            'And then we need to add even more padding text to push the total character count way past the two hundred character default maximum length limit that triggers truncation behavior in this utility function.';
        expect(text.length).toBeGreaterThan(200);
        const result = truncateText(text);
        expect(result).toMatch(/!$/);
        expect(result.length).toBeLessThanOrEqual(200);
    });

    it('falls back to word boundary when no sentence end found', () => {
        // Over 200 chars, no period/!/? anywhere
        const text = 'This text has no sentence endings and is quite long because we need to exceed the two hundred character ' +
            'default maximum length limit so that the truncation logic will kick in and try to find a word boundary to break at instead of a sentence boundary';
        expect(text.length).toBeGreaterThan(200);
        const result = truncateText(text);
        expect(result).toMatch(/\.\.\.$/);
        expect(result.length).toBeLessThanOrEqual(203); // 200 + '...'
    });

    it('falls back to hard truncation when no word boundary > 50', () => {
        // A single very long word with no spaces after position 50
        const text = 'a'.repeat(250);
        const result = truncateText(text);
        expect(result).toBe('a'.repeat(200) + '...');
    });

    it('respects custom maxLength parameter', () => {
        const text = 'Short sentence. More text follows here.';
        const result = truncateText(text, 20);
        expect(result.length).toBeLessThanOrEqual(23); // 20 + '...'
    });
});

describe('flattenResources', () => {
    const makeNode = (id: string, children?: ResourceNode[]): ResourceNode => ({
        id,
        name: id,
        path: `/${id}`,
        content: `content-${id}`,
        ...(children && { children }),
    });

    it('returns empty array for empty input', () => {
        expect(flattenResources([])).toEqual([]);
    });

    it('returns flat list for resources with no children', () => {
        const resources = [makeNode('a'), makeNode('b')];
        const result = flattenResources(resources);
        expect(result).toHaveLength(2);
        expect(result.map(r => r.id)).toEqual(['a', 'b']);
    });

    it('flattens one level of nesting', () => {
        const resources = [
            makeNode('parent', [makeNode('child1'), makeNode('child2')]),
        ];
        const result = flattenResources(resources);
        expect(result).toHaveLength(3);
        expect(result.map(r => r.id)).toEqual(['parent', 'child1', 'child2']);
    });

    it('flattens deep recursive nesting', () => {
        const resources = [
            makeNode('l1', [
                makeNode('l2', [
                    makeNode('l3', [makeNode('l4')]),
                ]),
            ]),
        ];
        const result = flattenResources(resources);
        expect(result).toHaveLength(4);
        expect(result.map(r => r.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
    });
});
