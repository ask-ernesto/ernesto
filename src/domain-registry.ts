/**
 * Domain Registry
 *
 * Central registry for domain configurations.
 * Prevents circular dependencies by separating domain storage from domain definitions.
 */

import { Domain } from './domain';
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
}
