/**
 * Local Filesystem Source Adapter
 *
 * Reads documents from the local filesystem.
 *
 * Philosophy:
 * - Simple, synchronous filesystem operations
 * - Recursively discovers files in directory tree
 * - Preserves directory structure in paths
 * - Content type detection from file extensions
 *
 * Use cases:
 * - Static documentation (striga docs, legal docs)
 * - Configuration files
 * - Local markdown repositories
 *
 * Example:
 * ```typescript
 * const source = new LocalSource('/docs/legal', {
 *   extensions: ['.md', '.markdown'],
 *   recursive: true
 * });
 * ```
 */

import { readFileSync, readdirSync, lstatSync, existsSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { ContentSource, RawDocument, RawContent } from '../knowledge/pipeline-types';
import debug from 'debug';

const log = debug('ernesto:local-source');

export interface LocalSourceConfig {
    /** File extensions to include (e.g., ['.md', '.txt']) */
    extensions?: string[];

    /** Whether to recursively scan subdirectories */
    recursive?: boolean;

    /** Base path to strip from document paths (defaults to rootDir) */
    basePath?: string;
}

export class LocalSource implements ContentSource {
    readonly name: string;
    private readonly config: Required<LocalSourceConfig>;
    private readonly contentTypeMap: Record<string, string> = {
        '.md': 'text/markdown',
        '.markdown': 'text/markdown',
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.json': 'application/json',
        '.csv': 'text/csv',
    };

    constructor(
        private readonly rootDir: string,
        config: LocalSourceConfig = {},
    ) {
        if (!existsSync(rootDir)) {
            throw new Error(`Path does not exist: ${rootDir}`);
        }

        this.name = `local:${rootDir}`;
        this.config = {
            extensions: config.extensions || ['.md', '.markdown'],
            recursive: config.recursive !== undefined ? config.recursive : true,
            basePath: config.basePath || rootDir,
        };
    }

    async listDocuments(): Promise<RawDocument[]> {
        const documents: RawDocument[] = [];

        // Check if rootDir is a file or directory
        const stat = lstatSync(this.rootDir);

        if (stat.isFile()) {
            // Handle single file
            const ext = extname(this.rootDir);
            if (this.config.extensions.includes(ext)) {
                const name = basename(this.rootDir, ext);
                const contentType = this.getContentType(ext);
                const relativePath = relative(this.config.basePath, this.rootDir);
                const pathWithoutExt = relativePath.replace(new RegExp(`\\${ext}$`), '');

                documents.push({
                    id: this.rootDir, // Use absolute path as ID
                    name,
                    path: `/${pathWithoutExt}`,
                    contentType,
                    metadata: {
                        fullPath: this.rootDir,
                        extension: ext,
                        size: stat.size,
                        modified: stat.mtime,
                    },
                });
            }
        } else if (stat.isDirectory()) {
            // Handle directory
            this.scanDirectory(this.rootDir, documents);
        }

        return documents;
    }

    async fetchContent(docId: string): Promise<RawContent> {
        // docId is the absolute file path
        if (!existsSync(docId)) {
            throw new Error(`Document not found: ${docId}`);
        }

        const content = readFileSync(docId, 'utf-8');
        const ext = extname(docId);
        const contentType = this.getContentType(ext);

        return {
            content,
            contentType,
            metadata: {
                filePath: docId,
                fileSize: content.length,
            },
        };
    }

    /**
     * Recursively scan directory for matching files
     */
    private scanDirectory(dir: string, documents: RawDocument[]): void {
        try {
            const entries = readdirSync(dir);

            for (const entry of entries) {
                const fullPath = join(dir, entry);
                const stat = lstatSync(fullPath);

                if (stat.isDirectory()) {
                    if (this.config.recursive) {
                        this.scanDirectory(fullPath, documents);
                    }
                } else if (stat.isFile()) {
                    const ext = extname(entry);

                    if (this.config.extensions.includes(ext)) {
                        const relativePath = relative(this.config.basePath, fullPath);
                        const name = basename(entry, ext);
                        const contentType = this.getContentType(ext);

                        // Strip extension from path for clean URIs
                        // e.g., /docs/knowledge.md → /docs/knowledge
                        const pathWithoutExt = relativePath.replace(new RegExp(`\\${ext}$`), '');

                        documents.push({
                            id: fullPath, // Use absolute path as ID
                            name,
                            path: `/${pathWithoutExt}`,
                            contentType,
                            metadata: {
                                fullPath,
                                extension: ext,
                                size: stat.size,
                                modified: stat.mtime,
                            },
                        });
                    }
                }
            }
        } catch (error) {
            log('Error scanning directory', { dir, error });
        }
    }

    /**
     * Get content type from file extension
     */
    private getContentType(extension: string): string {
        return this.contentTypeMap[extension.toLowerCase()] || 'text/plain';
    }
}
