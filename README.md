# Ernesto Lib

## How It Works (and Why)

**The Problem:** Give an AI agent 50 tools and it gets paralyzed by choice. Give it 3 tools and it can't solve complex problems.

**The Solution:** Progressive disclosure. Start with a few searchable entry points. Each route reveals relevant next steps based on what it finds.

**Example flow:**
1. Agent searches `"user fraud investigation"` → finds `redshift://tools/user-investigation`
2. Executes route, gets user data showing high risk score
3. Route returns content + guidance: `["Check recent logs", "Analyze transaction patterns"]`
4. Agent follows guidance, gets deeper tools that weren't visible in initial search

**Why this works:** Tools appear when contextually relevant, not all upfront. The agent builds a workflow by following breadcrumbs, not by choosing from a haystack.

---

## The Pattern

Every route does one thing:

```typescript
execute(params, ctx) → { content: string, guidance: RouteGuidance[] }
```

That's it. Return markdown content, optionally unveil next routes via guidance.

---

## Quick Example

```typescript
import { createRoute, defineGuidance } from 'ernesto/lib/route';

// Define conditional guidance based on results
const guidance = defineGuidance<Input, Result>({
    logs: {
        always: true,  // Always suggest this
        route: 'app-logs://tools/user-activity',
        prose: (i) => `View logs for ${i.user_id}`
    },
    fraud: {
        when: (r) => r.riskScore > 80,  // Only if high risk
        route: 'redshift://tools/fincrime',
        prose: (i, r) => `⚠️ Risk ${r.riskScore}! Investigate patterns`
    }
});

export const investigateUser = createRoute({
    route: 'redshift://tools/user-investigation',
    description: 'Investigate user spending and risk patterns',
    searchable: true,  // Entry point (visible in search)
    inputSchema: z.object({ user_id: z.string() }),
    guidance,

    async execute({ user_id }, ctx) {
        const data = await queryDatabase(user_id);

        return {
            content: formatMarkdown(data),  // The answer
            result: { riskScore: data.risk }  // Data for guidance
        };
    }
});
```

**What happens:**
- Route is searchable → agent finds it via `ask("user fraud")`
- Executes, returns formatted analysis
- If risk > 80, unveils fraud investigation route
- Agent sees guidance, can drill deeper

---

## Two Visibility Levels

- **`searchable: true`** — Entry points. Always in `ask()` results.
- **`searchable: false`** — Hidden. Only unveiled via guidance from other routes.

This creates guided workflows instead of tool chaos.

---

## File Structure

```
lib/
├── route.ts              Route builders (createRoute, defineGuidance)
├── types.ts              Core types (Route, GuidedContent)
├── router.ts             Execution engine
├── guidance.ts           Guidance formatter
├── schema-formatter.ts   Zod → human readable
│
├── Ernesto.ts            Main orchestrator
├── domain.ts             Domain builder
│
├── tools/                MCP tools (ask, get)
├── typesense/            Search & indexing
├── knowledge/            Content pipeline (extract docs → resources)
├── formats/              Content parsers (markdown, etc)
└── sources/              Content sources (filesystem, APIs)
```

---

## Simple Route (No Guidance)

```typescript
import { contentOnly } from 'ernesto/lib/route';

export const simpleRoute: Route<Input> = {
    route: 'domain://tools/query',
    description: 'Run a database query',
    searchable: false,
    inputSchema: z.object({ sql: z.string() }),
    execute: async ({ sql }, ctx) => contentOnly(
        await runQuery(sql)
    )
};
```

Use `contentOnly()` when you don't need guidance.

---

## Building a Domain

```typescript
import { createDomain } from 'ernesto/lib/domain';

export const myDomain = createDomain({
    name: 'my-domain',
    description: 'What this domain does',
    routes: [route1, route2, route3]
});
```

Register it in `src/ernesto/domains/index.ts`.

---

## Content Pipeline (Optional)

Index external content as searchable resources:

```typescript
{
    extractors: [{
        source: new LocalSource('docs/'),
        format: new MarkdownFormat({ split: true })
    }]
}
```

**Source** (WHERE) + **Format** (HOW) → Resources → Indexed → Searchable

---

## That's It

One pattern. Two visibilities. Guided discovery.

Build routes that unveil routes. Let the agent follow the breadcrumbs.
