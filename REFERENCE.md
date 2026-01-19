# Ernesto: Reference

> **Start with the [README](./README.md)** for core concepts and quick examples.
> This document is the **implementation spec**: type definitions, internal flows, and how the system works.

---

## Table of Contents

1. [Type Hierarchy](#1-type-hierarchy)
2. [Domain Architecture](#2-domain-architecture)
3. [The Two Operations](#3-the-two-operations)
4. [Progressive Disclosure in Action](#4-progressive-disclosure-in-action)
5. [Complete Interaction Flow](#5-complete-interaction-flow)
6. [Initialization Pipeline](#6-initialization-pipeline)
7. [Content Extraction System](#7-content-extraction-system)
8. [Scope-Based Access Control](#8-scope-based-access-control)
9. [Tool Patterns](#9-tool-patterns)
10. [Lifecycle Management](#10-lifecycle-management)

---

## 1. Type Hierarchy

### Routes

A **route** is a URI that uniquely identifies any tool or resource in Ernesto:

```
domain://type/path

Examples:
  warehouse://tools/analyst              → Searchable tool (entry point)
  warehouse://tools/hidden/query         → Hidden tool (execution)
  warehouse://resources/schema/users     → Resource (indexed content)
  logs://tools/hidden/user-activity      → Cross-domain tool
```

Routes are the addressing system. When you call `get([{ route: "..." }])`, you're executing by route. When guidance unveils next steps, it provides routes. The `route` property on every definition is its unique address.

### Definition Types

The library exposes three definition types for building your knowledge tree:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   DomainDefinition          ToolDefinition              ResourceDefinition  │
│   ─────────────────         ──────────────              ──────────────────  │
│                                                                             │
│   Branch of knowledge       TypeScript-defined          Indexed content     │
│   that bundles tools        with execute()              from external       │
│   and resources                                         sources             │
│                                                                             │
│   Has: name, tools,         Has: route, name,           Has: route, name,   │
│        extractors,               execute(),                  fetch()        │
│        requiredScopes            searchable                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ToolDefinition

Tools are the executable units. They come in two flavors:

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│                             │     │                             │
│   Searchable Tool           │     │   Hidden Tool               │
│   searchable: true          │     │   searchable: false         │
│                             │     │                             │
│   ───────────────────────   │     │   ───────────────────────   │
│                             │     │                             │
│   ENTRY POINTS              │     │   EXECUTION LAYER           │
│                             │     │                             │
│   • Discovered via ask()    │     │   • Never in ask() results  │
│   • Teach the agent how     │     │   • Unveiled via guidance   │
│     to use the domain       │     │   • Encode business logic   │
│   • Return guidance to      │     │   • May unveil more routes  │
│     hidden tools            │     │                             │
│                             │     │                             │
│   ───────────────────────   │     │   ───────────────────────   │
│                             │     │                             │
│   Examples:                 │     │   Examples:                 │
│   • "analyst"               │     │   • "query"                 │
│   • "investigator"          │     │   • "user-investigation"    │
│                             │     │   • "revenue-breakdown"     │
│                             │     │                             │
└─────────────────────────────┘     └─────────────────────────────┘
```

### ResourceDefinition

Resources are indexed content discovered via `ask()`. They provide context without execution logic.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   ResourceDefinition                                                        │
│                                                                             │
│   • Content from external sources (GitHub PRs, database schemas, docs...)   │
│   • Indexed in Typesense for semantic search                                │
│   • URI pattern: domain://resources/path                                    │
│   • Loaded on demand via get()                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TypeScript Interfaces

```typescript
interface ToolDefinition<TInput = unknown> {
    route: string;                        // URI: "domain://tools/path"
    name: string;                         // Human-readable name
    description: string;                  // Searchable text for discovery
    searchable: boolean;                  // true = entry point, false = hidden

    execute: (params: TInput, ctx: RouteContext) => Promise<GuidedContent>;

    // Optional
    inputSchema?: z.ZodSchema<TInput>;    // Zod validation for params
    requiredScopes?: string[];            // Access control (adds to domain scopes)
}

interface ResourceDefinition {
    route: string;                        // URI: "domain://resources/path"
    name: string;
    description: string;

    fetch: (ctx: RouteContext) => Promise<{ content: string }>;
}

interface GuidedContent {
    content: string;                      // Markdown response
    guidance: RouteGuidance[];            // Unveils hidden routes
}

interface RouteGuidance {
    route: string;                        // Hidden route URI to unveil
    prose: string;                        // Explanation of when/why to use it
    params?: Record<string, unknown>;     // Optional pre-filled params
}
```

---

## 2. Domain Architecture

A **Domain** is a branch of knowledge that bundles tools and resources for a topic:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                           DomainDefinition                                  │
│                                                                             │
│   A self-contained knowledge topic with execution capabilities              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   interface DomainDefinition {                                              │
│       name: string;                    // "warehouse", "logs", "qa"         │
│       description: string;             // What this domain provides         │
│       tools: ToolDefinition[];         // All tools (searchable + hidden)   │
│       extractors?: PipelineConfig[];   // Content pipelines (optional)      │
│       searchConfig?: SearchConfig;     // Semantic search tuning (optional) │
│       requiredScopes?: string[];       // Domain-level access control       │
│   }                                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What a Domain Contains

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   DOMAIN: "warehouse"                                                       │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                                                                   │     │
│   │   SEARCHABLE TOOL (Entry Point)                                   │     │
│   │                                                                   │     │
│   │   route: "warehouse://tools/analyst"                              │     │
│   │   searchable: true                                                │     │
│   │                                                                   │     │
│   │   Purpose:                                                        │     │
│   │   • Teaches agents about the warehouse                            │     │
│   │   • Explains available tables, metrics, terminology               │     │
│   │   • Provides workflow guidance                                    │     │
│   │   • Returns guidance array pointing to hidden tools               │     │
│   │                                                                   │     │
│   │   Returns guidance to:                                            │     │
│   │   ├─▶ warehouse://tools/hidden/query                              │     │
│   │   ├─▶ warehouse://tools/hidden/user-investigation                 │     │
│   │   ├─▶ warehouse://tools/hidden/revenue-breakdown                  │     │
│   │   └─▶ warehouse://tools/hidden/get-columns                        │     │
│   │                                                                   │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                              │                                              │
│                              │ guidance unveils                             │
│                              ▼                                              │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                                                                   │     │
│   │   HIDDEN TOOLS (Execution Layer)                                  │     │
│   │                                                                   │     │
│   │   ┌─────────────────────────────────────────────────────────┐     │     │
│   │   │ route: "warehouse://tools/hidden/query"                 │     │     │
│   │   │ Execute arbitrary SQL against the warehouse             │     │     │
│   │   │ Uses: WarehouseClient.query(sql)                        │     │     │
│   │   └─────────────────────────────────────────────────────────┘     │     │
│   │                                                                   │     │
│   │   ┌─────────────────────────────────────────────────────────┐     │     │
│   │   │ route: "warehouse://tools/hidden/user-investigation"    │     │     │
│   │   │ Pre-built template for user deep-dive                   │     │     │
│   │   │ Returns: profile, risk indicators, patterns             │     │     │
│   │   │ May unveil: logs://tools/hidden/user-activity           │     │     │
│   │   └─────────────────────────────────────────────────────────┘     │     │
│   │                                                                   │     │
│   │   ┌─────────────────────────────────────────────────────────┐     │     │
│   │   │ route: "warehouse://tools/hidden/revenue-breakdown"     │     │     │
│   │   │ Pre-built template for revenue analysis                 │     │     │
│   │   │ Params: start_date, end_date                            │     │     │
│   │   └─────────────────────────────────────────────────────────┘     │     │
│   │                                                                   │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                                                                   │     │
│   │   EXTRACTORS (Content Pipelines)                                  │     │
│   │                                                                   │     │
│   │   Index external content into Typesense for semantic search       │     │
│   │                                                                   │     │
│   │   extractors: [                                                   │     │
│   │     {                                                             │     │
│   │       source: new WarehouseSource({ tablePattern: /^fact_/ }),    │     │
│   │       formats: [new TableSchemaFormat()],                         │     │
│   │       basePath: 'facts',                                          │     │
│   │       cacheTtlMs: 1000 * 60 * 60  // 1 hour                       │     │
│   │     },                                                            │     │
│   │     {                                                             │     │
│   │       source: new WarehouseSource({ tablePattern: /^dim_/ }),     │     │
│   │       formats: [new TableSchemaFormat()],                         │     │
│   │       basePath: 'dimensions'                                      │     │
│   │     }                                                             │     │
│   │   ]                                                               │     │
│   │                                                                   │     │
│   │   Creates resources like:                                         │     │
│   │   • warehouse://resources/facts/fact_orders/columns/order_id      │     │
│   │   • warehouse://resources/dimensions/dim_user/columns/user_id     │     │
│   │                                                                   │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                                                                   │     │
│   │   BUNDLED CLIENT (Third-Party Access)                             │     │
│   │                                                                   │     │
│   │   Hidden tools import and use domain-specific clients:            │     │
│   │                                                                   │     │
│   │   import { warehouseQuery } from 'clients/warehouse';             │     │
│   │                                                                   │     │
│   │   async execute(params, ctx) {                                    │     │
│   │       const result = await warehouseQuery(params.sql);            │     │
│   │       return contentOnly(formatResult(result));                   │     │
│   │   }                                                               │     │
│   │                                                                   │     │
│   │   The searchable tool teaches WHEN and HOW to use these clients   │     │
│   │                                                                   │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Domain Search Configuration

Each domain can tune how its content ranks in semantic search:

```typescript
searchConfig: {
    queryBy: 'description,name,content',  // Fields to search
    weights: '4,2,1',                     // Description > name > content
    segments: [
        {
            name: 'columns',
            filter: 'resource_type:=column',
            limit: 10,
            priority: 1    // Columns first (most specific)
        },
        {
            name: 'tables',
            filter: 'resource_type:=table',
            limit: 5,
            priority: 2
        }
    ]
}
```

---

## 3. The Two Operations

Ernesto exposes exactly **two tools** to MCP clients:

### ask() — Semantic Discovery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   ask(query: string, domain?: string, perDomain?: number)                   │
│                                                                             │
│   "What can I do?" → Discover available operations                          │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   INPUT                                                                     │
│   ─────                                                                     │
│   {                                                                         │
│     query: "investigate fraud patterns",                                    │
│     domain: "warehouse",        // optional: filter to one domain           │
│     perDomain: 10               // optional: max results per domain         │
│   }                                                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   INTERNAL FLOW                                                             │
│   ─────────────                                                             │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   For each domain:                                                  │   │
│   │                                                                     │   │
│   │   1. GET SEARCHABLE ROUTES (from RouteRegistry)                     │   │
│   │      ────────────────────────────────────────                       │   │
│   │      • Filter: route.searchable === true                            │   │
│   │      • Filter: user has required scopes                             │   │
│   │      • These are ALWAYS included (entry points)                     │   │
│   │                                                                     │   │
│   │   2. SEARCH RESOURCES (in Typesense)                                │   │
│   │      ────────────────────────────                                   │   │
│   │      • Semantic search with domain weights                          │   │
│   │      • Apply scope filtering (is_unrestricted || user has scopes)   │   │
│   │      • Limited to perDomain results                                 │   │
│   │                                                                     │   │
│   │   3. COMBINE & FORMAT                                               │   │
│   │      ─────────────────                                              │   │
│   │      • Routes first, then resources                                 │   │
│   │      • Format as markdown                                           │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   OUTPUT                                                                    │
│   ──────                                                                    │
│                                                                             │
│   ## warehouse                                                              │
│   *Data warehouse access - query orders, users, analytics*                  │
│                                                                             │
│   - **`warehouse://tools/analyst`**: Intelligent analyst with schema...     │
│     *Parameters: query (string), include_all_tables (boolean)*              │
│                                                                             │
│   - **`warehouse://resources/facts/fact_orders`**: Order transactions...    │
│                                                                             │
│   ## logs                                                                   │
│   *Application logging and error tracking*                                  │
│                                                                             │
│   - **`logs://tools/investigator`**: Log investigation with Scalyr...       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   KEY BEHAVIOR                                                              │
│   ────────────                                                              │
│                                                                             │
│   • SEARCHABLE routes are ALWAYS returned (entry points)                    │
│   • HIDDEN routes are NEVER returned (revealed via guidance only)           │
│   • Call ask() ONCE per context to discover what's available                │
│   • Don't call ask() repeatedly for the same topic                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### get() — Batch Execution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   get(routes: Array<{ route: string, params?: object }>)                    │
│                                                                             │
│   "Do this" → Execute routes in parallel                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   INPUT                                                                     │
│   ─────                                                                     │
│   {                                                                         │
│     routes: [                                                               │
│       { route: "warehouse://tools/analyst", params: { query: "..." } },     │
│       { route: "logs://tools/investigator" }                                │
│     ]                                                                       │
│   }                                                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   INTERNAL FLOW (parallel for each route)                                   │
│   ─────────────────────────────────────────                                 │
│                                                                             │
│        ┌──────────────────────────────────────────────────────────────┐     │
│        │                                                              │     │
│        │   1. PARSE ROUTE URI                                         │     │
│        │      "warehouse://tools/hidden/query"                        │     │
│        │            │           │        │                            │     │
│        │            ▼           ▼        ▼                            │     │
│        │         domain       type     path                           │     │
│        │                                                              │     │
│        │   2. LOOKUP IN ROUTE REGISTRY                                │     │
│        │      RouteRegistry.get(route)                                │     │
│        │      → Route object or null (NOT_FOUND error)                │     │
│        │                                                              │     │
│        │   3. CHECK SCOPES                                            │     │
│        │      route.requiredScopes ⊆ user.scopes?                     │     │
│        │      → Allow or ACCESS_DENIED error                          │     │
│        │                                                              │     │
│        │   4. VALIDATE PARAMS                                         │     │
│        │      route.inputSchema.parse(params)                         │     │
│        │      → Valid params or INVALID_PARAMS error                  │     │
│        │                                                              │     │
│        │   5. EXECUTE                                                 │     │
│        │      route.execute(params, ctx)                              │     │
│        │      → { content, guidance }                                 │     │
│        │                                                              │     │
│        └──────────────────────────────────────────────────────────────┘     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   OUTPUT                                                                    │
│   ──────                                                                    │
│   {                                                                         │
│     "results": [                                                            │
│       {                                                                     │
│         "route": "warehouse://tools/analyst",                               │
│         "success": true,                                                    │
│         "data": {                                                           │
│           "content": "# Analyst Guide\n\n...",                              │
│           "guidance": [                                                     │
│             {                                                               │
│               "route": "warehouse://tools/hidden/query",                    │
│               "prose": "Execute custom SQL against the warehouse"           │
│             },                                                              │
│             {                                                               │
│               "route": "warehouse://tools/hidden/user-investigation",       │
│               "prose": "Deep-dive on a specific user"                       │
│             }                                                               │
│           ]                                                                 │
│         }                                                                   │
│       }                                                                     │
│     ],                                                                      │
│     "summary": { "total": 1, "success": 1, "failed": 0 }                    │
│   }                                                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   KEY BEHAVIOR                                                              │
│   ────────────                                                              │
│                                                                             │
│   • Routes execute in PARALLEL (Promise.all)                                │
│   • Each route returns content + guidance                                   │
│   • Guidance UNVEILS hidden routes for next steps                           │
│   • Can execute both searchable AND hidden routes                           │
│   • One failure doesn't break the batch                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Progressive Disclosure in Action

The core mechanism that prevents "tool chaos" — routes are revealed contextually.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        PROGRESSIVE DISCLOSURE                               │
│                                                                             │
│   Instead of showing 300 tools, show 2 operations and reveal               │
│   tools as they become relevant to the conversation.                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


     TIME ──────────────────────────────────────────────────────────────────▶

     ┌─────────────┐
     │             │
     │   START     │   Agent knows nothing about available tools
     │             │
     └──────┬──────┘
            │
            │  ask("investigate fraud")
            ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
     │   DISCOVERY                                                         │
     │                                                                     │
     │   Agent sees SEARCHABLE routes only:                                │
     │                                                                     │
     │   ┌─────────────────────┐  ┌─────────────────────┐                  │
     │   │ warehouse://        │  │ logs://             │                  │
     │   │ tools/analyst       │  │ tools/investigator  │                  │
     │   └─────────────────────┘  └─────────────────────┘                  │
     │                                                                     │
     │   Hidden routes:  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ (invisible)        │
     │                                                                     │
     └──────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    │  get([analyst])
                                    ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
     │   ENTRY POINT                                                       │
     │                                                                     │
     │   Analyst returns content + GUIDANCE:                               │
     │                                                                     │
     │   content: "# Analyst Guide..."                                     │
     │                                                                     │
     │   guidance unveils:                                                 │
     │   ┌──────────────────────────────┐                                  │
     │   │ warehouse://tools/hidden/    │                                  │
     │   │ ├── query                    │  ◀── NOW VISIBLE                 │
     │   │ ├── user-investigation       │  ◀── NOW VISIBLE                 │
     │   │ ├── revenue-breakdown        │  ◀── NOW VISIBLE                 │
     │   │ └── fincrime-risk            │  ◀── NOW VISIBLE                 │
     │   └──────────────────────────────┘                                  │
     │                                                                     │
     │   Other hidden routes:  ░░░░░░░░░░░░░░░░░░░░ (still invisible)      │
     │                                                                     │
     └──────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    │  get([user-investigation])
                                    ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │                                                                     │
     │   DRILL DOWN                                                        │
     │                                                                     │
     │   User investigation returns content + MORE GUIDANCE:               │
     │                                                                     │
     │   content: "## User Profile\n- High risk score..."                  │
     │                                                                     │
     │   guidance unveils CROSS-DOMAIN routes:                             │
     │   ┌──────────────────────────────┐                                  │
     │   │ logs://tools/hidden/         │                                  │
     │   │ └── user-activity            │  ◀── NOW VISIBLE (different      │
     │   │                              │       domain!)                   │
     │   │ blockchain://tools/hidden/   │                                  │
     │   │ └── address-trace            │  ◀── NOW VISIBLE                 │
     │   └──────────────────────────────┘                                  │
     │                                                                     │
     │   Routes revealed CONTEXTUALLY based on findings                    │
     │                                                                     │
     └──────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    │  continue following guidance...
                                    ▼
     ┌─────────────┐
     │             │
     │   COMPLETE  │   Agent has followed breadcrumbs to answer
     │             │
     └─────────────┘


                    ╔═══════════════════════════════════════════════╗
                    ║                                               ║
                    ║   WHY THIS WORKS                              ║
                    ║                                               ║
                    ║   • Agent never sees all 300 tools at once    ║
                    ║   • Tools appear when contextually relevant   ║
                    ║   • Cross-domain workflows emerge naturally   ║
                    ║   • No hallucination of tool names            ║
                    ║   • Guided path through complex operations    ║
                    ║                                               ║
                    ╚═══════════════════════════════════════════════╝
```

---

## 5. Complete Interaction Flow

A complete example showing USER → AGENT → ERNESTO interaction:

```
     USER                          AGENT                           ERNESTO
      │                              │                                │
      │                              │                                │
      │  "Investigate fraud          │                                │
      │   for user X"                │                                │
      │ ────────────────────────────▶│                                │
      │                              │                                │
      │                              │                                │
      │                              │   ┌──────────────────────┐     │
      │                              │   │ I need to discover   │     │
      │                              │   │ what tools are       │     │
      │                              │   │ available            │     │
      │                              │   └──────────────────────┘     │
      │                              │                                │
      │                              │                                │
      │                              │   ask("fraud investigation     │
      │                              │        user X")                │
      │                              │ ──────────────────────────────▶│
      │                              │                                │
      │                              │                                │ ┌─────────────────┐
      │                              │                                │ │ Search:         │
      │                              │                                │ │ • RouteRegistry │
      │                              │                                │ │   (searchable)  │
      │                              │                                │ │ • Typesense     │
      │                              │                                │ │   (resources)   │
      │                              │                                │ └─────────────────┘
      │                              │                                │
      │                              │   Returns:                     │
      │                              │   ┌────────────────────────┐   │
      │                              │   │ warehouse://           │   │
      │                              │   │   tools/analyst        │   │
      │                              │   │ logs://                │   │
      │                              │   │   tools/investigator   │   │
      │                              │   └────────────────────────┘   │
      │                              │◀──────────────────────────────│
      │                              │                                │
      │                              │                                │
      │                              │   ┌──────────────────────┐     │
      │                              │   │ I'll start with the  │     │
      │                              │   │ analyst to get       │     │
      │                              │   │ context              │     │
      │                              │   └──────────────────────┘     │
      │                              │                                │
      │                              │                                │
      │                              │   get([{                       │
      │                              │     route: "warehouse://       │
      │                              │            tools/analyst",     │
      │                              │     params: { query:           │
      │                              │       "fraud user X" }         │
      │                              │   }])                          │
      │                              │ ──────────────────────────────▶│
      │                              │                                │
      │                              │                                │ ┌─────────────────┐
      │                              │                                │ │ Execute:        │
      │                              │                                │ │ • Load schema   │
      │                              │                                │ │ • Build context │
      │                              │                                │ │ • Add guidance  │
      │                              │                                │ └─────────────────┘
      │                              │                                │
      │                              │   Returns:                     │
      │                              │   ┌────────────────────────┐   │
      │                              │   │ content:               │   │
      │                              │   │   "# Analyst Guide..." │   │
      │                              │   │                        │   │
      │                              │   │ guidance:              │   │
      │                              │   │   • hidden/query       │◀──┼── UNVEILED
      │                              │   │   • hidden/user-inv    │◀──┼── UNVEILED
      │                              │   │   • hidden/fincrime    │◀──┼── UNVEILED
      │                              │   └────────────────────────┘   │
      │                              │◀──────────────────────────────│
      │                              │                                │
      │                              │                                │
      │                              │   ┌──────────────────────┐     │
      │                              │   │ User investigation   │     │
      │                              │   │ template is perfect  │     │
      │                              │   │ for this task        │     │
      │                              │   └──────────────────────┘     │
      │                              │                                │
      │                              │                                │
      │                              │   get([{                       │
      │                              │     route: "warehouse://       │
      │                              │       tools/hidden/            │
      │                              │       user-investigation",     │
      │                              │     params: {                  │
      │                              │       user_id: "X"             │
      │                              │     }                          │
      │                              │   }])                          │
      │                              │ ──────────────────────────────▶│
      │                              │                                │
      │                              │                                │ ┌─────────────────┐
      │                              │                                │ │ Execute:        │
      │                              │                                │ │ • Query warehouse│
      │                              │                                │ │ • Compute risk  │
      │                              │                                │ │ • Format results│
      │                              │                                │ └─────────────────┘
      │                              │                                │
      │                              │   Returns:                     │
      │                              │   ┌────────────────────────┐   │
      │                              │   │ content:               │   │
      │                              │   │   "## User Profile     │   │
      │                              │   │    Risk: HIGH          │   │
      │                              │   │    Spend: €8,500..."   │   │
      │                              │   │                        │   │
      │                              │   │ guidance:              │   │
      │                              │   │   • logs://hidden/     │◀──┼── CROSS-DOMAIN
      │                              │   │     user-activity      │   │
      │                              │   │   • blockchain://      │◀──┼── CROSS-DOMAIN
      │                              │   │     hidden/trace       │   │
      │                              │   └────────────────────────┘   │
      │                              │◀──────────────────────────────│
      │                              │                                │
      │                              │                                │
      │                              │   ... (follows more guidance   │
      │                              │        as needed)              │
      │                              │ ◀────────────────────────────▶│
      │                              │                                │
      │                              │                                │
      │  "User X shows signs of      │                                │
      │   structuring with 15        │                                │
      │   transactions just under    │                                │
      │   €1,000. High risk score    │                                │
      │   (85). Recommend review."   │                                │
      │◀────────────────────────────│                                │
      │                              │                                │
```

---

## 6. Initialization Pipeline

How Ernesto boots up and prepares to serve requests:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         INITIALIZATION FLOW                                 │
│                                                                             │
│   getErnesto() → Lazy initialization, thread-safe                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              getErnesto() called
                                      │
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
              ▼                                               ▼
    ┌──────────────────────┐                    ┌──────────────────────┐
    │                      │                    │                      │
    │  Already initialized │                    │  First call          │
    │                      │                    │                      │
    │  Return cached       │                    │  Initialize          │
    │  instance            │                    │                      │
    │                      │                    │                      │
    └──────────────────────┘                    └──────────┬───────────┘
                                                          │
                                                          ▼
                              ┌────────────────────────────────────────┐
                              │                                        │
                              │   new Ernesto({                        │
                              │     domains: allDomains,               │
                              │     typesense: client,                 │
                              │     instructionRegistry                │
                              │   })                                   │
                              │                                        │
                              │   Creates:                             │
                              │   • DomainRegistry                     │
                              │   • RouteRegistry                      │
                              │   • LifecycleService                   │
                              │                                        │
                              └──────────────────┬─────────────────────┘
                                                 │
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │                                        │
                              │   lifecycle.restart()                  │
                              │                                        │
                              └──────────────────┬─────────────────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
                    ▼                            ▼                            ▼
      ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
      │                      │    │                      │    │                      │
      │  REGISTER ROUTES     │    │  INITIALIZE          │    │  BUILD INSTRUCTION   │
      │                      │    │  EXTRACTORS          │    │  CONTEXT             │
      │  For each domain:    │    │                      │    │                      │
      │                      │    │  For each extractor: │    │  {                   │
      │  1. Get domain's     │    │                      │    │    domainCount,      │
      │     routes           │    │  1. Check freshness  │    │    routeCount,       │
      │                      │    │     in Typesense     │    │    resourceCount,    │
      │  2. Merge domain     │    │                      │    │    domains: [...]    │
      │     scopes into      │    │  2. FRESH?           │    │  }                   │
      │     each route       │    │     → Skip           │    │                      │
      │                      │    │                      │    │  Used for MCP        │
      │  3. Add to           │    │  3. STALE?           │    │  instructions        │
      │     RouteRegistry    │    │     → Fetch & index  │    │                      │
      │                      │    │                      │    │                      │
      └──────────────────────┘    └──────────┬───────────┘    └──────────────────────┘
                                             │
                                             │
                         ┌───────────────────┴───────────────────┐
                         │                                       │
                         ▼                                       ▼
              ┌──────────────────────┐              ┌──────────────────────┐
              │                      │              │                      │
              │   FRESH              │              │   STALE              │
              │   age < TTL          │              │   age >= TTL         │
              │                      │              │                      │
              │   ┌────────────────┐ │              │   ┌────────────────┐ │
              │   │ Typesense has  │ │              │   │ 1. Delete old  │ │
              │   │ valid cached   │ │              │   │    docs        │ │
              │   │ data           │ │              │   │                │ │
              │   │                │ │              │   │ 2. Fetch from  │ │
              │   │ Skip fetching  │ │              │   │    source      │ │
              │   │ (~seconds)     │ │              │   │                │ │
              │   └────────────────┘ │              │   │ 3. Parse with  │ │
              │                      │              │   │    formats     │ │
              └──────────────────────┘              │   │                │ │
                                                   │   │ 4. Index to    │ │
                                                   │   │    Typesense   │ │
                                                   │   │    (~minutes)  │ │
                                                   │   └────────────────┘ │
                                                   │                      │
                                                   └──────────────────────┘
                                             │
                                             │
                                             ▼
                              ┌────────────────────────────────────────┐
                              │                                        │
                              │   ERNESTO READY                        │
                              │                                        │
                              │   • RouteRegistry: all routes loaded   │
                              │   • Typesense: all resources indexed   │
                              │   • Ready to attach to MCP server      │
                              │                                        │
                              │   log.info('Ernesto ready')            │
                              │                                        │
                              └────────────────────────────────────────┘
```

---

## 7. Content Extraction System

The pipeline that extracts and indexes content from external sources:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                      CONTENT PIPELINE ARCHITECTURE                          │
│                                                                             │
│   Source (WHERE) ──▶ Format (HOW) ──▶ ResourceNode[] ──▶ Typesense Index   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   PIPELINE CONFIG                                                           │
│                                                                             │
│   interface PipelineConfig {                                                │
│       source: ContentSource;      // WHERE content comes from               │
│       formats: ContentFormat[];   // HOW to parse it                        │
│       basePath?: string;          // URI prefix for resources               │
│       cacheTtlMs?: number;        // Freshness TTL (default: 4 hours)       │
│       scopes?: string[];          // Access control                         │
│   }                                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


              ┌───────────────────────────────────────────────────────────────┐
              │                                                               │
              │   CONTENT SOURCE                                              │
              │   ──────────────                                              │
              │                                                               │
              │   interface ContentSource {                                   │
              │       name: string;                                           │
              │       listDocuments(): Promise<RawDocument[]>;                │
              │       fetchContent(docId: string): Promise<RawContent>;       │
              │   }                                                           │
              │                                                               │
              │   Available Sources:                                          │
              │   • LocalSource     - Filesystem files                        │
              │   • GitHubSource    - PRs, commits, issues                    │
              │   • ClickUpSource   - Docs, tasks, lists                      │
              │   • QaseSource      - Test cases, suites                      │
              │   • RedshiftSource  - Table schemas                           │
              │   • DriveSource     - Google Drive files                      │
              │                                                               │
              └───────────────────────────┬───────────────────────────────────┘
                                          │
                                          │ listDocuments()
                                          ▼
              ┌───────────────────────────────────────────────────────────────┐
              │                                                               │
              │   RawDocument[]                                               │
              │                                                               │
              │   [                                                           │
              │     { id: "123", name: "PR #456", contentType: "pr", ... },   │
              │     { id: "124", name: "PR #457", contentType: "pr", ... },   │
              │   ]                                                           │
              │                                                               │
              └───────────────────────────┬───────────────────────────────────┘
                                          │
                                          │ For each: fetchContent(id)
                                          ▼
              ┌───────────────────────────────────────────────────────────────┐
              │                                                               │
              │   CONTENT FORMAT                                              │
              │   ──────────────                                              │
              │                                                               │
              │   interface ContentFormat {                                   │
              │       name: string;                                           │
              │       canHandle(contentType: string): boolean;                │
              │       parse(content: RawContent, basePath: string):           │
              │             ResourceNode[];                                   │
              │   }                                                           │
              │                                                               │
              │   Available Formats:                                          │
              │   • MarkdownFormat      - Parse markdown files                │
              │   • PRFormat            - Parse GitHub PRs                    │
              │   • CommitFormat        - Parse Git commits                   │
              │   • TableSchemaFormat   - Parse database schemas              │
              │   • QaseSuiteFormat     - Parse Qase test suites              │
              │   • ClickUpDocFormat    - Parse ClickUp documents             │
              │                                                               │
              └───────────────────────────┬───────────────────────────────────┘
                                          │
                                          │ parse(content, basePath)
                                          ▼
              ┌───────────────────────────────────────────────────────────────┐
              │                                                               │
              │   ResourceNode[]                                              │
              │                                                               │
              │   interface ResourceNode {                                    │
              │       id: string;                                             │
              │       name: string;                                           │
              │       path: string;         // Hierarchical path              │
              │       content: string;      // Full searchable content        │
              │       description?: string; // Summary for search results     │
              │       metadata?: object;    // Source-specific data           │
              │       children?: ResourceNode[];  // Nested resources         │
              │   }                                                           │
              │                                                               │
              └───────────────────────────┬───────────────────────────────────┘
                                          │
                                          │ Flatten tree, build documents
                                          ▼
              ┌───────────────────────────────────────────────────────────────┐
              │                                                               │
              │   McpResourceDocument (Typesense Schema)                      │
              │                                                               │
              │   {                                                           │
              │     id: base64(uri),                                          │
              │     uri: "domain://resources/path",                           │
              │     domain: "warehouse",                                      │
              │     path: "facts/fact_orders/columns/order_id",               │
              │     source_id: "warehouse:TableSchema:fact_*",                │
              │     name: "order_id",                                         │
              │     content: "Primary key for orders...",                     │
              │     description: "Unique order identifier",                   │
              │                                                               │
              │     // Access control                                         │
              │     scopes: ["analytics"],        // Required scopes          │
              │     is_unrestricted: false,       // scopes.length === 0      │
              │                                                               │
              │     // Metadata for ranking                                   │
              │     resource_type: "column",                                  │
              │     path_segment: "facts",                                    │
              │     quality_score: 50,                                        │
              │     indexed_at: 1705600000000                                 │
              │   }                                                           │
              │                                                               │
              └───────────────────────────┬───────────────────────────────────┘
                                          │
                                          │ indexMcpResources(documents)
                                          ▼
              ┌───────────────────────────────────────────────────────────────┐
              │                                                               │
              │   TYPESENSE INDEX                                             │
              │                                                               │
              │   Collection: mcp_resources                                   │
              │                                                               │
              │   Searchable fields:                                          │
              │   • name, content, description (semantic search)              │
              │                                                               │
              │   Filterable fields:                                          │
              │   • domain, resource_type, path_segment                       │
              │   • scopes, is_unrestricted (access control)                  │
              │   • source_id (freshness tracking)                            │
              │                                                               │
              │   Sortable fields:                                            │
              │   • quality_score, indexed_at                                 │
              │                                                               │
              └───────────────────────────────────────────────────────────────┘
```

---

## 8. Scope-Based Access Control

How Ernesto controls who can see and execute what:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         SCOPE INHERITANCE                                   │
│                                                                             │
│   Scopes cascade from domain → route → resource                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │                                 │
                    │   DOMAIN                        │
                    │   requiredScopes: ['internal']  │
                    │                                 │
                    └────────────────┬────────────────┘
                                     │
                                     │ merged with
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                         │                         │
           ▼                         ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│                      │  │                      │  │                      │
│  ROUTE               │  │  ROUTE               │  │  EXTRACTOR           │
│  requiredScopes: []  │  │  requiredScopes:     │  │  scopes: ['admin']   │
│                      │  │    ['support']       │  │                      │
│  Final scopes:       │  │                      │  │  Final scopes:       │
│  ['internal']        │  │  Final scopes:       │  │  ['internal',        │
│                      │  │  ['internal',        │  │   'admin']           │
│                      │  │   'support']         │  │                      │
│                      │  │                      │  │  All resources from  │
│                      │  │                      │  │  this extractor      │
│                      │  │                      │  │  require both scopes │
│                      │  │                      │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   THE is_unrestricted PATTERN                                               │
│                                                                             │
│   Problem: Typesense can't efficiently query "scopes array is empty"        │
│                                                                             │
│   Solution: Pre-compute a boolean field                                     │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   // When indexing (Ernesto.ts)                                     │   │
│   │                                                                     │   │
│   │   {                                                                 │   │
│   │     scopes: finalScopes,                                            │   │
│   │     is_unrestricted: finalScopes.length === 0   // ◀── Pre-computed │   │
│   │   }                                                                 │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   // When searching (client.ts)                                     │   │
│   │                                                                     │   │
│   │   if (userScopes.length > 0) {                                      │   │
│   │       // User has scopes: show unrestricted OR matching scopes      │   │
│   │       filter = "is_unrestricted:true || scopes:[scope1,scope2]"     │   │
│   │   } else {                                                          │   │
│   │       // User has no scopes: only show unrestricted                 │   │
│   │       filter = "is_unrestricted:true"                               │   │
│   │   }                                                                 │   │
│   │                                                                     │   │
│   │   // Post-filter: ensure user has ALL required scopes               │   │
│   │   results.filter(doc =>                                             │   │
│   │       doc.scopes.length === 0 ||                                    │   │
│   │       doc.scopes.every(s => userScopes.includes(s))                 │   │
│   │   )                                                                 │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


                         ACCESS CHECK FLOW

          Request to execute route
                    │
                    ▼
         ┌──────────────────────┐
         │                      │
         │  Get route's         │
         │  requiredScopes      │
         │  (domain + route)    │
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐       ┌─────────────────┐
         │                      │       │                 │
         │  scopes.length === 0 │──YES─▶│  ALLOW          │
         │  (unrestricted)      │       │  (anyone)       │
         │                      │       │                 │
         └──────────┬───────────┘       └─────────────────┘
                    │ NO
                    ▼
         ┌──────────────────────┐       ┌─────────────────┐
         │                      │       │                 │
         │  user.scopes ⊇       │──YES─▶│  ALLOW          │
         │  route.requiredScopes│       │                 │
         │  (has all required)  │       │                 │
         │                      │       └─────────────────┘
         └──────────┬───────────┘
                    │ NO
                    ▼
         ┌─────────────────────┐
         │                     │
         │  DENY               │
         │  ACCESS_DENIED      │
         │                     │
         └─────────────────────┘
```

---

## 9. Tool Patterns

Three patterns for building tools, from simple to advanced:

### Pattern 1: Hidden Tool (Execution Only)

Use when the tool returns data without suggesting next steps.

```typescript
const queryTool: ToolDefinition = {
  route: 'warehouse://tools/hidden/query',
  name: 'SQL Query',
  description: 'Execute SQL against the warehouse',
  searchable: false,
  requiredScopes: ['sql-write'],

  async execute(params, ctx) {
    const result = await warehouseClient.query(params.sql);
    return {
      content: formatAsMarkdown(result),
      guidance: [],  // No next steps
    };
  },
};
```

### Pattern 2: Searchable Tool with Static Guidance

Use when the tool always suggests the same next steps. This is the most common pattern for entry points.

```typescript
const analystTool: ToolDefinition = {
  route: 'warehouse://tools/analyst',
  name: 'Warehouse Analyst',
  description: 'Intelligent analyst with schema knowledge',
  searchable: true,

  async execute(params, ctx) {
    return {
      content: `## Warehouse Guide\n\nAvailable tables: fact_orders, dim_user...`,
      guidance: [
        { route: 'warehouse://tools/hidden/query', prose: 'Execute custom SQL' },
        { route: 'warehouse://tools/hidden/user-investigation', prose: 'Deep-dive on a user' },
        { route: 'warehouse://tools/hidden/revenue-breakdown', prose: 'Revenue analysis by period' },
      ],
    };
  },
};
```

### Pattern 3: Conditional Guidance

Use when next steps depend on the execution result. Guidance can be built dynamically.

```typescript
const userInvestigationTool: ToolDefinition = {
  route: 'warehouse://tools/hidden/user-investigation',
  name: 'User Investigation',
  description: 'Deep-dive investigation on a user',
  searchable: false,

  async execute(params, ctx) {
    const data = await investigateUser(params.user_id);

    // Build guidance based on findings
    const guidance: RouteGuidance[] = [
      { route: 'logs://tools/hidden/user-activity', prose: 'View activity logs' },
    ];

    if (data.riskScore > 80) {
      guidance.push({
        route: 'warehouse://tools/hidden/fincrime-review',
        prose: `High risk score (${data.riskScore}). Investigate patterns.`,
      });
    }

    if (data.lifetimeSpend > 10000) {
      guidance.push({
        route: 'support://tools/hidden/vip-ticket',
        prose: `VIP user (€${data.lifetimeSpend}). Escalate if needed.`,
      });
    }

    return {
      content: formatUserProfile(data),
      guidance,
    };
  },
};
```

### Pattern 4: Cross-Domain Guidance

Tools can guide agents to other domains, creating connected workflows.

```typescript
const queryTool: ToolDefinition = {
  route: 'warehouse://tools/hidden/query',
  name: 'SQL Query',
  description: 'Execute SQL against the warehouse',
  searchable: false,

  async execute(params, ctx) {
    const result = await warehouseClient.query(params.sql);
    return {
      content: formatAsMarkdown(result),
      guidance: [
        { route: 'logs://tools/search-logs', prose: 'Continue investigation with logs' },
        // Cross-domain: warehouse → logs
      ],
    };
  },
};
```

---

## 10. Lifecycle Management

Operations to manage Ernesto's state:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         LIFECYCLE SERVICE                                   │
│                                                                             │
│   Manages initialization, refresh, and rebuild operations                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                           │
│   restart()                                                                               │
│   ─────────                                                                               │
│                                                                                           │
│   Re-initialize with cached data where possible                                           │
│                                                                                           │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐     │
│   │                                                                                 │     │
│   │   1. Clear RouteRegistry                                                        │     │
│   │   2. Re-register all static routes (from domain configs)                        │     │
│   │   3. For each extractor:                                                        │     │
│   │      • Check freshness in Typesense (indexed_at + TTL)                          │     │
│   │      • FRESH → Skip (use cached index)                                          │     │
│   │      • STALE → Fetch from source, re-index                                      │     │
│   │                                                                                 │     │
│   └─────────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                           │
│   Speed: FAST (seconds to minutes, depending on stale sources)                            │
│   Use: Normal restarts, code deploys                                                      │
│                                                                                           │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│   wipeIndexAndRebuild()                                                                   │
│   ─────────────────────                                                                   │
│                                                                                           │
│   Full rebuild from scratch                                                               │
│                                                                                           │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐     │
│   │                                                                                 │     │
│   │   1. Drop Typesense collection (delete all indexed data)                        │     │
│   │   2. Clear RouteRegistry                                                        │     │
│   │   3. Re-create Typesense collection with fresh schema                           │     │
│   │   4. Re-register all static routes                                              │     │
│   │   5. Fetch ALL sources from origin (ignore cache)                               │     │
│   │   6. Index everything fresh                                                     │     │
│   │                                                                                 │     │
│   └─────────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                           │
│   Speed: SLOW (minutes, fetches everything)                                               │
│   Use: Schema changes, corrupted index, major version upgrades                            │
│                                                                                           │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│   refreshSource(sourceId: string)                                                         │
│   ────────────────────────────────                                                        │
│                                                                                           │
│   Refresh a single source                                                                 │
│                                                                                           │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐     │
│   │                                                                                 │     │
│   │   1. Delete all documents with this source_id from Typesense                    │     │
│   │   2. Fetch fresh content from the source                                        │     │
│   │   3. Parse with configured formats                                              │     │
│   │   4. Index new documents                                                        │     │
│   │                                                                                 │     │
│   └─────────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                           │
│   Speed: MODERATE (seconds to minute per source)                                          │
│   Use: Force refresh stale data, triggered by webhooks                                    │
│                                                                                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘


                         FRESHNESS CHECK LOGIC

┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   getSourceFreshness(sourceId)                                              │
│                                                                             │
│   Query Typesense for oldest document with this source_id                   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   indexed_at = oldest_doc.indexed_at                                │   │
│   │   age_ms = now - indexed_at                                         │   │
│   │   ttl_ms = extractor.cacheTtlMs  // default: 4 hours                │   │
│   │                                                                     │   │
│   │   if (age_ms < ttl_ms) {                                            │   │
│   │       // FRESH - data is recent enough                              │   │
│   │       return { wasFresh: true }                                     │   │
│   │   } else {                                                          │   │
│   │       // STALE - need to re-fetch                                   │   │
│   │       return { wasFresh: false }                                    │   │
│   │   }                                                                 │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Special case: LocalSource (filesystem) always re-fetches                  │
│   (fast operation, files may have changed)                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                           ROUTES                                            │
│                                                                             │
│   Route = URI that identifies any tool or resource                          │
│                                                                             │
│   domain://tools/name              Searchable tool                          │
│   domain://tools/hidden/name       Hidden tool                              │
│   domain://resources/path          Resource                                 │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           DEFINITION TYPES                                  │
│                                                                             │
│   DomainDefinition     Branch of knowledge (warehouse, logs, qa...)         │
│   ToolDefinition       Executable unit with execute() function              │
│     ├─ searchable      Entry points discovered via ask()                    │
│     └─ hidden          Execution layer unveiled via guidance                │
│   ResourceDefinition   Indexed content from external sources                │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           TWO OPERATIONS                                    │
│                                                                             │
│   ask(query)           Semantic discovery                                   │
│                        → searchable tools + matching resources              │
│                                                                             │
│   get(routes)          Batch execution                                      │
│                        → { content, guidance } for each route               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           INTERNAL COMPONENTS                               │
│                                                                             │
│   RouteRegistry        In-memory registry of all tools                      │
│   Typesense            Semantic search for resources                        │
│   LifecycleService     Manages initialization and refresh                   │
│   ContentPipeline      Extract → Format → Index workflow                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           AGENT WORKFLOW                                    │
│                                                                             │
│   1. ask("topic")              → Discover entry points                      │
│   2. get([entry_point])        → Load instructions + guidance               │
│   3. get([unveiled_route])     → Execute, receive more guidance             │
│   4. Repeat until complete     → Follow the engineered path                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

*For concepts and quick start, see [README.md](./README.md).*
