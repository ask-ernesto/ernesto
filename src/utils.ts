/**
 * Ernesto utilities
 */

import { ResourceNode } from './types';

/**
 * Truncate text to a reasonable length, preferring sentence boundaries
 */
export function truncateText(text: string, maxLength = 200): string {
    if (!text || text.length <= maxLength) {
        return text;
    }

    const truncated = text.slice(0, maxLength);
    const lastSentence = truncated.match(/^.*[.!?]/);

    if (lastSentence && lastSentence[0].length > 50) {
        return lastSentence[0].trim();
    }

    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 50) {
        return truncated.slice(0, lastSpace).trim() + '...';
    }

    return truncated.trim() + '...';
}

/**
 * Flatten nested resources into a single array
 */
export function flattenResources(resources: ResourceNode[]): ResourceNode[] {
    const result: ResourceNode[] = [];
    for (const resource of resources) {
        result.push(resource);
        if (resource.children) {
            result.push(...flattenResources(resource.children));
        }
    }
    return result;
}
