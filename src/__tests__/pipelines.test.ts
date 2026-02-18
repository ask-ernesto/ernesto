import { vi } from 'vitest';
import { ContentPipeline, generateSourceId } from '../pipelines';
import { ContentSource, ContentFormat, RawDocument, ResourceNode } from '../types';
import { createTestSource, createTestFormat, createTestPipelineConfig } from './helpers';

describe('generateSourceId', () => {
    it('generates deterministic ID from source name and path', () => {
        const id = generateSourceId('GitHub', '/prs/backend');
        expect(id).toBe('github__/prs/backend'.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^(.+?)__/, (_, p1) => p1 + '__'));
        // Just check it's deterministic
        expect(generateSourceId('GitHub', '/prs/backend')).toBe(id);
    });

    it('normalizes special characters', () => {
        const id = generateSourceId('My Source!', 'path/to/docs');
        expect(id).not.toContain('!');
        expect(id).not.toContain('/');
    });

    it('uses "root" for empty basePath', () => {
        const id = generateSourceId('test', '');
        expect(id).toContain('root');
    });

    it('lowercases everything', () => {
        const id = generateSourceId('GitHub', 'MyPath');
        expect(id).toBe(id.toLowerCase());
    });
});

describe('ContentPipeline', () => {
    it('throws if no formats provided', () => {
        expect(() => new ContentPipeline({
            source: createTestSource(),
            formats: [],
        })).toThrow('at least one format');
    });

    it('generates sourceId from source name and basePath', () => {
        const pipeline = new ContentPipeline({
            source: createTestSource('my-source'),
            formats: [createTestFormat()],
            basePath: '/docs',
        });
        expect(pipeline.sourceId).toBe(generateSourceId('my-source', '/docs'));
    });

    describe('fetchResources', () => {
        it('returns empty array when source has no documents', async () => {
            const pipeline = new ContentPipeline(createTestPipelineConfig());
            const result = await pipeline.fetchResources();
            expect(result).toEqual([]);
        });

        it('processes documents through matching format', async () => {
            const doc: RawDocument = { id: 'doc1', name: 'Test Doc', path: '/test', contentType: 'text/plain' };

            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return [doc]; },
                async fetchContent() { return { content: '# Hello\nWorld', contentType: 'text/plain' }; },
            };

            const nodes: ResourceNode[] = [{
                id: '/test',
                name: 'Hello',
                path: '/test',
                content: '# Hello\nWorld',
            }];

            const format: ContentFormat = {
                name: 'test-format',
                canHandle: (ct) => ct === 'text/plain',
                parse: () => nodes,
            };

            const pipeline = new ContentPipeline({ source, formats: [format] });
            const result = await pipeline.fetchResources();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Hello');
        });

        it('skips documents with no matching format', async () => {
            const doc: RawDocument = { id: 'doc1', name: 'Test', path: '/test', contentType: 'application/json' };

            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return [doc]; },
                async fetchContent() { return { content: '{}', contentType: 'application/json' }; },
            };

            const format: ContentFormat = {
                name: 'markdown',
                canHandle: (ct) => ct === 'text/markdown',
                parse: () => [],
            };

            const pipeline = new ContentPipeline({ source, formats: [format] });
            const result = await pipeline.fetchResources();
            expect(result).toEqual([]);
        });

        it('continues processing when individual document fails', async () => {
            const docs: RawDocument[] = [
                { id: 'good', name: 'Good', path: '/good', contentType: 'text/plain' },
                { id: 'bad', name: 'Bad', path: '/bad', contentType: 'text/plain' },
            ];

            let callCount = 0;
            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return docs; },
                async fetchContent(id) {
                    callCount++;
                    if (id === 'bad') throw new Error('fetch failed');
                    return { content: 'good content', contentType: 'text/plain' };
                },
            };

            const format: ContentFormat = {
                name: 'test-format',
                canHandle: () => true,
                parse: (content) => [{
                    id: 'node',
                    name: 'Node',
                    path: '/node',
                    content: content.content as string,
                }],
            };

            const pipeline = new ContentPipeline({ source, formats: [format] });
            const result = await pipeline.fetchResources();

            expect(callCount).toBe(2);
            expect(result).toHaveLength(1);
        });

        it('attaches sourceId to all resources recursively', async () => {
            const doc: RawDocument = { id: 'doc1', name: 'Doc', path: '/doc', contentType: 'text/plain' };

            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return [doc]; },
                async fetchContent() { return { content: 'content', contentType: 'text/plain' }; },
            };

            const childNode: ResourceNode = { id: 'child', name: 'Child', path: '/child', content: 'child content' };
            const parentNode: ResourceNode = {
                id: 'parent',
                name: 'Parent',
                path: '/parent',
                content: 'parent content',
                children: [childNode],
            };

            const format: ContentFormat = {
                name: 'test-format',
                canHandle: () => true,
                parse: () => [parentNode],
            };

            const pipeline = new ContentPipeline({ source, formats: [format] });
            const result = await pipeline.fetchResources();

            expect(result[0].metadata?.sourceId).toBe(pipeline.sourceId);
            expect(result[0].children![0].metadata?.sourceId).toBe(pipeline.sourceId);
        });

        it('throws when source.listDocuments fails', async () => {
            const source: ContentSource = {
                name: 'failing-source',
                async listDocuments() { throw new Error('connection failed'); },
                async fetchContent() { return { content: '', contentType: 'text/plain' }; },
            };

            const pipeline = new ContentPipeline({ source, formats: [createTestFormat()] });
            await expect(pipeline.fetchResources()).rejects.toThrow('ContentPipeline failed');
        });

        it('uses first matching format when multiple formats registered', async () => {
            const doc: RawDocument = { id: 'doc1', name: 'Doc', path: '/doc', contentType: 'text/plain' };

            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return [doc]; },
                async fetchContent() { return { content: 'content', contentType: 'text/plain' }; },
            };

            const format1: ContentFormat = {
                name: 'first',
                canHandle: () => true,
                parse: () => [{ id: 'from-first', name: 'First', path: '/first', content: 'first' }],
            };

            const format2: ContentFormat = {
                name: 'second',
                canHandle: () => true,
                parse: () => [{ id: 'from-second', name: 'Second', path: '/second', content: 'second' }],
            };

            const pipeline = new ContentPipeline({ source, formats: [format1, format2] });
            const result = await pipeline.fetchResources();

            expect(result[0].id).toBe('from-first');
        });
    });

    describe('buildDocumentPath', () => {
        it('builds path with basePath', async () => {
            const doc: RawDocument = { id: 'doc1', name: 'Doc', path: 'meetings/notes', contentType: 'text/plain' };

            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return [doc]; },
                async fetchContent() { return { content: 'c', contentType: 'text/plain' }; },
            };

            const parseSpy = vi.fn().mockReturnValue([]);
            const format: ContentFormat = {
                name: 'test',
                canHandle: () => true,
                parse: parseSpy,
            };

            const pipeline = new ContentPipeline({ source, formats: [format], basePath: '/resources' });
            await pipeline.fetchResources();

            // parse is called with (content, basePath)
            expect(parseSpy).toHaveBeenCalledWith(
                expect.anything(),
                '/resources/meetings/notes',
            );
        });

        it('handles leading slashes in doc path', async () => {
            const doc: RawDocument = { id: 'doc1', name: 'Doc', path: '/already/slashed', contentType: 'text/plain' };

            const source: ContentSource = {
                name: 'test-source',
                async listDocuments() { return [doc]; },
                async fetchContent() { return { content: 'c', contentType: 'text/plain' }; },
            };

            const parseSpy = vi.fn().mockReturnValue([]);
            const format: ContentFormat = {
                name: 'test',
                canHandle: () => true,
                parse: parseSpy,
            };

            const pipeline = new ContentPipeline({ source, formats: [format], basePath: '/base' });
            await pipeline.fetchResources();

            // Should not have double slashes
            const calledPath = parseSpy.mock.calls[0][1];
            expect(calledPath).not.toContain('//');
            expect(calledPath).toBe('/base/already/slashed');
        });
    });

    describe('getSummary', () => {
        it('returns pipeline configuration', () => {
            const pipeline = new ContentPipeline({
                source: createTestSource('my-source'),
                formats: [createTestFormat('md'), createTestFormat('csv')],
                basePath: '/docs',
            });

            const summary = pipeline.getSummary();
            expect(summary.source).toBe('my-source');
            expect(summary.formats).toEqual(['md', 'csv']);
            expect(summary.basePath).toBe('/docs');
            expect(summary.sourceId).toBe(pipeline.sourceId);
        });
    });
});
