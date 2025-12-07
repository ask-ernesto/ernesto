/**
 * Resource Helper Functions
 *
 * Pure utility functions for working with ResourceNode trees.
 * Used by base domain classes for content building, size calculation, and tree traversal.
 */

import { ResourceNode } from './types';

/**
 * Recursively build markdown content from a node and all its descendants.
 *
 * For leaf nodes: Returns the node's content
 * For parent nodes: Returns node's content + all children's content (full downstream tree)
 */
export function buildContent(node: ResourceNode, depth = 0): string {
    let content = '';

    // Add this node's content
    if (node.metadata?.content) {
        content += node.metadata.content;
    } else {
        // Fallback: build from node structure
        const headingLevel = '#'.repeat(Math.min(depth + 1, 6));
        content += `${headingLevel} ${node.name}\n\n`;

        if (node.metadata?.description) {
            content += `${node.metadata.description}\n\n`;
        }

        // Add metadata as frontmatter if available
        const metadataKeys = Object.keys(node.metadata || {}).filter((k) => k !== 'content' && k !== 'description');
        if (metadataKeys.length > 0) {
            content += '---\n';
            for (const key of metadataKeys) {
                content += `${key}: ${JSON.stringify(node.metadata[key])}\n`;
            }
            content += '---\n\n';
        }
    }

    // Recursively add all children's content (full downstream tree)
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            content += '\n\n';
            content += buildContent(child, depth + 1);
        }
    }

    return content.trim();
}
