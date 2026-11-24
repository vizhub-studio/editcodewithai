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
 * that could be applied safely under the selected policy; `warnings` describes
 * failures. In atomic mode, a failed patch rolls back all patches to that file.
 */
export interface ApplyResult {
  files: VizFiles;
  warnings: ApplyWarning[];
}

/** Optional policy for safe diff application. */
export interface ApplyOptions {
  /** Roll back all patches to a resolved file if any patch to it fails. Default: false. */
  atomicPerFile?: boolean;
}

export type LlmFunction = (prompt: string) => Promise<{
  content: string;
  generationId?: string;
}>;

export interface PerformAiEditParams extends ApplyOptions {
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
