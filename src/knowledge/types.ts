/**
 * Core types for the Universal Synced Resources system
 * These are source-agnostic and work with any hierarchical document provider
 */

/**
 * Generic resource node representing any document, folder, page, or item
 * Works with ClickUp, Google Drive, Notion, Confluence, etc.
 */
export interface ResourceNode<TMeta = any> {
    /** Unique identifier from the source system */
    id: string;

    /** Human-readable name */
    name: string;

    /** Full path in the hierarchy (e.g., "/Folder/Document/Page") */
    path: string;

    /** Optional source-specific metadata */
    metadata?: TMeta;

    /** Optional child resources (for hierarchical structures) */
    children?: ResourceNode<TMeta>[];
}
