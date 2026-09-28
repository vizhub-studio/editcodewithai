import { VizFiles } from "@vizhub/viz-types";

export type EditFormat = "whole" | "diff" | "diff-fenced" | "udiff" | "hybrid";

/**
 * A parsed edit that can be applied independently to a file.
 * `diff`/`diff-fenced` edits are search/replace pairs; `udiff` edits are
 * original/updated blocks.
 */
export interface DiffEdit {
  kind: "diff";
  fileName: string;
  search: string;
  replace: string;
}

export interface UdiffEdit {
  kind: "udiff";
  fileName: string;
  original: string;
  updated: string;
}

export type ParsedEdit = DiffEdit | UdiffEdit;

/**
 * Reason an edit was skipped. Warnings strictly mean "something went wrong"
 * or "this edit could not be applied" — successful normalized matches are not
 * reported here.
 */
export type ApplyWarningCode =
  | "FILE_NOT_FOUND"
  | "SEARCH_NOT_FOUND"
  | "HUNK_NOT_FOUND"
  | "AMBIGUOUS_SEARCH"
  | "AMBIGUOUS_FILE"
  | "EMPTY_SEARCH"
  | "NO_EDITS_PARSED";

export interface ApplyWarning {
  code: ApplyWarningCode;
  fileName?: string;
  message: string;
}

/**
 * Result of best-effort edit application. `files` always contains the changes
 * that could be applied safely; `warnings` describes everything skipped.
 */
export interface ApplyResult {
  files: VizFiles;
  warnings: ApplyWarning[];
}

export type LlmFunction = (prompt: string) => Promise<{
  content: string;
  generationId?: string;
}>;

export interface PerformAiEditParams {
  prompt: string;
  files: VizFiles;
  llmFunction: LlmFunction;
  apiKey?: string;
  editFormat?: EditFormat;
}

export interface PerformAiEditResult {
  changedFiles: VizFiles;
  openRouterGenerationId?: string;
  upstreamCostCents?: number;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  promptTemplateVersion?: number;
  rawResponse?: string;
  /** Edits that were skipped because they could not be applied safely. */
  warnings?: ApplyWarning[];
}
