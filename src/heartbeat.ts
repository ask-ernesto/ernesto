/**
 * Heartbeat - OpenClaw heartbeat/cron equivalent
 *
 * Periodic agent turns for monitoring and system checks.
 * Configured per-coworker or at the org level.
 */

/**
 * Time window for active hours
 */
export interface TimeWindow {
    /** Start hour (0-23) */
    start: number;
    /** End hour (0-23) */
    end: number;
    /** Timezone (e.g., 'Europe/Stockholm') */
    tz: string;
}

/**
 * Heartbeat configuration — maps to OpenClaw's HEARTBEAT.md
 */
export interface HeartbeatConfig {
    /** Whether heartbeat is enabled */
    enabled: boolean;

    /** Frequency (e.g., '30m', '1h', '4h') */
    every: string;

    /** Only run during these hours */
    activeHours?: TimeWindow;

    /** Heartbeat checklist/prompt (like HEARTBEAT.md content) */
    checklist?: string;

    /** Skills to load during heartbeat turns */
    skills?: string[];

    /** Channel to deliver alerts to */
    target?: string;

    /** Custom heartbeat prompt */
    prompt?: string;
}
