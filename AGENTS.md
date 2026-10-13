# lightbaker-web

Public scene authoring and orchestration. Editable fast viewport is distinct from actual Lumen runtime preview. Private baking code must never be bundled.

Read the current workspace map, decisions and status at `../lumen-workspace/README.md`, then repository README and current contracts. Preserve this independent Git repository and existing working changes. Keep recovery conversations and source archives outside public code.

Engineering uses `.harness/project-policy.json` and the shared installed standard at `../lumen-engine/.harness/ENGINEERING_CONTRACT.md`. Read relevant `../lumen-engine/.agents/skills/harness-*/SKILL.md` explicitly; no duplicated harness installation is required. Run `python ../lumen-engine/scripts/engineering.py verify --target . --run-tools` or the workspace coordinator. Native GPU and human visual approval are separate gates.

Use focused subagents for independent review and assign file ownership before implementation. Commit and push under the standing remote checkpoint authorization below; deployment and public publication require separate authorization.

Repository reading order: `README.md` → `docs/STUDIO-CONTRACT.md` → `docs/LUMEN-HANDOFF.md`. Remote BakeProvider and local Lumen adapter are distinct. Run `pnpm check` and `pnpm test:browser`; native private bake delivery requires separate evidence. Fast editable preview and prepared Lumen walkthrough links exist; continuous editable Lumen synchronization remains planned.

## Remote checkpoint policy

Standing user instruction (13 October 2026): after completing and validating authorized work, commit coherent changes and push to the existing remote branches. At a requested clean checkpoint, include preserved unfinished work with explicit WIP status. Keep existing default branches current without force pushes or new branches. Do not deploy, publish publicly, expose secrets or change repository visibility without separate authorization.
