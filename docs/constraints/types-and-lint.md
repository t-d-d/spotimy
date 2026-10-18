# Types and lint
Relevance: Compiler options, lint rules, a new boundary where data enters, or any cast or disabled rule: tsconfig*.json, eslint.config.js, lint-rules/**, schemas
Decision: Every TypeScript strictness option is on, lint is type-aware with no warnings, and outside data is parsed by a schema before use.

Why: The compiler is the first reviewer, and an asserted type proves
nothing about what Spotify, a browser or the table sent.

## Rules

- strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  noImplicitOverride, noImplicitReturns, noFallthroughCasesInSwitch,
  noUnusedLocals and noUnusedParameters are on, everywhere.
- No any, no non-null assertion, no @ts-ignore, no unsafe assertion.
- Everything from outside is parsed by a schema: Spotify's answers,
  request bodies, cookies, stored items, the environment.
- Bodies are read in service/src/http.ts only.
- Types are inferred from schemas.
- No floating promises. Every switch is exhaustive.
- A lint rule is an error or off. Zero warnings.
- A disabled rule carries its reason on the same line.
- The page and the service never import each other. What both need
  lives in shared/.

## Do not

- Cast outside data to a type.
- Loosen an option for one folder, tests included.
- Disable a rule for a whole file.

History: Set when the repo was made, October 2026, following askme-mcp.
