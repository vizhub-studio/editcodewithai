import { VizFiles } from "@vizhub/viz-types";
import { findAnchor } from "./matching";
import type { ApplyOptions, ApplyResult, ApplyWarning, ParsedEdit } from "./types";

type FileResolution =
  { kind: "found"; id: string } | { kind: "ambiguous" } | { kind: "none" };

/**
 * Normalizes a filename for comparison: trims, converts Windows separators to
 * "/", collapses duplicate separators, and strips leading "./" and "/".
 *
 * Case is intentionally preserved here; callers that need to tolerate case
 * drift fall back to case-insensitive and basename matching after this exact
 * normalized comparison fails.
 */
function normalizeFileName(name: string): string {
  return name
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

function normalizeForBasename(name: string): string {
  const normalized = normalizeFileName(name).toLowerCase();
  return normalized.substring(normalized.lastIndexOf("/") + 1);
}

function resolveFileId(files: VizFiles, rawName: string): FileResolution {
  const target = normalizeFileName(rawName);
  const ids = Object.keys(files);

  // 1. Exact match on the normalized name.
  const exact = ids.filter(
    (id) => normalizeFileName(files[id].name) === target,
  );
  if (exact.length === 1) return { kind: "found", id: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous" };

  // 2. Case-insensitive match on the normalized name.
  const lowerTarget = target.toLowerCase();
  const caseInsensitive = ids.filter(
    (id) => normalizeFileName(files[id].name).toLowerCase() === lowerTarget,
  );
  if (caseInsensitive.length === 1)
    return { kind: "found", id: caseInsensitive[0] };
  if (caseInsensitive.length > 1) return { kind: "ambiguous" };

  // 3. Basename match (substring after the last "/"), case-insensitive.
  const basename = lowerTarget.substring(lowerTarget.lastIndexOf("/") + 1);
  const byBasename = ids.filter(
    (id) => normalizeForBasename(files[id].name) === basename,
  );
  if (byBasename.length === 1) return { kind: "found", id: byBasename[0] };
  if (byBasename.length > 1) return { kind: "ambiguous" };

  return { kind: "none" };
}

function anchorOf(edit: ParsedEdit): string {
  return edit.kind === "diff" ? edit.search : edit.original;
}

function replacementOf(edit: ParsedEdit): string {
  return edit.kind === "diff" ? edit.replace : edit.updated;
}

/**
 * Applies parsed edits on a best-effort basis.
 *
 * Each edit is applied independently: an edit that cannot be applied safely is
 * skipped and reported in `warnings`, and never prevents other edits from being
 * applied. With atomicPerFile, any failed edit rolls back all edits to its
 * resolved file ID. Unresolved targets are reported but never guessed.
 * The input `files` is never mutated.
 *
 * This function only throws for programmer error; anticipated model-output
 * failures are reported as warnings.
 */
export function applyEditsSafe(
  files: VizFiles,
  edits: ParsedEdit[],
  options: ApplyOptions = {},
): ApplyResult {
  const work: VizFiles = JSON.parse(JSON.stringify(files));
  const warnings: ApplyWarning[] = [];
  const failedFileIds = new Set<string>();

  for (const edit of edits) {
    const resolution = resolveFileId(work, edit.fileName);

    if (resolution.kind === "ambiguous") {
      warnings.push({
        code: "AMBIGUOUS_FILE",
        fileName: edit.fileName,
        message: `Skipped ${edit.fileName}: multiple files share that name.`,
      });
      continue;
    }

    if (resolution.kind === "none") {
      warnings.push({
        code: "FILE_NOT_FOUND",
        fileName: edit.fileName,
        message: `Skipped changes to ${edit.fileName}: file not found.`,
      });
      continue;
    }

    const recordFailure = () => {
      if (options.atomicPerFile) failedFileIds.add(resolution.id);
    };
    const anchor = anchorOf(edit);
    if (anchor.trim() === "") {
      recordFailure();
      warnings.push({
        code: "EMPTY_SEARCH",
        fileName: edit.fileName,
        message: `Skipped a change to ${edit.fileName}: the search block was empty.`,
      });
      continue;
    }

    const file = work[resolution.id];
    const match = findAnchor(file.text, anchor);

    if (match === null) {
      recordFailure();
      warnings.push({
        code: edit.kind === "udiff" ? "HUNK_NOT_FOUND" : "SEARCH_NOT_FOUND",
        fileName: edit.fileName,
        message:
          edit.kind === "udiff"
            ? `Skipped part of a change to ${edit.fileName}: referenced lines were not found.`
            : `Skipped a change to ${edit.fileName}: the referenced code was not found.`,
      });
      continue;
    }

    // Ambiguous anchors are never guessed: skip rather than replace the first.
    if (match.matchCount > 1) {
      recordFailure();
      warnings.push({
        code: "AMBIGUOUS_SEARCH",
        fileName: edit.fileName,
        message: `Skipped a change to ${edit.fileName}: the referenced code matched ${match.matchCount} locations.`,
      });
      continue;
    }

    file.text =
      file.text.slice(0, match.start) +
      replacementOf(edit) +
      file.text.slice(match.end);
  }

  for (const id of failedFileIds) {
    work[id].text = files[id].text;
  }

  return { files: work, warnings };
}
