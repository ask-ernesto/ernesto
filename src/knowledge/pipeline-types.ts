/**
 * Two-Layer Adapter Architecture for Synced Resources
 *
 * Philosophy:
 * - Source adapters handle WHERE content comes from (ClickUp, Drive, filesystem)
 * - Format adapters handle HOW to interpret content (markdown, GDoc, PDF)
 * - Complete separation of concerns enables composition and reusability
 *
 * Example compositions:
 * - ClickUpSource + MarkdownFormat = Markdown docs from ClickUp
 * - LocalSource + MarkdownFormat = Markdown docs from filesystem
 * - DriveSource + GDocFormat = Google Docs from Drive
 */

import { ResourceNode } from './types';

/**
 * Represents a document as discovered by a source adapter
 * This is metadata only - no content yet
 */
export interface RawDocument {
    /** Unique identifier within the source system */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /** Hierarchical path within the source (e.g., "/folder/subfolder/doc") */
    readonly path: string;

    /** Content type for format selection (e.g., "text/markdown", "application/vnd.google-apps.document") */
    readonly contentType: string;

    /** Optional source-specific metadata */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Represents the actual content of a document
 * Fetched by source adapter, parsed by format adapter
 */
export interface RawContent {
    /** The raw content (text or binary) */
    readonly content: string | Buffer;

    /** Content type matching the document's contentType */
    readonly contentType: string;

    /** Optional content-specific metadata (e.g., last modified, author) */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Source Adapter: Handles WHERE content comes from
 *
 * Responsibilities:
 * - Connect to external systems (APIs, filesystems, databases)
 * - List available documents
 * - Fetch raw content
 * - Handle authentication, rate limiting, errors
 *
 * Does NOT:
 * - Parse or interpret content
 * - Understand content structure
 * - Create resource trees
 */
export interface ContentSource {
    /** Source name for logging and debugging */
    readonly name: string;

    /** The interval at which to refresh the source in milliseconds (default: no refresh) */
    readonly ttl?: number;

    /**
     * List all available documents from this source
     * Should return metadata only, not fetch full content
     */
    listDocuments(): Promise<RawDocument[]>;

    /**
     * Fetch raw content for a specific document
     *
     * @param docId - The document ID from listDocuments()
     * @returns Raw content ready for format adapter
     */
    fetchContent(docId: string): Promise<RawContent>;
}

/**
 * Format Adapter: Handles HOW to interpret content
 *
 * Responsibilities:
 * - Parse raw content into structured tree
 * - Extract hierarchy (headings, sections, pages)
 * - Generate resource nodes with proper paths
 *
 * Does NOT:
 * - Fetch content from sources
 * - Handle network/filesystem operations
 * - Know where content came from
 */
export interface ContentFormat {
    /** Format name for logging and debugging */
    readonly name: string;

    /**
     * Check if this format can handle a given content type
     *
     * @param contentType - MIME-like content type string
     * @returns true if this format can parse this content type
     *
     * @example
     * canHandle('text/markdown') // true for MarkdownFormat
     * canHandle('application/vnd.google-apps.document') // true for GDocFormat
     */
    canHandle(contentType: string): boolean;

    /**
     * Parse raw content into resource tree
     *
     * @param content - Raw content from source adapter
     * @param basePath - Base path to prepend to all resource paths
     * @returns Array of resource nodes (may be hierarchical)
     *
     * @example
     * // Markdown with ## headings becomes:
     * parse(markdownContent, '/docs')
     * → [{ path: '/docs/section-1', children: [...] }]
     */
    parse(content: RawContent, basePath: string): ResourceNode[] | Promise<ResourceNode[]>;
}

/** Default cache TTL: 4 hours */
export const DEFAULT_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Pipeline Configuration
 * Composes source + formats into a complete content pipeline
 */
export interface PipelineConfig {
    /** Where to fetch content from */
    source: ContentSource;

    /** How to parse content (can be multiple, selected by contentType) */
    formats: ContentFormat[];

    /** Base path for all resources from this pipeline */
    basePath?: string;

    /**
     * Batch description for all routes generated from this source
     *
     * This description applies to ALL routes created from this extractor,
     * eliminating repetition and providing context about the batch.
     *
     * Examples:
     * - "Test cases from project - includes authentication, payment flows, and edge cases"
     * - "Transcript of Product Sync meeting from 2025-01-15"
     * - "UX research on checkout flow from August 2024"
     * - "Marketing campaign briefs for Q1 2025"
     */
    description?: string;

    /** Cache time-to-live in milliseconds (default: 4 hours) */
    cacheTtlMs?: number;
}
