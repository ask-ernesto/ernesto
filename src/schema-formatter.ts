/**
 * Schema Formatter
 *
 * Transforms Zod schemas into human-readable, agent-friendly documentation.
 * Makes it clear what parameters are needed and what they do.
 */

import { z } from 'zod';

/**
 * Format a Zod schema into agent-friendly documentation
 *
 * Transforms formal Zod schemas into readable, actionable format that agents can understand.
 *
 * @param schema - Zod schema to format
 * @param name - Optional name for the schema
 * @returns Human-readable schema documentation
 */
export function formatZodSchemaForAgent(schema: z.ZodSchema | undefined, name?: string): string | undefined {
    if (!schema) {
        return undefined;
    }

    try {
        // Handle void/undefined schemas
        if (schema instanceof z.ZodVoid || schema instanceof z.ZodUndefined) {
            return 'No parameters required';
        }

        // Handle object schemas (most common for route inputs)
        if (schema instanceof z.ZodObject) {
            return formatZodObject(schema);
        }

        // Handle other types
        return formatZodType(schema);
    } catch (error: any) {
        // Fallback to simple type description with error for debugging
        console.error('[schema-formatter] Error formatting schema:', error.message, error.stack);
        return `Schema: ${schema.constructor.name}`;
    }
}

/**
 * Format a Zod object schema (compact format)
 */
function formatZodObject(schema: z.ZodObject<any>): string {
    try {
        const shape = schema.shape;
        const keys = Object.keys(shape);

        if (keys.length === 0) {
            return 'No parameters required';
        }

        const fields: string[] = [];

        for (const key of keys) {
            const fieldSchema = shape[key];
            const fieldInfo = formatFieldCompact(key, fieldSchema);
            fields.push(fieldInfo);
        }

        // Return compact comma-separated list
        return fields.join(', ');
    } catch (error: any) {
        console.error('[schema-formatter] Error in formatZodObject:', error.message);
        throw error;
    }
}

/**
 * Format a single field (compact format)
 */
function formatFieldCompact(name: string, schema: z.ZodSchema): string {
    const type = getFieldType(schema);
    const description = getFieldDescription(schema);
    const defaultValue = getFieldDefault(schema);
    const isOptional = schema instanceof z.ZodOptional || schema.isOptional?.();

    const parts: string[] = [name, type];

    // Add optional/required indicator
    if (isOptional) {
        parts.push('optional');
    }

    // Add default value if present
    if (defaultValue !== undefined) {
        parts.push(`default: ${JSON.stringify(defaultValue)}`);
    }

    // Build base string
    let fieldStr = `${parts[0]}: ${parts.slice(1).join(', ')}`;

    // Add description if present
    if (description) {
        fieldStr += ` - ${description}`;
    }

    return fieldStr;
}

/**
 * Get human-readable type for a schema
 */
function getFieldType(schema: z.ZodSchema): string {
    // Unwrap optional
    let baseSchema: any = schema;
    if (schema instanceof z.ZodOptional) {
        baseSchema = (schema as any)._def.innerType;
    }

    // Unwrap default
    if (baseSchema instanceof z.ZodDefault) {
        baseSchema = (baseSchema as any)._def.innerType;
    }

    // Check type
    if (baseSchema instanceof z.ZodString) {
        const checks: any[] = baseSchema._def.checks || [];
        const minCheck: any = checks.find((c: any) => c.kind === 'min');
        const maxCheck: any = checks.find((c: any) => c.kind === 'max');

        if (minCheck || maxCheck) {
            const constraints: string[] = [];
            if (minCheck) constraints.push(`min ${minCheck.value}`);
            if (maxCheck) constraints.push(`max ${maxCheck.value}`);
            return `string (${constraints.join(', ')})`;
        }
        return 'string';
    }

    if (baseSchema instanceof z.ZodNumber) {
        const checks: any[] = baseSchema._def.checks || [];
        const minCheck: any = checks.find((c: any) => c.kind === 'min');
        const maxCheck: any = checks.find((c: any) => c.kind === 'max');

        if (minCheck || maxCheck) {
            const constraints: string[] = [];
            if (minCheck) constraints.push(`min ${minCheck.value}`);
            if (maxCheck) constraints.push(`max ${maxCheck.value}`);
            return `number (${constraints.join(', ')})`;
        }
        return 'number';
    }

    if (baseSchema instanceof z.ZodBoolean) {
        return 'boolean';
    }

    if (baseSchema instanceof z.ZodEnum) {
        // Try multiple ways to extract enum values
        const def = (baseSchema as any)._def;

        // Try _def.entries (modern zod enum format)
        let values = def.entries;

        // Fall back to _def.values (older format)
        if (!values) {
            values = def.values;
        }

        // Fall back to _def.options (alternative format)
        if (!values) {
            values = def.options;
        }

        if (Array.isArray(values)) {
            return `enum: ${values.map((v: any) => `"${v}"`).join(' | ')}`;
        } else if (values && typeof values === 'object') {
            return `enum: ${Object.values(values).map((v: any) => `"${v}"`).join(' | ')}`;
        }

        return 'enum';
    }

    if (baseSchema instanceof z.ZodArray) {
        const elementType = getFieldType((baseSchema as any)._def.type as z.ZodSchema);
        return `array of ${elementType}`;
    }

    if (baseSchema instanceof z.ZodObject) {
        return 'object';
    }

    if (baseSchema instanceof z.ZodRecord) {
        return 'record (key-value pairs)';
    }

    if (baseSchema instanceof z.ZodAny) {
        return 'any';
    }

    if (baseSchema instanceof z.ZodUnknown) {
        return 'unknown';
    }

    // Fallback
    return baseSchema.constructor.name.replace('Zod', '').toLowerCase();
}

/**
 * Get description from schema
 */
function getFieldDescription(schema: z.ZodSchema): string | undefined {
    try {
        return (schema as any)._def.description;
    } catch {
        return undefined;
    }
}

/**
 * Get default value from schema
 */
function getFieldDefault(schema: z.ZodSchema): any {
    try {
        if (schema instanceof z.ZodDefault) {
            const defaultValue = (schema as any)._def.defaultValue;
            return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

/**
 * Format a non-object Zod type
 */
function formatZodType(schema: z.ZodSchema): string {
    const type = getFieldType(schema);
    const description = getFieldDescription(schema);

    if (description) {
        return `${type} - ${description}`;
    }

    return type;
}
