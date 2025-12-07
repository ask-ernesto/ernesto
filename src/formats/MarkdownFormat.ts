/**
 * Markdown Format Adapter
 *
 * Parses markdown content into resource nodes.
 *
 * Options:
 * - `split`: Split into sections by heading (default: true)
 * - `routeType`: Output type - 'resource' or 'instruction' (default: 'resource')
 *
 * Examples:
 * ```typescript
 * new MarkdownFormat()                                           // Split into sections
 * new MarkdownFormat({ split: false })                           // Whole file
 * new MarkdownFormat({ split: false, routeType: 'instruction' }) // Whole file as instruction
 * ```
 */

import { basename } from 'path';
import { ResourceNode } from '../knowledge/types';
import { ContentFormat, RawContent } from '../knowledge/pipeline-types';
import type { RouteType } from '../types';

interface MarkdownFormatOptions {
    /** Split into sections by heading (default: true) */
    split?: boolean;
    /** Output route type (default: 'resource') */
    routeType?: RouteType;
}

interface FrontMatter {
    description?: string;
    unlocks?: string[];
    [key: string]: unknown;
}

/**
 * Extract YAML front-matter from markdown
 *
 * Handles edge case where front-matter starts with double delimiters:
 * ---
 * ---
 * description: |
 *   ...
 * ---
 *
 * In this case, we skip the empty front-matter and try again.
 */
function parseFrontMatter(markdown: string): {
    frontMatter: FrontMatter | null;
    body: string;
} {
    // First, handle the double-delimiter edge case: ---\n---\n becomes ---\n
    // This happens when Google Docs adds an empty line at the start
    let normalized = markdown;
    if (markdown.startsWith('---\n---\n')) {
        normalized = markdown.slice(4); // Remove the first "---\n"
    }

    const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!match) return { frontMatter: null, body: normalized };

    const yaml = match[1];
    const body = normalized.slice(match[0].length);

    // Description extraction - supports both single-line and multi-line YAML (|)
    let description: string | undefined;

    // Try multi-line YAML format first: description: |\n  indented lines...
    const multiLineMatch = yaml.match(/^description:\s*\|\s*\n((?:[ \t]+.+\n?)+)/m);
    if (multiLineMatch) {
        // Join indented lines into single description, preserving content
        description = multiLineMatch[1]
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .join(' ');
    } else {
        // Fall back to single-line format: description: value
        const singleLineMatch = yaml.match(/^description:\s*(.+)$/m);
        if (singleLineMatch) {
            description = singleLineMatch[1].trim().replace(/^["']|["']$/g, '');
        }
    }

    // Extract unlocks array (YAML list format)
    // Supports: unlocks:\n  - tool1\n  - tool2
    const unlocksMatch = yaml.match(/^unlocks:\s*\n((?:\s+-\s+.+\n?)+)/m);
    let unlocks: string[] | undefined;
    if (unlocksMatch) {
        unlocks = unlocksMatch[1]
            .split('\n')
            .map((line) => line.replace(/^\s+-\s+/, '').trim())
            .filter((line) => line.length > 0);
    }

    return { frontMatter: { description, unlocks }, body };
}

/**
 * Extract first paragraph as description fallback
 */
function extractFirstParagraph(markdown: string): string | undefined {
    // Skip heading, get first non-empty paragraph
    const match = markdown.match(/^(?:#[^\n]*\n+)?([^#\n][^\n]+)/m);
    if (!match) return undefined;

    const paragraph = match[1].trim();
    // First sentence or truncate
    const sentence = paragraph.match(/^[^.!?]+[.!?]/);
    if (sentence) return sentence[0].trim();
    if (paragraph.length > 150) return paragraph.slice(0, 150) + '...';
    return paragraph;
}

/**
 * Get name from heading or filename
 */
function extractName(markdown: string, fileName?: string): string {
    const heading = markdown.match(/^#\s+(.+)$/m);
    if (heading) return heading[1].trim();

    if (fileName) {
        return basename(fileName, '.md')
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }
    return 'Document';
}

export class MarkdownFormat implements ContentFormat {
    readonly name = 'markdown';
    private readonly split: boolean;
    private readonly routeType: RouteType;

    constructor(options: MarkdownFormatOptions = {}) {
        this.split = options.split ?? true;
        this.routeType = options.routeType ?? 'resource';
    }

    canHandle(contentType: string): boolean {
        return contentType === 'text/markdown' || contentType === 'text/plain' || contentType.includes('markdown');
    }

    parse(content: RawContent, basePath: string): ResourceNode[] {
        const raw = Buffer.isBuffer(content.content) ? content.content.toString('utf-8') : content.content;

        if (typeof raw !== 'string') {
            throw new Error('MarkdownFormat requires string content');
        }

        const { frontMatter, body } = parseFrontMatter(raw);
        const fileName = content.metadata?.fileName as string | undefined;
        const name = extractName(body, fileName);
        const description = frontMatter?.description || extractFirstParagraph(body);

        // No-split: single node for entire document
        if (!this.split) {
            return [
                {
                    id: basePath,
                    name,
                    path: basePath,
                    metadata: {
                        content: body,
                        description,
                        lastUpdated: content.metadata?.lastModified || new Date().toISOString(),
                        fileName,
                        ...(frontMatter?.unlocks && { unlocks: frontMatter.unlocks }),
                    },
                },
            ];
        }

        // Split: parse heading tree
        return this.parseWithHeadings(body, basePath, name, description);
    }

    private parseWithHeadings(markdown: string, basePath: string, docName: string, docDescription?: string): ResourceNode[] {
        const lines = markdown.split('\n');
        const tree = this.buildHeadingTree(lines);

        // No headings - single document
        if (tree.length === 0) {
            return [
                {
                    id: basePath,
                    name: docName,
                    path: basePath,
                    metadata: { content: markdown.trim(), description: docDescription },
                },
            ];
        }

        return this.treeToNodes(tree, basePath, docDescription);
    }

    private buildHeadingTree(lines: string[]): HeadingNode[] {
        const root: HeadingNode[] = [];
        const stack: HeadingNode[] = [];

        for (const line of lines) {
            const match = line.match(/^(#{1,6})\s+(.+)$/);

            if (match) {
                const node: HeadingNode = {
                    level: match[1].length,
                    text: match[2].trim(),
                    slug: match[2]
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, '-'),
                    children: [],
                    content: [],
                };

                while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    root.push(node);
                } else {
                    stack[stack.length - 1].children.push(node);
                }
                stack.push(node);
            } else if (stack.length > 0) {
                stack[stack.length - 1].content.push(line);
            }
        }

        return root;
    }

    private treeToNodes(headings: HeadingNode[], basePath: string, rootDescription?: string, parentPath = ''): ResourceNode[] {
        return headings.map((h, i) => {
            const path = parentPath ? `${parentPath}/${h.slug}` : `${basePath}/${h.slug}`;
            const content = this.renderHeading(h);
            const isRoot = h.level === 1 && !parentPath && i === 0;

            const node: ResourceNode = {
                id: path,
                name: h.text,
                path,
                metadata: {
                    content,
                    headingLevel: h.level,
                    ...(isRoot && rootDescription ? { description: rootDescription } : {}),
                },
            };

            if (h.children.length > 0) {
                node.children = this.treeToNodes(h.children, basePath, undefined, path);
            }

            return node;
        });
    }

    private renderHeading(h: HeadingNode): string {
        let result = `${'#'.repeat(h.level)} ${h.text}\n\n`;
        const text = h.content.join('\n').trim();
        if (text) result += `${text}\n\n`;
        for (const child of h.children) {
            result += this.renderHeading(child);
        }
        return result.trim();
    }
}

interface HeadingNode {
    level: number;
    text: string;
    slug: string;
    children: HeadingNode[];
    content: string[];
}
