/**
 * TOON Output Formatter
 *
 * TOON (Token-Oriented Object Notation) reduces token usage by 30-40%
 * for tabular data compared to JSON. Ideal for database query results,
 * API responses with arrays of objects.
 */

import { encode as encodeToon } from '@toon-format/toon';
import debug from 'debug';

const log = debug('ernesto:formatters');

/**
 * Format output using TOON (Token-Oriented Object Notation)
 *
 * TOON reduces token usage by 30-40% for tabular data compared to JSON.
 * Ideal for database query results, API responses with arrays of objects.
 *
 * @param output - Raw output (typically { rows: [...] } or similar structure)
 * @returns TOON-formatted string
 */
export function formatAsToon(output: unknown): string {
    try {
        // Handle different output structures
        if (typeof output === 'object' && output !== null) {
            // If output has a 'rows' property, encode that
            if ('rows' in output && Array.isArray(output.rows)) {
                const rows = output.rows;
                if (rows.length === 0) {
                    return 'No rows returned';
                }
                return encodeToon({ rows });
            }

            // If output is an array directly, encode it
            if (Array.isArray(output)) {
                if (output.length === 0) {
                    return 'No data returned';
                }
                return encodeToon({ rows: output });
            }

            // Otherwise encode the whole object
            return encodeToon(output);
        }

        // Fallback to JSON for non-object types
        return JSON.stringify(output, null, 2);
    } catch (error) {
        log('TOON encoding failed', { error });
        // Fallback to JSON on error
        return JSON.stringify(output, null, 2);
    }
}
