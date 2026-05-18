# Contributing

Thanks for your interest in contributing to json-schema-sketch!

## Setup

```bash
git clone <your-fork>
cd json-schema-sketch
npm install
```

## Development

```bash
npm run build    # TypeScript → dist/
npm test         # build + run all tests
```

Tests use Node's built-in test runner (`node:test`). No extra test framework needed.

## Project structure

```
src/
  index.ts        — barrel re-export (public API surface)
  types.ts        — SchemaNode and RenderOptions interfaces
  inference.ts    — inferSchema() and helpers (sampling, merging, optional keys)
  rendering.ts    — renderSchema() and helpers (inline/multiline formatting)
  path-resolver.ts — resolvePath() for dot/bracket path resolution
test/
  inference.test.ts
  rendering.test.ts
  path-resolver.test.ts
```

## Guidelines

- Keep zero runtime dependencies.
- Add tests for new functionality — mirror the `src/` structure in `test/`.
- Run `npm test` before submitting a PR.
