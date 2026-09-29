# Contributing

Contributions to the public LightBaker product interface are welcome.

## Scope

In scope:

- website/product UI;
- accessibility and responsive behavior;
- result viewing and job-progress UX;
- public high-level API client behavior;
- documentation and examples;
- sample-mode improvements.

Out of scope:

- renderer implementation;
- GPU shaders;
- BVH/GI transport;
- denoiser internals;
- cloud worker implementation;
- proprietary diagnostics/agent intelligence.

Those implementation details must not be copied into this public repository.

## Validate

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```
