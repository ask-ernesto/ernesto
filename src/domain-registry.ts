/**
 * Domain Registry
 *
 * Central registry for domain configurations.
 * Prevents circular dependencies by separating domain storage from domain definitions.
 */

import { Domain } from './domain';
import { generateSourceId } from './pipelines';
import { DEFAULT_CACHE_TTL_MS, PipelineConfig } from './types';
import debug from 'debug';

const log = debug('ernesto:domain-registry');

/**
 * Global domain registry
 */
export class DomainRegistry {
    private domains = new Map<string, Domain>();

    /**
     * Register a domain
     */
    register(domain: Domain): void {
        if (this.domains.has(domain.name)) {
            log('Overwriting existing domain', { domain: domain.name });
        }

        this.domains.set(domain.name, domain);
        log('Registered domain', { domain: domain.name });
    }

    /**
     * Register multiple domains
     */
    registerAll(domains: Domain[]): void {
        for (const domain of domains) {
            this.register(domain);
        }
    }

    /**
     * Get domain by name
     */
    get(name: string): Domain | undefined {
        return this.domains.get(name);
    }

    /**
     * Get all registered domains
     */
    getAll(): Domain[] {
        return Array.from(this.domains.values());
    }

    /**
     * Check if domain exists
     */
    has(name: string): boolean {
        return this.domains.has(name);
    }

    /**
     * Get all sources across all domains
     */
    getAllSources(): SourceInfo[] {
        const result: SourceInfo[] = [];

        for (const domain of this.domains.values()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                const sourceId = generateSourceId(extractor.source.name, extractor.basePath || '');
                const isLocal = extractor.source.name.startsWith('local:');

                result.push({
                    sourceId,
                    domain: domain.name,
                    sourceName: extractor.source.name,
                    isLocal,
                    cacheTtlMs: extractor.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
                });
            }
        }

        return result;
    }

    /**
     * Find a source by ID
     */
    findSource(sourceId: string): { domainName: string; extractor: PipelineConfig } | null {
        for (const domain of this.domains.values()) {
            if (!domain.extractors) continue;

            for (const extractor of domain.extractors) {
                const id = generateSourceId(extractor.source.name, extractor.basePath || '');
                if (id === sourceId) {
                    return { domainName: domain.name, extractor };
                }
            }
        }

        return null;
    }
}

export interface SourceInfo {
    sourceId: string;
    domain: string;
    sourceName: string;
    isLocal: boolean;
    cacheTtlMs: number;
}
