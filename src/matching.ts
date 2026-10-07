/**
 * Deterministic anchor matching for edit application.
 *
 * This module intentionally implements only deterministic strategies. It never
 * guesses a location via similarity scoring; if a deterministic match cannot be
 * found, callers skip the edit and report a warning.
 *
 * Strategies, in order:
 *   1. `exact`           — the anchor is a literal substring.
 *   2. `line-normalized` — both sides split into lines and compared with
 *                          trailing whitespace removed. This absorbs CRLF vs LF
 *                          drift, a missing/extra trailing newline, and
 *                          trailing-whitespace drift.
 *
 * Leading indentation drift is deliberately NOT handled (deferred).
 */

export type MatchStrategy = "exact" | "line-normalized";

export interface AnchorMatch {
  start: number;
  end: number;
  strategy: MatchStrategy;
  /** Number of equally-valid locations found. `> 1` means ambiguous. */
  matchCount: number;
}

interface LineInfo {
  text: string;
  /** Character offset of the start of the line. */
  start: number;
  /** Character offset just past the line's content (excludes the newline). */
  end: number;
}

/**
 * Splits text into lines while retaining each line's character offsets.
 * A trailing newline produces a final empty line, matching `String.split("\n")`.
 */
function splitLinesWithOffsets(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  if (text.length === 0) return lines;

  let start = 0;
  // Loop is bounded: `start` always advances past the newline.
  for (;;) {
    const newlineIndex = text.indexOf("\n", start);
    if (newlineIndex === -1) {
      lines.push({ text: text.slice(start), start, end: text.length });
      break;
    }
    lines.push({
      text: text.slice(start, newlineIndex),
      start,
      end: newlineIndex,
    });
    start = newlineIndex + 1;
    if (start === text.length) {
      lines.push({ text: "", start, end: start });
      break;
    }
  }

  return lines;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function findLineNormalized(
  source: string,
  anchor: string,
): AnchorMatch | null {
  const sourceLines = splitLinesWithOffsets(source);
  const anchorLines = splitLinesWithOffsets(anchor);

  // Trailing/leading blank lines carry no anchoring information.
  while (
    anchorLines.length > 0 &&
    anchorLines[anchorLines.length - 1].text.trim() === ""
  ) {
    anchorLines.pop();
  }
  while (anchorLines.length > 0 && anchorLines[0].text.trim() === "") {
    anchorLines.shift();
  }

  if (anchorLines.length === 0) return null;
  if (anchorLines.length > sourceLines.length) return null;

  const normalizedAnchor = anchorLines.map((line) => line.text.trimEnd());
  const normalizedSource = sourceLines.map((line) => line.text.trimEnd());

  let matchCount = 0;
  let first: { start: number; end: number } | null = null;

  for (let i = 0; i + normalizedAnchor.length <= sourceLines.length; i++) {
    let isMatch = true;
    for (let j = 0; j < normalizedAnchor.length; j++) {
      if (normalizedSource[i + j] !== normalizedAnchor[j]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      matchCount++;
      if (first === null) {
        first = {
          start: sourceLines[i].start,
          end: sourceLines[i + normalizedAnchor.length - 1].end,
        };
      }
    }
  }

  if (first === null) return null;
  return {
    start: first.start,
    end: first.end,
    strategy: "line-normalized",
    matchCount,
  };
}

/**
 * Finds `anchor` within `source` using deterministic strategies only.
 *
 * Returns `null` when no deterministic match exists. When a match exists,
 * `matchCount` reports how many equivalent locations were found so callers can
 * skip ambiguous edits.
 */
export function findAnchor(source: string, anchor: string): AnchorMatch | null {
  if (anchor.length === 0 || source.length === 0) return null;

  const exactIndex = source.indexOf(anchor);
  if (exactIndex !== -1) {
    return {
      start: exactIndex,
      end: exactIndex + anchor.length,
      strategy: "exact",
      matchCount: countOccurrences(source, anchor),
    };
  }

  return findLineNormalized(source, anchor);
}
