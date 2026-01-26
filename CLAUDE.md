# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills

**Read the relevant skill files in `.claude/skills/` before working on related code:**

| Skill | When to Read |
|-------|--------------|
| `caido-overview.md` | Starting work on this project, understanding plugin architecture |
| `backend-sdk.md` | Working on `packages/backend/`, adding API functions, backend events |
| `frontend-sdk.md` | Working on `packages/frontend/`, commands, logging, HTTP requests |
| `sdk-types.md` | Working with Request/Response objects, creating findings |
| `vue-components.md` | Creating or modifying Vue components, component structure |
| `ui-style.md` | UI work, PrimeVue components, colors, layout, icons |
| `code-quality.md` | TypeScript patterns, naming conventions, refactoring |
| `linting.md` | Before committing, fixing lint errors |

## Project Overview

This is a Caido plugin called "Nomad IP" that rotates source IP addresses using AWS API Gateway to bypass IP-based blocking. Caido is a web application security auditing toolkit with HTTP proxy capabilities.

## Commands

- **Build**: `pnpm build`
- **Watch**: `pnpm watch` (rebuilds on changes)
- **Lint**: `pnpm lint` (ESLint with auto-fix)
- **Format**: `pnpm format` (Prettier formatting)
- **Typecheck**: `pnpm typecheck`
- **Knip**: `pnpm knip` (finds unused code/dependencies)
- **Test**: `pnpm test` (run unit tests)
- **Test:Integration**: `pnpm test:integration` (run integration tests - note: these tests create real AWS resources and may take several minutes to complete due to AWS rate limiting)
- **Test:Specific**: `pnpm exec vitest run --config vitest.integration.config.ts --testNamePattern="test name"` (run specific integration test by name)
- **Test:File**: `pnpm exec vitest run --config vitest.integration.config.ts tests/{my_test_file}` (run specific test file)

## Architecture

### Plugin Structure

```
packages/
  backend/   → Server-side: API endpoints, AWS gateway management, request proxying
  frontend/  → Client-side: Vue UI, configuration forms, status display
```

### Important AWS API Gateway Limitation

**AWS API Gateway HTTP_PROXY integration requires a FIXED target host.** The plugin allows users to configure the target host through the UI.

For production use with arbitrary targets, you would need to:

1. Create separate API Gateway instances for each target domain, OR
2. Use a different approach like AWS Lambda with custom routing, OR
3. Use a different service that supports dynamic routing

The current approach with `X-Forwarded-Host` headers does NOT work with AWS API Gateway's HTTP_PROXY integration type.

### Key Backend Components

- `index.ts` - Plugin entry point, API registration, upstream event handler
- `aws/gateway.ts` - AWS API Gateway creation/deletion
- `aws/signing.ts` - AWS Signature v4 signing
- `upstream.ts` - Request interception and routing through gateways
- `config.ts` - In-memory state management (credentials, endpoints, enabled state)
- `storage.ts` - Persistent storage via Caido's database

### Key Frontend Components

- `index.ts` - Plugin initialization, Vue app setup, sidebar registration
- `views/App.vue` - Main UI component
- `plugins/sdk.ts` - SDK injection for Vue components

### Backend Runtime

The backend runs on QuickJS, not Node.js:

- No Node.js APIs or `@types/node`
- Use `Uint8Array` instead of `Buffer`
- Implement custom encoding functions if needed

## Quick Reference

### Caido SDK Imports

```typescript
// Backend
import { SDK, DefineAPI, DefineEvents } from "caido:plugin";
import { Blob, fetch } from "caido:http";

// Frontend
import { Caido } from "@caido/sdk-frontend";
import { RequestSpec } from "caido:utils";
import type { Request, Response } from "caido:utils";
```

### Error Handling

- Backend APIs return `Result<T>` types: `{ kind: "Ok", value: T } | { kind: "Error", error: string }`
- Frontend checks `result.kind` instead of try/catch
- Never throw from API functions

### Logging

**Backend**: `sdk.console.log()` and `sdk.console.error()`

**Frontend**: `sdk.log.info()`, `sdk.log.error()`, `sdk.log.warn()` (NOT `sdk.console`)

### Key Rules

- Use `str !== undefined` instead of `!str` for nullable checks
- Use `type` declarations, never `interface`
- Never use `any` - use proper types or `unknown`
- Icons: `fas fa-[name]` only
- Folders: camelCase; Component folders: PascalCase
