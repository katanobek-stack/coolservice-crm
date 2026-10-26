# Warehouse Workspace Implementation Plan

> Execute inline with superpowers:executing-plans, test-driven-development and verification-before-completion.

**Goal:** Make warehouse equipment easy to find and manage in the established CRM style while preserving camera artwork and motion.
**Architecture:** Pure selection helpers, a context-free WarehouseWorkspace, existing FreezersTab mutation/detail integration. Scoped warehouse CSS.
**Tech Stack:** Existing React, TypeScript, CSS, Node tests, Vite, Firebase transactions.
**Spec:** docs/superpowers/specs/2026-10-26-warehouse-workspace-design.md

## Constraints / review focus
Preserve SVG and animation; no schema/API/role changes, no production QA records or new dependencies. Loading/errors must not become zeros. Dates must use Vladivostok; missing/invalid dates must not imply overdue. Search and sort must not mutate source. Hidden amounts must not appear in mechanic summaries. Deleted selected records must not stay editable.

## Tasks
- [x] Write and run failing warehouse selection tests (legacy rental, dates, search, sort, invalid numbers).
- [x] Implement warehouseLogic.ts and verify tests pass.
- [x] Write/run failing SSR checks for WarehouseWorkspace source states and role summaries; implement directory, filters, groups/table and scoped CSS.
- [x] Integrate existing FreezerCard without modifying SVG or motion rules; add payment metadata outside artwork. Improve detail hierarchy, form validation/error recovery, source readiness and live selection.
- [x] Run typecheck, complete unit suite and production build. Inspect rendered actual components at desktop/480 using fictional data and blocked writes. Review final diff, repair issues and remove QA harness.
- [ ] Commit, push and verify existing Pages deployment under prior authorization.

## Verification ledger
- Final TypeScript check, 165 unit/SSR checks and Vite build passed. Existing bundle size advisory remains.
- Independent read-only reviewer found two related rental-term clearing issues; fixed with explicit empty persistence and reopened-field normalization, regression checked; final review approved.
- Actual FreezersTab rendered in browser with mocked context and blocked mutation helpers; no Firebase connection or production QA writes. Desktop at 1280 and iframe viewport 480; checked cards/long text, rental detail, table, search, edit and new rental blocked-save errors with retained inputs. At 480: document scrollWidth476, modal client/scrollWidth474, no horizontal overflow. Additional narrow browser view checked at453.
- Source FreezerCard.tsx and freezers.css unchanged, preserving exact illustration geometry and fan/air/snow animations.
- Ruling: Default ungrouped catalog avoids large empty grid areas when one status has a single camera; optional status grouping retained.
- Temporary QA harness, fixtures, scripts, styles and HTML deleted. Screenshot retained outside repository in the chat visualization directory.
