import { InstructionContext, InstructionTemplate } from './types';

/**
 * Simple template variable interpolation
 * Supports: {{variable}}, {{variable|default}}
 */
export function interpolate(template: string, context: InstructionContext): string {
    return template.replace(/\{\{([^}|]+)(\|([^}]+))?\}\}/g, (match, key, _, defaultValue) => {
        const value = context[key.trim()];
        if (value === undefined || value === null) {
            return defaultValue !== undefined ? defaultValue.trim() : match;
        }
        return String(value);
    });
}

/**
 * Render instruction template with context
 */
export function renderInstructionTemplate(template: InstructionTemplate, context: InstructionContext): string {
    if (typeof template === 'function') {
        return template(context);
    }
    return interpolate(template, context);
}
