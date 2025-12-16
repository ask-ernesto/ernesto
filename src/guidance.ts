/**
 * Guidance Generator
 *
 * Builds contextual guidance sections for route responses.
 * When a route has guidance and includeGuidance is enabled,
 * this module generates the guidance markdown that helps agents
 * understand what routes are available next and how to use them.
 *
 * The guidance system is simple: a list of { route, prose } pairs.
 * The prose explains when and how to use each route in context.
 */

import { RouteGuidance } from './route';

/**
 * Route info for guidance display
 */
export interface RouteInfo {
    route: string;
    description: string;
    inputSchema?: string;
    freshness?: string;
}

/**
 * Route lookup function type
 *
 * Given a route URI, returns route info if available.
 * Used to look up schemas and descriptions for guidance entries.
 */
export type RouteLookup = (route: string) => RouteInfo | undefined;

/**
 * Build guidance section from route guidance array
 *
 * For each guidance entry:
 * 1. Look up route in registry for schema
 * 2. Format as markdown with prose and parameters
 *
 * @param guidance - Array of { route, prose } pairs
 * @param routeLookup - Function to look up route info (schema, description)
 * @returns Markdown string with "What's Next" section
 */
export function buildGuidanceSection(
    guidance: RouteGuidance[],
    routeLookup: RouteLookup
): string {
    if (guidance.length === 0) return '';

    const parts: string[] = [];
    parts.push('---');
    parts.push('');
    parts.push("## What's Next");
    parts.push('');

    for (const entry of guidance) {
        const routeInfo = routeLookup(entry.route);

        // Format: **`route`** - prose
        parts.push(`- **\`${entry.route}\`** - ${entry.prose}`);

        // Add parameters if available (compact format, indented)
        if (routeInfo?.inputSchema) {
            parts.push(`  *Parameters: ${routeInfo.inputSchema}*`);
        }
    }

    parts.push('');
    return parts.join('\n');
}
