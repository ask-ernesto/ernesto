import { InstructionContext } from './types';
import { getMcpResourceStats } from '../typesense/client';
import type { Ernesto } from '../Ernesto';

/**
 * Build instruction context from Ernesto state
 */
export async function buildInstructionContext(ernesto: Ernesto): Promise<InstructionContext> {
    const skills = ernesto.skillRegistry.getAll();
    const toolCount = ernesto.skillRegistry.getAllTools().length;

    // Get resource count from Typesense
    const stats = await getMcpResourceStats(ernesto);
    const resourceCount = stats?.total || 0;

    return {
        domainCount: skills.length,
        routeCount: toolCount,
        resourceCount,
        domains: skills.map((s) => s.name).sort(),
    };
}
