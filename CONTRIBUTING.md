# Contributing

Contributions to the public LightBaker product interface are welcome.

Start with [workspace authority](../lumen-workspace/README.md), repository AGENTS and [Lumen handoff](docs/LUMEN-HANDOFF.md). The actual Lumen runtime owns high-fidelity playback; do not duplicate it here.

## Scope

In scope:

- website/product UI;
- accessibility and responsive behavior;
- result viewing and job-progress UX;
- public high-level API client behavior;
- documentation and examples;
- authored scene fixtures and host-neutral delivery integration.

Out of scope:

- private baking renderer implementation (the existing editable Three viewport remains in scope);
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
