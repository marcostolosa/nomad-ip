# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

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

**AWS API Gateway HTTP_PROXY integration requires a FIXED target host.** The plugin now allows users to configure the target host through the UI.

For production use with arbitrary targets, you would need to:

1. Create separate API Gateway instances for each target domain, OR
2. Use a different approach like AWS Lambda with custom routing, OR
3. Use a different service that supports dynamic routing

The current approach with `X-Forwarded-Host` headers does NOT work with AWS API Gateway's HTTP_PROXY integration type.

### Backend-Frontend Communication

1. Backend defines API functions in `packages/backend/src/index.ts`
2. Functions are registered with `sdk.api.register("name", function)`
3. API type is exported via `DefineAPI<{ name: typeof function }>`
4. Frontend calls via `sdk.backend.name()` with typed responses

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

## Code Style

### TypeScript Best Practices

This project follows modern TypeScript best practices to ensure type safety, readability, and maintainability.

#### Type System Rules

- **Prefer `type` over `interface`**: Use `type` for data shapes and `interface` only for class implementations
- **No `any` or `null`**: Always use proper types or `undefined` for optional values
- **Strict null checks**: Use `str !== undefined` instead of `!str` for explicit nullable handling
- **Readonly types**: Use `readonly` for immutable data structures
- **Const assertions**: Use `as const` for literal types and immutable objects

#### Modern TypeScript Features

- **Satisfies operator**: Use `satisfies` for type checking without widening
- **Template literal types**: Use template literal types for string validation
- **Utility types**: Prefer built-in utility types (`Partial`, `Pick`, `Omit`, etc.) over manual type definitions
- **Generics**: Use generics for reusable, type-safe components and functions

#### Code Organization

- **Declarative code**: Write code that clearly expresses intent rather than implementation details
- **Early returns**: Avoid deep nesting with guard clauses and early returns
- **Single responsibility**: Keep functions focused on one task
- **Pure functions**: Prefer pure functions with explicit inputs and outputs

#### Error Handling

- **Result types**: Use `Result<T>` pattern (`{ kind: "Ok", value: T } | { kind: "Error", error: string }`) instead of exceptions
- **Explicit error handling**: Never throw from API functions; always return Result types
- **Frontend error checking**: Use `result.kind` checks instead of try/catch blocks

#### TypeScript-Specific Patterns

- **Type predicates**: Use type predicates for runtime type checking
- **Type guards**: Implement proper type guards for complex type narrowing
- **Mapped types**: Use mapped types for transforming object shapes
- **Conditional types**: Leverage conditional types for advanced type logic

#### Modern JavaScript Features

- **Optional chaining**: Use `?.` for safe property access
- **Nullish coalescing**: Use `??` for default values
- **Destructuring**: Use object and array destructuring for cleaner code
- **Spread operator**: Use spread operator for object/array manipulation

#### Code Quality

- **No inline ignores**: Avoid `// @ts-ignore` comments; fix type issues at the source
- **Proper typing**: Ensure all variables, parameters, and return values have explicit types
- **Type inference**: Let TypeScript infer types when they're obvious, but be explicit for public APIs
- **Documentation**: Use JSDoc for complex types and public API documentation

#### Project-Specific Rules

- **No Node.js APIs**: The backend runs on QuickJS, not Node.js - avoid Node.js-specific APIs
- **Uint8Array instead of Buffer**: Use `Uint8Array` for binary data manipulation
- **Custom implementations**: Implement custom encoding/decoding functions when needed
- **SDK usage**: Never add runtime checks for SDK methods; the SDK is fully typed

#### Vue Component Rules

- **Script setup**: Use `<script setup lang="ts">` syntax
- **Composition API**: Prefer Composition API over Options API
- **Reactive state**: Use `ref` and `computed` for reactive state management
- **Type-safe props**: Always type component props and emits
- **PrimeVue components**: Use PrimeVue components with dark mode theming

#### Testing Rules

- **Type-safe tests**: Write tests with proper TypeScript types
- **Mocking**: Use proper mocking for external dependencies
- **Integration tests**: Include integration tests for critical paths
- **Error cases**: Test error conditions and edge cases

#### Performance Rules

- **Avoid unnecessary computations**: Use `computed` for derived state in Vue
- **Memoization**: Use memoization for expensive calculations
- **Lazy loading**: Implement lazy loading for heavy components
- **Efficient rendering**: Optimize Vue component rendering with `v-once` and `v-memo`

#### Security Rules

- **Input validation**: Always validate external inputs
- **Sanitization**: Sanitize user-provided data before rendering
- **Secure storage**: Use proper encryption for sensitive data
- **API security**: Implement proper authentication and authorization

#### Documentation Rules

- **Clear comments**: Write comments that explain _why_, not _what_
- **Type documentation**: Document complex types and interfaces
- **API documentation**: Document all public APIs and their contracts
- **Examples**: Include usage examples for complex functionality

#### Modern Tooling

- **ESLint**: Use ESLint with TypeScript plugin for code quality
- **Prettier**: Use Prettier for consistent code formatting
- **TypeScript compiler**: Use strict compiler options for maximum type safety
- **Modern build tools**: Use modern build tools like Vite and esbuild

#### Code Examples

**Good - Type-safe function with Result pattern:**

```typescript
function parseUserInput(input: string): Result<UserData> {
  try {
    const data = JSON.parse(input) as unknown;
    if (isUserData(data)) {
      return { kind: "Ok", value: data };
    }
    return { kind: "Error", error: "Invalid user data format" };
  } catch (error) {
    return { kind: "Error", error: "Failed to parse input" };
  }
}

function isUserData(data: unknown): data is UserData {
  return (
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    typeof data.name === "string"
  );
}
```

**Good - Early return pattern:**

```typescript
function processOrder(order: Order): Result<ProcessedOrder> {
  if (order.items.length === 0) {
    return { kind: "Error", error: "Order cannot be empty" };
  }

  if (!order.customer) {
    return { kind: "Error", error: "Customer information required" };
  }

  // Process the valid order...
  return { kind: "Ok", value: processedOrder };
}
```

**Good - Type predicate for runtime checking:**

```typescript
type AdminUser = {
  type: "admin";
  permissions: string[];
};

type RegularUser = {
  type: "regular";
  accessLevel: number;
};

type User = AdminUser | RegularUser;

function isAdminUser(user: User): user is AdminUser {
  return user.type === "admin";
}

function getUserCapabilities(user: User): string[] {
  if (isAdminUser(user)) {
    return user.permissions;
  }
  return ["basic_access"];
}
```

**Bad - Avoid any type:**

```typescript
// ❌ Avoid this
function processData(data: any): any {
  // No type safety
  return data.processed;
}

// ✅ Do this instead
function processData<T>(data: T): ProcessedResult<T> {
  // Type-safe processing
  return { original: data, processed: transform(data) };
}
```

**Bad - Avoid deep nesting:**

```typescript
// ❌ Avoid deep nesting
function processRequest(request: Request): Result<Response> {
  if (request.valid) {
    if (request.data) {
      if (request.data.items) {
        // Deeply nested logic
        return processItems(request.data.items);
      } else {
        return { kind: "Error", error: "No items found" };
      }
    } else {
      return { kind: "Error", error: "No data provided" };
    }
  } else {
    return { kind: "Error", error: "Invalid request" };
  }
}

// ✅ Use early returns instead
function processRequest(request: Request): Result<Response> {
  if (!request.valid) {
    return { kind: "Error", error: "Invalid request" };
  }

  if (!request.data) {
    return { kind: "Error", error: "No data provided" };
  }

  if (!request.data.items) {
    return { kind: "Error", error: "No items found" };
  }

  return processItems(request.data.items);
}
```

### Error Handling

- Backend APIs return `Result<T>` types: `{ kind: "Ok", value: T } | { kind: "Error", error: string }`
- Frontend checks `result.kind` instead of try/catch
- Never throw from API functions

### String Comparisons

- Use `str !== undefined` instead of `!str` (linter requires explicit nullable handling)

### Vue Components

- Use `<script setup lang="ts">`
- Use PrimeVue components with dark mode theming
- Use `computed` for derived state
- Icons: `fas fa-[name]` only

### Naming

- Folders: camelCase
- Component folders: PascalCase
- Files: camelCase

## Caido SDK Imports

```typescript
// Backend
import { SDK, DefineAPI, DefineEvents } from "caido:plugin";
import { Blob, fetch } from "caido:http";

// Frontend
import { Caido } from "@caido/sdk-frontend";
import { RequestSpec } from "caido:utils";
import type { Request, Response } from "caido:utils";
```

## SDK Usage

- Never add runtime checks for SDK methods (`typeof`, `in` operator)
- SDK is fully typed - use documented methods directly
- Use `sdk.window.showToast(message, { variant: "error" | "success" })` for notifications
