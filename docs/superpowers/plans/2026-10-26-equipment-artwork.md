# Equipment Artwork Implementation Plan

Use writing-plans, execute inline with executing-plans, test-driven-development and verification-before-completion.

**Goal:** Replace the old cube illustrations with a coherent premium industrial product family and mechanically registered motion.
**Architecture:** New image assets + focused EquipmentScene component + scoped scene CSS; retain FreezerCard data and button semantics.
**Spec:** docs/superpowers/specs/2026-10-26-equipment-art-direction.md

- [x] Generate and inspect four artwork assets with built-in ImageGen; preserve final prompts in artwork notes, optimize assets into repository.
- [x] Write failing scene tests, implement category mapping and reusable layered fan/airflow scene. Replace old illustration and snow, keep client data and card actions.
- [x] Review artwork/overlay registration in browser at desktop/480, rental vs available, reduced-motion, long cards; repair defects and remove synthetic QA harness.
- [x] Run typecheck, unit suite and build; independent review.

Publication: commit/push and deployment verification follow the checks and are reported in the chat after this commit.

## Verification ledger
Final TypeScript check,166 unit/SSR checks and Vite build passed. Four WebP assets total283778 bytes; packaged outside JavaScript with lazy loading. Existing bundle-size advisory remains. Actual cards inspected at1280 and480px; rental rotor transforms move while guards remain fixed; switching off rental returns animationName none. A broken image was simulated in the local harness: failed=true, mechanics visibility hidden, card metadata retained. Reduced-motion CSS is covered by source checks. Independent code review approved. Temporary QA HTML/TSX removed. No Firebase or real-data writes were used.
