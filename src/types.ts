import { VizFiles } from "@vizhub/viz-types";

export type EditFormat = "whole" | "diff" | "diff-fenced" | "udiff" | "hybrid";

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
}
