import { vi } from 'vitest';
import { encode as encodeToon } from '@toon-format/toon';
import { formatAsToon } from '../formatters';

vi.mock('@toon-format/toon', () => ({
    encode: vi.fn(),
}));

const mockedEncodeToon = vi.mocked(encodeToon);

describe('formatAsToon', () => {
    beforeEach(() => {
        mockedEncodeToon.mockReset();
        mockedEncodeToon.mockReturnValue('toon-encoded');
    });

    it('formats object with rows array using TOON', () => {
        const input = { rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] };
        const result = formatAsToon(input);

        expect(mockedEncodeToon).toHaveBeenCalledWith({ rows: input.rows });
        expect(result).toBe('toon-encoded');
    });

    it('returns "No rows returned" for empty rows array', () => {
        const result = formatAsToon({ rows: [] });
        expect(mockedEncodeToon).not.toHaveBeenCalled();
        expect(result).toBe('No rows returned');
    });

    it('wraps direct array in { rows } and formats with TOON', () => {
        const input = [{ id: 1 }, { id: 2 }];
        const result = formatAsToon(input);

        expect(mockedEncodeToon).toHaveBeenCalledWith({ rows: input });
        expect(result).toBe('toon-encoded');
    });

    it('returns "No data returned" for empty array', () => {
        const result = formatAsToon([]);
        expect(mockedEncodeToon).not.toHaveBeenCalled();
        expect(result).toBe('No data returned');
    });

    it('formats plain object without rows property using TOON', () => {
        const input = { key: 'value', count: 42 };
        const result = formatAsToon(input);

        expect(mockedEncodeToon).toHaveBeenCalledWith(input);
        expect(result).toBe('toon-encoded');
    });

    it('falls back to JSON.stringify for non-object types', () => {
        expect(formatAsToon('hello')).toBe('"hello"');
        expect(formatAsToon(42)).toBe('42');
        expect(formatAsToon(null)).toBe('null');
        expect(formatAsToon(true)).toBe('true');
        expect(mockedEncodeToon).not.toHaveBeenCalled();
    });

    it('falls back to JSON.stringify when TOON encoding throws', () => {
        mockedEncodeToon.mockImplementation(() => {
            throw new Error('TOON encoding error');
        });

        const input = { key: 'value' };
        const result = formatAsToon(input);

        expect(mockedEncodeToon).toHaveBeenCalledWith(input);
        expect(result).toBe(JSON.stringify(input, null, 2));
    });
});
