/**
 * Soul - OpenClaw SOUL.md equivalent
 *
 * Defines the persona, tone, and boundaries for an Ernesto instance.
 * Each user/coworker can have their own soul configuration.
 */

/**
 * Soul interface — maps to OpenClaw's SOUL.md
 */
export interface Soul {
    /** Display name (e.g., "Ernesto", "Piero") */
    name: string;

    /** Optional emoji for quick identification */
    emoji?: string;

    /** Persona description — injected into system prompt */
    persona: string;

    /** Communication style (e.g., "Direct, data-driven, no fluff") */
    tone?: string;

    /** Hard boundaries (e.g., "Never share PII or credentials") */
    boundaries?: string;
}

/**
 * Render a soul into system prompt text
 */
export function renderSoul(soul: Soul): string {
    const parts: string[] = [];

    parts.push(`# ${soul.emoji ? `${soul.emoji} ` : ''}${soul.name}`);
    parts.push('');
    parts.push(soul.persona);

    if (soul.tone) {
        parts.push('');
        parts.push(`**Tone:** ${soul.tone}`);
    }

    if (soul.boundaries) {
        parts.push('');
        parts.push(`**Boundaries:** ${soul.boundaries}`);
    }

    return parts.join('\n');
}
