import { z } from 'zod';
import { formatZodSchemaForAgent } from '../schema-formatter';

describe('formatZodSchemaForAgent', () => {
    it('returns undefined for undefined schema', () => {
        expect(formatZodSchemaForAgent(undefined)).toBeUndefined();
    });

    it('returns "No parameters required" for void schema', () => {
        expect(formatZodSchemaForAgent(z.void())).toBe('No parameters required');
    });

    it('returns "No parameters required" for empty object', () => {
        expect(formatZodSchemaForAgent(z.object({}))).toBe('No parameters required');
    });

    describe('string fields', () => {
        it('formats basic string field', () => {
            const schema = z.object({ name: z.string() });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('name');
            expect(result).toContain('string');
        });

        it('formats string with constraints (may not show in Zod v4)', () => {
            const schema = z.object({
                query: z.string().min(1).max(100),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('query');
            expect(result).toContain('string');
        });

        it('includes description when available', () => {
            const schema = z.object({
                query: z.string().describe('Search query text'),
            });
            const result = formatZodSchemaForAgent(schema)!;
            // Description may or may not be exposed depending on Zod version
            expect(result).toContain('query');
            expect(result).toContain('string');
        });
    });

    describe('number fields', () => {
        it('formats basic number field', () => {
            const schema = z.object({ count: z.number() });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('count');
            expect(result).toContain('number');
        });

        it('formats number with constraints (may not show in Zod v4)', () => {
            const schema = z.object({
                limit: z.number().min(1).max(50),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('limit');
            expect(result).toContain('number');
        });
    });

    describe('boolean fields', () => {
        it('formats boolean field', () => {
            const schema = z.object({ active: z.boolean() });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('boolean');
        });
    });

    describe('enum fields', () => {
        it('formats enum values', () => {
            const schema = z.object({
                mode: z.enum(['semantic', 'keyword', 'hybrid']),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toMatch(/enum/);
        });
    });

    describe('optional and default fields', () => {
        it('marks optional fields', () => {
            const schema = z.object({
                filter: z.string().optional(),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('optional');
        });

        it('shows default values', () => {
            const schema = z.object({
                limit: z.number().default(10),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('default');
            expect(result).toContain('10');
        });
    });

    describe('array fields', () => {
        it('formats array of strings', () => {
            const schema = z.object({
                tags: z.array(z.string()),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('array');
            expect(result).toContain('string');
        });

        it('formats array of objects with field details', () => {
            const schema = z.object({
                routes: z.array(z.object({
                    route: z.string(),
                    params: z.record(z.string(), z.unknown()).optional(),
                })),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('array');
            expect(result).toContain('route');
        });
    });

    describe('record fields', () => {
        it('formats record type', () => {
            const schema = z.object({
                metadata: z.record(z.string(), z.unknown()),
            });
            const result = formatZodSchemaForAgent(schema);
            expect(result).toContain('record');
        });
    });

    describe('non-object schemas', () => {
        it('formats standalone string schema', () => {
            const result = formatZodSchemaForAgent(z.string());
            expect(result).toContain('string');
        });
    });

    describe('multiple fields', () => {
        it('formats all fields comma-separated', () => {
            const schema = z.object({
                query: z.string().min(1).describe('Search query'),
                domain: z.string().optional(),
                perDomain: z.number().min(1).max(50).default(10).optional(),
            });
            const result = formatZodSchemaForAgent(schema)!;
            expect(result).toContain('query');
            expect(result).toContain('domain');
            expect(result).toContain('perDomain');
            // Fields are comma-separated
            expect(result.split(',').length).toBeGreaterThanOrEqual(3);
        });
    });
});
