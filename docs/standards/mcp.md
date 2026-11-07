---
type: standard
kind: capability
description: Read when adding or changing an MCP server, its tools, transport, or client authentication.
version: 2.0.0
applies_to: [web, backend]
---

# MCP server

MCP tools are thin, authenticated adapters over the app's own domain services.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- Domain services and permission checks stay in the app; the MCP layer is a thin transport adapter. There is no AppElent MCP runtime package.
- Each tool has an input schema, a stable output, and declared permissions. Prefer narrow tasks over arbitrary execution primitives.
- Every call validates input and resolves identity before touching user data; deny when identity or scope cannot be resolved. Repeat resource-level permission checks inside domain operations. A tool name is never authorization.
- Define how non-browser clients obtain and present credentials, including expiry and scope; a browser session cookie is not available to them. Use OAuth for third-party account access, or explicitly configured internal access control.
- Remote endpoints never share request-specific mutable state across users: choose request-scoped stateless handling or explicit durable session state.
- Browser-reachable HTTP endpoints validate `Origin` against an explicit policy and protect tool discovery when metadata is sensitive.
- Tool responses never carry provider errors or secrets.
- stdio servers write protocol data only to stdout and diagnostics to stderr.
- **Default:** remote Workers endpoints use the Cloudflare Agents SDK; local servers use the MCP SDK over stdio.

## Implementation

1. Write the domain functions first and test them without MCP.
2. Remote: mount a dedicated `/mcp` route in the app or delegate to a separate Worker, using the installed SDK's server factory and the current [Cloudflare MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/). Keep normal routing, bindings, and error handling, and confirm the handler receives the request, environment, and execution context it expects.
3. Local: document the exact launch command and required environment variable names.
4. Document the endpoint or launch command, client authentication, expected permissions, and limitations.

## Verify

- Domain: success, invalid input, unauthorized resource, stable result, and failure response.
- Protocol: initialize, tools/list, tools/call, unknown tool, invalid arguments, missing or expired credentials, and insufficient scope.
- Manual: connect with a reviewed MCP Inspector version and call each new tool with realistic input. A local Inspector call does not prove production OAuth or cross-user isolation.

## Migration

Replaces `features/mcp`. When moving off the web plugin, keep the app's auth and routes, compare current SDK interfaces, and remove feature-router dependencies, not working domain checks.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
