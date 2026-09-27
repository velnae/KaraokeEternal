# Karaoke MVP — Baseline Report

## Environment

- Compared branches: `main` and `feature/karaoke-mvp`.
- Node.js: `v24.19.0`.
- npm: `11.9.0`.
- Install command: `npm ci`.

## Results before Phase 1

| Check | `main` | Initial MVP branch | Classification |
| --- | --- | --- | --- |
| `npm run lint` | Failed: 30 errors | Failed: 32 errors | 30 inherited; 2 introduced by `Rooms.getPlayerStatus()` |
| `npm run typecheck` | Failed: `Player.tsx` TS2604 | Same failure | Inherited |
| `npm test` | Passed: 35 tests | Passed: 35 tests | No regression |
| `npm run build` | Passed with warnings | Passed with warnings | No observed branch regression |

## Baseline findings

1. The two branch lint regressions were explicit `any` annotations added with `Rooms.getPlayerStatus()`.
2. The inherited TypeScript failure is:

   ```text
   src/routes/Player/components/Player/Player.tsx(137,10):
   TS2604: JSX element type 'PlayerComponent' does not have any construct or call signatures.
   ```

3. The build script uses `;` between server and client builds, and the server build uses `--noEmitOnError false`. Therefore `npm run build` is not a substitute for the separate `npm run typecheck` gate.
4. The inherited lint baseline contains 30 errors, primarily existing explicit `any` usages.
5. Before Phase 1, the only automated coverage consisted of 35 media metadata parser tests.

## Phase 0 decision

- Remove the two lint regressions introduced by the MVP branch.
- Do not expand Phase 0 into cleanup of all inherited lint/type errors.
- Continue running typecheck as a separate required gate and report the inherited failure explicitly.
- Add focused automated coverage with each MVP business rule.

## Results after Phases 0 and 1

| Check | Result |
| --- | --- |
| Branch-specific lint regression | Resolved; lint is back to the inherited 30-error baseline |
| Typecheck | Only the inherited `Player.tsx` TS2604 failure remains |
| Automated tests | 55 passed across 5 files; 20 tests added over the original baseline |
| Production build | Passed with the same inherited size/license warnings |
| Development HTTP smoke test | Passed; compiled successfully and returned the application shell with HTTP 200 |

Vitest now excludes `build/**`, preventing compiled test files from being discovered and executed a second time after a build.
