/**
 * Output Formatters
 *
 * Tools can opt into output formatters to transform their raw output
 * into more token-efficient or user-friendly formats.
 *
 * Example:
 * - TOON format: 30-40% token reduction for tabular data
 * - CSV format: Compact representation for spreadsheet-like data
 * - Markdown format: Human-readable formatting
 */

import { encode as encodeToon } from '@toon-format/toon';
import debug from 'debug';

const log = debug('ernesto:utils');

/**
 * Named output formatters
 */
type OutputFormatterName = 'toon' | 'json' | 'markdown' | 'csv';

/**
 * Custom output formatter function
 */
type OutputFormatterFunction = (output: unknown) => string;

/**
 * Output formatter configuration for routes
 */
export type OutputFormatter = OutputFormatterName | OutputFormatterFunction;

/**
 * Format output using TOON (Token-Oriented Object Notation)
 *
 * TOON reduces token usage by 30-40% for tabular data compared to JSON.
 * Ideal for database query results, API responses with arrays of objects.
 *
 * @param output - Raw output (typically { rows: [...] } or similar structure)
 * @returns TOON-formatted string
 */
function formatAsToon(output: unknown): string {
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

/**
 * Format output as JSON (default)
 */
function formatAsJson(output: unknown): string {
    return JSON.stringify(output, null, 2);
}

/**
 * Format output as CSV
 *
 * Converts array of objects to CSV format.
 * First row is headers, subsequent rows are values.
 */
export function formatAsCsv(output: unknown): string {
    try {
        let rows: Record<string, unknown>[];

        // Extract rows from different structures
        if (typeof output === 'object' && output !== null && 'rows' in output) {
            rows = (output as any).rows;
        } else if (Array.isArray(output)) {
            rows = output;
        } else {
            return JSON.stringify(output, null, 2);
        }

        if (!rows || rows.length === 0) {
            return 'No data';
        }

        // Extract headers from first row
        const headers = Object.keys(rows[0]);
        const headerRow = headers.join(',');

        // Build data rows
        const dataRows = rows.map((row) =>
            headers
                .map((header) => {
                    const value = row[header];
                    // Quote strings containing commas or newlines
                    if (typeof value === 'string' && (value.includes(',') || value.includes('\n'))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                })
                .join(','),
        );

        return [headerRow, ...dataRows].join('\n');
    } catch (error) {
        log('CSV formatting failed', { error });
        return JSON.stringify(output, null, 2);
    }
}

/**
 * Format output as Markdown table
 *
 * Converts array of objects to a markdown table.
 */
export function formatAsMarkdown(output: unknown): string {
    try {
        let rows: Record<string, unknown>[];

        // Extract rows from different structures
        if (typeof output === 'object' && output !== null && 'rows' in output) {
            rows = (output as any).rows;
        } else if (Array.isArray(output)) {
            rows = output;
        } else {
            return '```json\n' + JSON.stringify(output, null, 2) + '\n```';
        }

        if (!rows || rows.length === 0) {
            return '_No data_';
        }

        // Extract headers from first row
        const headers = Object.keys(rows[0]);

        // Build header row
        const headerRow = '| ' + headers.join(' | ') + ' |';
        const separatorRow = '| ' + headers.map(() => '---').join(' | ') + ' |';

        // Build data rows
        const dataRows = rows.map((row) => '| ' + headers.map((header) => String(row[header] ?? '')).join(' | ') + ' |');

        return [headerRow, separatorRow, ...dataRows].join('\n');
    } catch (error) {
        log('Markdown formatting failed', { error });
        return '```json\n' + JSON.stringify(output, null, 2) + '\n```';
    }
}

/**
 * Apply output formatter to route output
 *
 * @param output - Raw route output
 * @param formatter - Formatter to apply (name or custom function)
 * @returns Formatted output string
 */
export function applyOutputFormatter(output: unknown, formatter: OutputFormatter): string {
    try {
        // Handle named formatters
        if (typeof formatter === 'string') {
            switch (formatter) {
                case 'toon':
                    return formatAsToon(output);
                case 'json':
                    return formatAsJson(output);
                case 'csv':
                    return formatAsCsv(output);
                case 'markdown':
                    return formatAsMarkdown(output);
                default:
                    log('Unknown formatter name', { formatter });
                    return formatAsJson(output);
            }
        }

        // Handle custom formatter function
        if (typeof formatter === 'function') {
            return formatter(output);
        }

        // Fallback
        return formatAsJson(output);
    } catch (error) {
        log('Formatting failed', { error, formatter });
        return JSON.stringify(output, null, 2);
    }
}
