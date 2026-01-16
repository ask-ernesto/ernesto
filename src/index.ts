// Library entry point

export { Ernesto } from './Ernesto';

export { createDomain } from './domain';
export type { Domain } from './domain';
export { createRoute, contentOnly, defineGuidance, noGuidance } from './route';

export { createAskTool } from './tools/ask';
export { createGetTool } from './tools/get';

export { InstructionRegistry } from './instructions/registry';
export type { InstructionTemplate } from './instructions/types';
export type { InstructionContent, InstructionContext } from './instructions/types';
export { generateSourceId, ContentPipeline } from './pipelines';

export { searchMcpResources } from './typesense/client';

export type { McpResourceSearchResult } from './typesense/schema';
export { exportSourceDocuments, getSourceFreshness, getMcpResourceStats } from './typesense/client';

export { DEFAULT_CACHE_TTL_MS } from './types';

export type {
    ResourceNode,
    RawContent,
    ContentFormat,
    ContentSource,
    PipelineConfig,
    RawDocument,
} from './types';

export type {
    Route,
    RouteContext,
    GuidedContent,
    RouteGuidance,
} from './route';

export { LifecycleService } from './LifecycleService';
