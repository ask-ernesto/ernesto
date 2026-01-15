import { InstructionContext } from './types';
import { getMcpResourceStats } from '../typesense/client';
import type { Ernesto } from '../Ernesto';

/**
 * Build instruction context from Ernesto state
 */
export async function buildInstructionContext(ernesto: Ernesto): Promise<InstructionContext> {
    const domains = ernesto.domainRegistry.getAll().map((d) => d.name);
    const routes = ernesto.routeRegistry.getAll();

    // Get resource count from Typesense
    const stats = await getMcpResourceStats(ernesto);
    const resourceCount = stats?.total || 0;

    return {
        domainCount: domains.length,
        routeCount: routes.length,
        resourceCount,
        domains: domains.sort(),
    };
}
