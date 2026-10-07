# Plan: Crash-Free Edit Application

Status: Approved scope / in implementation
Target version: 2.6.0 (non-breaking, Option A)
Related code: `src/fileUtils.ts`, `src/index.ts`, `src/types.ts`, `src/prompt.ts`

---

## 1. Problem statement

When the LLM returns a well-formed edit that references something we can't match,
the library throws and **discards the entire response**:

- `applyDiffs` throws `File not found: <name>` when a `diff`/`diff-fenced` block
  targets a filename not present in `VizFiles`.
- `applyDiffs` throws `Search block not found in file: <name>` when the `SEARCH`
  text isn't an exact substring.
- `applyUdiffs` throws `File not found` / `Original content for hunk not found`
  for the same reasons.

`performAiEdit` calls these without a `try/catch`, so **one hallucinated filename
or one stale anchor destroys every valid edit in the same turn**. This is
inconsistent with the `whole` format, which already creates unknown files and
deletes on empty content.

### Objective (scoped)

> `performAiEdit` must not fail an entire model response because one edit cannot
> be applied. Apply edits independently, use only **deterministic normalization**
> to resolve harmless formatting drift, skip anything ambiguous or unmatched,
> and return structured warnings describing what was skipped. Preserve existing
> strict low-level APIs for compatibility.

This is **crash isolation**, not aggressive edit recovery. Intelligent recovery
(fuzzy matching, truncation heuristics, custom matchers) is explicitly deferred
until telemetry shows it is needed.

---

## 2. Goals / non-goals

### Goals

1. `performAiEdit` never throws because of an unmatched file/anchor/hunk.
2. Preserve 100% of independently valid edits when an unrelated edit fails.
3. Every skipped edit produces a structured `ApplyWarning` on the result.
4. Diff/udiff application becomes independent per edit/hunk.
5. Deterministic, side-effect free on the input `VizFiles`.
6. `warnings.length === 0` means every parsed edit was applied.

### Non-goals (deferred to Phase 2+)

- Fuzzy / similarity matching of any kind.
- Truncation detection via brace/bracket heuristics.
- Case-insensitive filename matching.
- Protected files (e.g. `README.md`).
- Configurable missing-file / creation policies.
- Caller-supplied matcher hooks.
- Line-number-aware udiff placement.

---

## 3. Design

Two layers:

1. **Matching primitives** (`src/matching.ts`) — pure functions from
   `(source, anchor)` to a match region or `null`. Deterministic only.
2. **Application engine** (`src/applyEngine.ts`) — `applyEditsSafe(files, edits)`
   returns `{ files, warnings }`. Never throws for anticipated model-output
   conditions. Isolates each edit.

Low-level `applyDiffs` / `applyUdiffs` / `applyHybridEdits` keep their current
throwing behavior and `VizFiles` return type (2.6.0 compatibility). New
`*Safe` variants are additive. `performAiEdit` uses the safe path.

---

## 4. Matching ladder (deterministic only)

Because a search/replace anchor is line-structured, two strategies suffice to
cover the harmless drift we care about:

1. **`exact`** — `source.indexOf(anchor)`. Counts occurrences for ambiguity.
2. **`line-normalized`** — split both into lines, compare each line with
   trailing whitespace removed (`trimEnd`). This deterministically absorbs:
   - CRLF vs LF (`\r` is trailing whitespace on a line),
   - a missing/extra trailing newline,
   - trailing-whitespace drift.

Any other mismatch → no match → skip + warn. No similarity threshold, no guessed
placement. Leading indentation drift is intentionally **not** handled.

Ambiguity rule (invariant): **more than one valid match → skip**, never
"replace first". This keeps behavior trustworthy.

Multi-line anchors are whole-line anchors in practice, so line-normalized covers
trailing-newline differences without a separate substring pass.

---

## 5. Data model (minimal public surface)

```ts
export type ApplyWarningCode =
  | "FILE_NOT_FOUND" // target filename not in VizFiles
  | "SEARCH_NOT_FOUND" // diff anchor not found
  | "HUNK_NOT_FOUND" // udiff original block not found
  | "AMBIGUOUS_SEARCH" // anchor matched more than one location
  | "AMBIGUOUS_FILE" // more than one file id shares the target name
  | "EMPTY_SEARCH" // empty anchor; cannot apply safely
  | "NO_EDITS_PARSED"; // response contained no recognizable edits

export interface ApplyWarning {
  code: ApplyWarningCode;
  fileName?: string;
  message: string;
}

export interface ApplyResult {
  files: VizFiles;
  warnings: ApplyWarning[];
}
```

`warnings` is strictly "something went wrong / was skipped". Successful
normalized matches (e.g. CRLF) are **not** warnings.

No `ApplyOptions`, no public `ApplyStats`, no `MatchStrategy` in the public API.
Metrics are derived internally when needed.

`PerformAiEditResult` gains an additive `warnings: ApplyWarning[]`.

---

## 6. Application behavior

`applyEditsSafe(files, edits)`:

1. Deep-copy `VizFiles`.
2. Resolve filename → id: trim, `\` → `/`, collapse `//`, strip leading `./`
   and `/`. Case-sensitive. 0 matches → `FILE_NOT_FOUND`; >1 → `AMBIGUOUS_FILE`.
3. Empty anchor (`anchor.trim() === ""`) → `EMPTY_SEARCH`, skip.
4. Match via §4. No match → `SEARCH_NOT_FOUND` / `HUNK_NOT_FOUND`, skip.
5. `matchCount > 1` → `AMBIGUOUS_SEARCH`, skip.
6. Otherwise splice the replacement in and continue to the next edit.

Edits are applied sequentially, so later edits for the same file see earlier
changes (existing behavior preserved).

### `whole` format

Unchanged: `mergeFileChanges` already creates unknown files and deletes on empty
content.

### `hybrid`

Diffs applied safely first, then whole-file overrides. If a diff failed on a
filename that the whole-file set also defines, the diff warning is **suppressed**
(the whole-file content supersedes it). A new `applyHybridEditsSafe` performs
this; the strict `applyHybridEdits` is unchanged.

### `NO_EDITS_PARSED`

Emitted by `performAiEdit` when zero edits were parsed across the response.

---

## 7. Prompt hardening (defense in depth)

Small additions to `FORMAT_INSTRUCTIONS`:

- Require copying filenames **exactly** as listed in "Original Files".
- Require copying `SEARCH`/context text **verbatim**.
- Reminder: do not invent filenames.
- Bump `PROMPT_TEMPLATE_VERSION` (1 → 2) and update the test.

---

## 8. Acceptance criterion

> Feed 5 diffs where 1 target is unmatched → 4 applied, 1 `FILE_NOT_FOUND`
> warning, no throw.

This is the centerpiece test.

---

## 9. Testing

- **Matching**: exact, ambiguity count, CRLF, trailing newline, trailing
  whitespace, leading-indentation drift → no match, partial-line anchor.
- **Engine**: exact apply; missing file skip+warn while others apply; ambiguous
  file skip; ambiguous search skip; empty search skip; udiff apply; udiff
  missing anchor skip+warn; input immutability; determinism.
- **Wrappers**: `applyDiffsSafe`, `applyUdiffsSafe`, `applyHybridEditsSafe`
  (incl. warning suppression).
- **Integration**: `performAiEdit` returns partial success + warnings and never
  rejects; `NO_EDITS_PARSED`.
- **Regression**: golden fixtures captured from real model output that
  previously threw.

Existing strict-path tests (`applyDiffs`/`applyUdiffs` throwing) remain green.

---

## 10. Rollout

**Phase 1 — crash-free application (this change)**

- matching primitives + engine
- safe wrappers, `performAiEdit` partial success + `warnings`
- prompt hardening
- unit + integration + regression tests
- README updates

**Phase 2 — recovery improvements (only if telemetry justifies)**

- fuzzy matching, line-number hints, matcher hooks, truncation heuristics
- consider flipping low-level defaults in 3.0

---

## 11. Decisions locked

| Decision               | Choice                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| Fuzzy matching in MVP  | No                                                                      |
| Matching strategies    | exact + line-normalized (CRLF / trailing newline / trailing whitespace) |
| Truncation guard       | Deferred                                                                |
| README protection      | No special case                                                         |
| Ambiguous anchor       | Skip + `AMBIGUOUS_SEARCH`                                               |
| Version                | 2.6.0 / Option A                                                        |
| Create file from diff  | Never                                                                   |
| Case-insensitive paths | No                                                                      |
| Caller matcher hook    | Deferred                                                                |
