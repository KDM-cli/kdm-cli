# PR Label System

This document describes all labels automatically applied to pull requests by the
[pr-labeler](../.github/scripts/pr-labeler.cjs) script.

- **Type labels** derived from the PR title
- **Size labels** derived from total line changes
- **Module labels** derived from changed file paths
- **Complexity labels** derived from a heuristic score

---

## Type Labels

Applied by parsing the PR title. Supports KDM-style titles (`[KDM-123-FIX-...]`),
conventional commits (`fix:`, `feat:`, `refactor:`), and plain keywords.

| Label | Triggered When |
|---|---|
| `type: bug-fix` | Title contains FIX / fix |
| `type: feature` | Title contains FEAT / feat / feature |
| `type: refactor` | Title contains REFACTOR / refactor |

**Suggested colors:** `type: bug-fix` (red), `type: feature` (green), `type: refactor` (blue)

---

## Size Labels

Applied based on the total number of lines changed (additions + deletions).

| Label | Threshold | Suggested Color |
|---|---|---|
| `size: XS` | < 10 lines | Lightest gray |
| `size: S` | < 50 lines | Light gray |
| `size: M` | < 200 lines | Medium gray |
| `size: L` | < 500 lines | Dark gray |
| `size: XL` | >= 500 lines | Darkest gray |

Exactly one size label is applied per PR. Thresholds are defined in
[`kdm-automation.json`](kdm-automation.json) under `prLabels.size`.

---

## Module Labels

Applied by matching changed file paths against the pattern map defined in
[`kdm-automation.json`](kdm-automation.json) under `prLabels.modulePaths`.

| Label | Path Pattern |
|---|---|
| `module: cli` | `src/commands/**`, `src/utils/version-check.ts`, `src/**` (fallback) |
| `module: ui` | `src/ui/**` |
| `module: config` | `src/utils/config.ts` |
| `module: logger` | `src/utils/logger.ts` |
| `module: auth` | _(not currently mapped)_ |
| `module: test` | `src/__tests__/**` |
| `module: docs` | `docs/**` |
| `module: docker` | `src/docker/**` |
| `module: k8s` | `src/kubernetes/**` |
| `module: minikube` | `src/minikube/**` |
| `module: monitor` | `src/monitor/**` |

A PR may receive multiple module labels if it touches files in several areas.
If more than 2 modules are touched, a `multi-module` indicator label is also
added.

**Suggested color for all module labels:** Consistent color family (e.g. purples)

---

## Complexity Labels

Applied based on a heuristic score that considers file count, line changes,
and module spread:

```
score = (files × 2) + (lines / 50) + (modules × 5)
```

| Label | Score Range | Suggested Color |
|---|---|---|
| `review: easy` | < 15 | Green |
| `review: medium` | < 40 | Yellow |
| `review: complex` | >= 40 | Red |

Exactly one complexity label is applied per PR. The heuristic helps reviewers
gauge the cognitive load of a review: more files, more lines, and more modules
touched all increase the score.

---

## Multi-Module Indicator

When a PR touches more than 2 distinct modules, the label `multi-module` is
added. This signals that the PR crosses subsystem boundaries and may benefit
from additional reviewer attention.

---

## Configuration Reference

All label definitions and thresholds are centralized in
[`kdm-automation.json`](kdm-automation.json) under the `prLabels` key:

- `prLabels.type` — type label name mappings
- `prLabels.size` — size label entries with `maxChanges` thresholds
- `prLabels.module` — module label name definitions
- `prLabels.complexity` — complexity label entries with `maxScore` thresholds
- `prLabels.modulePaths` — file path glob patterns → module key mappings

Modify thresholds or add new labels by editing this file. The
[pr-labeler](../.github/scripts/pr-labeler.cjs) script reads the configuration
at runtime via the shared config loader.
