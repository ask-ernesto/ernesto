# Ernesto

A context system that structures organizational knowledge and makes it accessible efficiently to AI agents.

> Note (2026-02-18): This README still contains legacy Route-era examples (`searchable`/`hidden` tools and `domain://tools/...` URIs). The current runtime model uses Skills + always-visible tools (`skill:tool`) with role-based guidance.

---

## The Problem

Traditional approaches to AI agent tooling fail at scale:

- **Flat tool hierarchies** — Hundreds of tools at the same level, no structure. The agent must infer which tools relate to each other and in what order and how to use them. Often, the agent tends to use the most granular tool, which is also the harder to use.
- **No encoded workflows** — Raw API wrappers delegate business logic to the agent itself. It guesses at processes your organization has already figured out. Agent must discover "its next step", and must be helped to choose.
- **Context explosion** — Dumping everything upfront burns tokens and still doesn't help the agent understand what to do. Context must be handled as a scarce resource and therefore managed.

Ernesto creates a **tree structure** where agents naturally fall into the right bucket of tools and instructions based on their query. Workflows are engineered upfront, not improvised by the agent.

---

## The Idea

Ernesto helps an organization to kickstart its agentic tooling capabilities by incentivizing the curation of knowledge of any kind. The structure given to this knowledge: data, pre-established workflows, scripts etc... improves the performances of all kind of agents and therefore is always beneficial for the future operations of the organization. It also allows granular control over scopes (permissions), access, usage metrics...

Ernesto is an interface between humans, agents and systems. It naturally pushes stakeholders to build & maintain custom AI Workflows at the center of their organization, and to make them available to everyone (including agents). 

The developer experience is at the center of the Ernesto system: developper's agent is naturally guided towards building itself thanks to strong layers of abstractions. It makes it easy for anyone from the organization to create and share his own workflows.

It can essentially be accessed in 2 ways:
- Native MCP: Experience on user's agentic client of choice (preferably Claude Code, OpenCode, Codex...)
- Wrapper API: Programmatically access Ernesto's capabilities by spawning agents connected to the MCP. It allows the creation of really polished experiences like Discord bots, Slack bots, Documentation Bot...

Because of his low overhead, Ernesto can be integrated (or integrate) easily: third-party clients, other MCPs etc... Making any kind of interface or connection only takes a few prompts.

## Two Operations

```
ask(query)     Semantic discovery
               Returns: searchable routes + matching resources

get(routes)    Batch execution
               Returns: { content, guidance } for each route
```

Two operations that navigate an entire tree of organizational knowledge. The agent discovers the right branch, then follows guidance deeper until the task is complete.

---

## Core Concepts

The hierarchy forms a tree. Domains are branches. Searchable tools are entry points. Hidden tools are leaves you reach by following the path. Resources are indexed content from external sources and provide cached data in a shape of any kind (file system, database, API, etc...). They are discovered and agent is guided to load it.

```
Domain           Branch of knowledge (warehouse, logs, translations...)
  │
  ├─ Tool        TypeScript-defined with execute()
  │    ├─ Searchable   Entry points agents discover via ask()
  │    │               Return instructions + guidance to hidden tools
  │    │
  │    └─ Hidden       Execution layer, unveiled contextually
  │                    Encode the actual business logic
  │
  └─ Resource    Indexed content from external sources
                 (searchable via ask(), provides context)
```

When an agent asks about "revenue analysis," it lands in the warehouse domain, gets the analyst instructions, and is guided to simple server-side heavy revenue-specific tools: not lost in a sea of unrelated capabilities or too-versatile tools he will struggle to use.

---

## Agent Workflow

```
1. ask("topic")              → Semantic search finds the right domain
2. get([entry_point])        → Load instructions, receive guidance
3. get([unveiled_route])     → Execute with business logic baked in
4. Repeat until complete     → Guidance chains to next steps
```

The agent doesn't improvise workflows: it follows paths your organization has already designed. Each tool knows what comes next and guides the agent there. This reduces the agent's job to **interpretation**: understand the query, follow the guided path, interpret results. That's a task LLMs excel at.

> "The agent should be gently pushed into knowing what to do because it was engineered upfront."

---

## Key Patterns

**Progressive Disclosure** — Tools revealed contextually via guidance. The tree structure means agents must load instructions before accessing execution tools: they can't skip steps or bypass business logic.

**Workflow-Optimized Tools** — Tools match mental models, not technical surfaces. "I want to investigate a user" not "POST /api/users/:id". One person solves a problem, documents it as a tool, and every agent can now follow that workflow.

**Cross-Domain Guidance** — A log investigation tool can suggest loading code-reading instructions. A user lookup can hint at invoice investigation tools. Domains connect to form complete workflows. This creates circles of discovery where the agent can navigate horizontally and not only top to down.

**Scope-Based Access Control** — Scopes cascade from domain → route → resource. Agents only discover and execute what their scopes allow. A support agent sees support tools; an admin agent sees admin tools. Access control is enforced at both `ask()` (discovery) and `get()` (execution).

**Server-Side Execution** — Templates run on server. Results render without entering agent context. This avoids loading complex queries into the agent, just create scripts and the agent runs them by calling the appropriate tool.

---

## Primitives, Not Prescriptions

Ernesto is a thin coordination layer:
- **Extract**: Retrieve data from any source
  - A git repo with gh
  - Local File System
  - Airbyte-like
  - Custom Pipelines 
  ...
  
- **Structure**: Shape this data as a...
  - File System
  - Typesense Collection
  - Database
  ...
  
- **Search** — Discover relevant content using adequate tools for the structure chosen
- **Execute** — Allows the agent to execute commands discovered.

---

## Quick Example

### Domain Definition

```typescript
const warehouseDomain: DomainDefinition = {
  name: 'warehouse',
  description: 'Data warehouse access - query orders, users, analytics',
  requiredScopes: ['analytics'],  // Only agents with 'analytics' scope can access
  tools: [analystTool, queryTool, userInvestigationTool],
};
```

### Searchable Tool (Entry Point)

The entry point teaches the agent about this domain and guides it to the right execution tools.

```typescript
const analystTool: ToolDefinition = {
  route: 'warehouse://tools/analyst',
  name: 'Warehouse Analyst',
  description: 'Intelligent analyst with schema knowledge',
  searchable: true,

  async execute(params, ctx) {
    return {
      content: `## Warehouse Guide\n\nAvailable tables: fact_orders, dim_user...\n\nFor revenue questions, use revenue-breakdown. For user investigations, use user-investigation.`,
      guidance: [
        { route: 'warehouse://tools/hidden/query', prose: 'Execute custom SQL' },
        { route: 'warehouse://tools/hidden/user-investigation', prose: 'Deep-dive on a user' },
        { route: 'warehouse://tools/hidden/revenue-breakdown', prose: 'Revenue analysis by period' },
      ],
    };
  },
};
```

### Hidden Tool (Unveiled via Guidance)

Hidden tools encode the actual execution. The agent only reaches them after loading context.

```typescript
const queryTool: ToolDefinition = {
  route: 'warehouse://tools/hidden/query',
  name: 'SQL Query',
  description: 'Execute SQL against the warehouse',
  searchable: false,            // Only accessible after loading analyst instructions
  requiredScopes: ['sql-write'], // Additional scope for raw SQL (inherits 'analytics' from domain)

  async execute(params, ctx) {
    const result = await warehouseClient.query(params.sql);
    return { 
      content: formatAsMarkdown(result),
      guidance: [
        { route: 'logs://tools//search-logs', prose: 'Continue investigation with logs' }, // Cross Domain Guidance
      ],};
  },
};
```

### Resource (Cached Data)

Resources provide indexed, searchable content. They're discovered via `ask()` and loaded on demand—keeping context lean until the agent actually needs it. Tools can provide guidance to discover and use them. Native MCP Templates Resources can be used.

```typescript
const schemaResource: ResourceDefinition = {
  route: 'warehouse://resources/schema-docs',
  name: 'Schema Documentation',
  description: 'Table schemas, column descriptions, usage examples',

  async fetch(ctx) {
    return {
      content: await loadFromCache('schema-docs'),
    };
  },
};
```

Resources decouple content from execution. The agent discovers relevant documentation, loads cached context, and uses it to drive tool execution—without burning tokens on upfront context dumps.

---

### The Flow

The agent's query lands it in the right domain. Instructions guide it to the right tool. No guessing.

```
Agent: ask("how many orders yesterday")
       ↓
Ernesto: Returns warehouse://tools/analyst (semantic match)
       ↓
Agent: get([{ route: "warehouse://tools/analyst" }])
       ↓
Ernesto: Instructions + guidance → unveils hidden/query
       ↓
Agent: get([{ route: "warehouse://tools/hidden/query", params: { sql: "..." } }])
       ↓
Ernesto: Query results (workflow complete)
```

---

## Installation

```bash
npm install ernesto
```

---

## Contribute

> Read README.md and discover the Ernesto system.

---
## Reference

See [REFERENCE.md](./REFERENCE.md) for implementation specs:

- Route URIs and type hierarchy
- `ask()` and `get()` internals
- Progressive disclosure flow diagrams
- Content extraction pipeline
- Scope-based access control
- Tool patterns and lifecycle management

---

*Ernesto: Making organizational knowledge accessible to AI agents through progressive disclosure.*
