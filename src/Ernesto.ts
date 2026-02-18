import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Skill } from './skill';
import { SkillRegistry, SkillSnapshot } from './skill-registry';
import { ToolContext } from './skill';
import { Soul } from './soul';
import { MemoryStore } from './memory';
import { HeartbeatConfig } from './heartbeat';
import { SystemPromptBuilder, createDefaultPromptBuilder } from './system-prompt';
import debug from 'debug';
import { ContentPipeline } from './pipelines';
import { ResourceNode, DEFAULT_CACHE_TTL_MS, PipelineConfig } from './types';
import { deleteSourceDocuments, getSourceFreshness, indexMcpResources } from './typesense/client';
import { McpResourceDocument } from './typesense/schema';
import { Client as TypesenseClient } from 'typesense';
import { LifecycleService } from './LifecycleService';
import { InstructionRegistry } from './instructions/registry';
import { buildInstructionContext } from './instructions/context';
import { truncateText, flattenResources } from './utils';

const log = debug('Ernesto');

interface ErnestoOptions {
    skills?: Skill[];
    skillRegistry?: SkillRegistry;
    typesense: TypesenseClient;
    instructionRegistry?: InstructionRegistry;
    memory?: MemoryStore;
    soul?: Soul;
    heartbeat?: HeartbeatConfig;
    systemPrompt?: string | SystemPromptBuilder;
}

/**
 * Serializable snapshot of Ernesto state (for dashboard)
 */
export interface ErnestoSnapshot {
    skills: SkillSnapshot[];
    toolCount: number;
    soul: Soul | null;
    memory: boolean;
    heartbeat: HeartbeatConfig | null;
}

/**
 * Ernesto - OpenClaw for Organizations
 */
export class Ernesto {
    // ─── Core Registry ──────────────────────────────────────────────────
    readonly skillRegistry: SkillRegistry;

    // ─── Infrastructure ─────────────────────────────────────────────────
    readonly typesense: TypesenseClient;
    readonly instructionRegistry: InstructionRegistry | null;
    readonly lifecycle = new LifecycleService(this);

    // ─── OpenClaw Primitives ────────────────────────────────────────────
    private _soul: Soul | null = null;
    private _memory: MemoryStore | null = null;
    private _heartbeat: HeartbeatConfig | null = null;
    private _systemPromptBuilder: SystemPromptBuilder;

    constructor(opts: ErnestoOptions) {
        this.typesense = opts.typesense;
        this.instructionRegistry = opts.instructionRegistry ?? null;

        // Skill registry: use injected registry or create a new one
        if (opts.skillRegistry) {
            this.skillRegistry = opts.skillRegistry;
        } else {
            this.skillRegistry = new SkillRegistry();
            if (opts.skills?.length) {
                this.skillRegistry.registerAll(opts.skills);
            }
        }

        // OpenClaw primitives
        this._soul = opts.soul ?? null;
        this._memory = opts.memory ?? null;
        this._heartbeat = opts.heartbeat ?? null;
        this._systemPromptBuilder = opts.systemPrompt instanceof SystemPromptBuilder
            ? opts.systemPrompt
            : createDefaultPromptBuilder();

        if (typeof opts.systemPrompt === 'string') {
            this._systemPromptBuilder.addSection('custom', opts.systemPrompt, 50);
        }
    }

    // ============================================================
    // PUBLIC ACCESSORS (OpenClaw-compatible surface)
    // ============================================================

    get skills(): SkillRegistry {
        return this.skillRegistry;
    }

    get soul(): Soul | null {
        return this._soul;
    }

    get memory(): MemoryStore | null {
        return this._memory;
    }

    get heartbeat(): HeartbeatConfig | null {
        return this._heartbeat;
    }

    get systemPrompt(): string {
        return this._systemPromptBuilder.build({
            skills: this.skillRegistry.getAll(),
            soul: this._soul ?? undefined,
        });
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    public async attachToMcpServer(server: McpServer, context: ToolContext): Promise<void> {
        const { attachErnestoTools } = await import('./ernesto-tools');
        await attachErnestoTools(this, server, context);
    }

    public async buildInstructionContext() {
        return buildInstructionContext(this);
    }

    public toJSON(): ErnestoSnapshot {
        return {
            skills: this.skillRegistry.toJSON(),
            toolCount: this.skillRegistry.getAllTools().length,
            soul: this._soul,
            memory: this._memory !== null,
            heartbeat: this._heartbeat,
        };
    }

    public async initialize(): Promise<void> {
        const startTime = Date.now();
        log('Initializing...');

        const stats = { fresh: 0, fetched: 0, failed: 0 };

        for (const skill of this.skillRegistry.getAll()) {
            if (!skill.resources) continue;

            for (const extractor of skill.resources) {
                try {
                    const result = await this.initializeSource(skill.name, extractor);
                    result.wasFresh ? stats.fresh++ : stats.fetched++;
                } catch (error) {
                    log('Failed to initialize source', {
                        skill: skill.name,
                        source: extractor.source.name,
                        error,
                    });
                    stats.failed++;
                }
            }
        }

        log('Initialization complete', {
            duration: Date.now() - startTime,
            skills: this.skillRegistry.getAll().length,
            tools: this.skillRegistry.getAllTools().length,
            ...stats,
        });
    }

    // ============================================================
    // PRIVATE: SOURCE INITIALIZATION
    // ============================================================

    private async initializeSource(skillName: string, extractor: PipelineConfig): Promise<{ wasFresh: boolean }> {
        const pipeline = new ContentPipeline({
            source: extractor.source,
            formats: extractor.formats,
            basePath: extractor.basePath,
        });
        const sourceId = pipeline.sourceId;
        const ttlMs = extractor.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        const isLocal = extractor.source.name.startsWith('local:');

        if (!isLocal) {
            const freshness = await getSourceFreshness(this, sourceId);
            if (freshness && freshness.ageMs < ttlMs) {
                log('Source fresh, skipping', {
                    sourceId,
                    ageMinutes: Math.round(freshness.ageMs / 60000),
                });
                return { wasFresh: true };
            }
        }

        await this.fetchAndIndexSource(pipeline, sourceId, skillName, extractor);
        return { wasFresh: false };
    }

    private async fetchAndIndexSource(
        pipeline: ContentPipeline,
        sourceId: string,
        skillName: string,
        extractor: PipelineConfig,
    ): Promise<void> {
        const resources = await pipeline.fetchResources();

        if (resources.length === 0) {
            log('No resources from source', { sourceId });
            return;
        }

        await deleteSourceDocuments(this, sourceId);
        await this.indexResources(sourceId, skillName, extractor, resources);

        log('Indexed source', {
            sourceId,
            skillName,
            resourceCount: resources.length,
        });
    }

    public async indexResources(
        sourceId: string,
        skillName: string,
        pipelineConfig: PipelineConfig,
        resources: ResourceNode[],
    ): Promise<void> {
        const skill = this.skillRegistry.get(skillName);
        const parentScopes = skill?.requiredScopes || [];
        const pipelineScopes = pipelineConfig.scopes || [];
        const mergedScopes = [...new Set([...parentScopes, ...pipelineScopes])];

        const flatResources = flattenResources(resources);

        const documents: McpResourceDocument[] = flatResources.map((resource) => {
            const path = resource.path.startsWith('/') ? resource.path.slice(1) : resource.path;
            const uri = `${skillName}://resources/${path}`;
            const description = truncateText(resource.description || resource.content);

            const resourceScopes = resource.metadata?.scopes;
            const finalScopes = resourceScopes !== undefined ? resourceScopes : mergedScopes;

            return {
                id: Buffer.from(uri).toString('base64'),
                uri,
                domain: skillName,
                path,
                source_id: sourceId,
                name: resource.name,
                content: resource.content,
                scopes: finalScopes,
                is_unrestricted: finalScopes.length === 0,
                description,
                content_size: resource.content.length,
                child_count: resource.children?.length || 0,
                resource_type: resource.metadata?.resource_type || 'resource',
                path_segment: path.split('/')[0] || '',
                quality_score: resource.metadata?.quality_score ?? 50,
                indexed_at: Date.now(),
            };
        });

        await indexMcpResources(this, documents);
    }
}
