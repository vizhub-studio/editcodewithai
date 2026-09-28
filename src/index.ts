import { parseMarkdownFiles, formatMarkdownFiles } from "llm-code-format";
import type { VizFiles } from "@vizhub/viz-types";
import type {
  PerformAiEditParams,
  PerformAiEditResult,
  ApplyWarning,
} from "./types";
import {
  PROMPT_TEMPLATE_VERSION,
  assembleFullPrompt,
  FORMAT_INSTRUCTIONS,
} from "./prompt";
import { getGenerationMetadata } from "./metadata";
import {
  prepareFilesForPrompt,
  mergeFileChanges,
  parseDiffs,
  applyDiffs,
  applyDiffsSafe,
  parseDiffFenced,
  parseUdiffs,
  applyUdiffs,
  applyUdiffsSafe,
  applyHybridEdits,
  applyHybridEditsSafe,
  isImageFile,
} from "./fileUtils";

export type {
  LlmFunction,
  PerformAiEditParams,
  PerformAiEditResult,
  EditFormat,
  ApplyWarning,
  ApplyWarningCode,
  ApplyResult,
  ParsedEdit,
} from "./types";

export {
  FORMAT_INSTRUCTIONS,
  mergeFileChanges,
  prepareFilesForPrompt,
  isImageFile,
  parseDiffs,
  applyDiffs,
  applyDiffsSafe,
  parseDiffFenced,
  parseUdiffs,
  applyUdiffs,
  applyUdiffsSafe,
  applyHybridEdits,
  applyHybridEditsSafe,
  assembleFullPrompt,
  getGenerationMetadata,
  PROMPT_TEMPLATE_VERSION,
};

const debug = false;

/**
 * Core AI logic for:
 * - Building the prompt (including context)
 * - Calling the provided LLM function
 * - Parsing and merging file changes
 * - Retrieving cost metadata
 */
export async function performAiEdit({
  prompt,
  files,
  llmFunction,
  apiKey,
  editFormat = "whole",
}: PerformAiEditParams): Promise<PerformAiEditResult> {
  // 1. Format the existing files into the "markdown code block" format
  const preparedResult = prepareFilesForPrompt(files);
  const filesContext = formatMarkdownFiles(preparedResult.files);

  // 2. Assemble the final prompt
  const fullPrompt = assembleFullPrompt({
    filesContext,
    prompt,
    editFormat,
    imageFiles: preparedResult.imageFiles,
  });
  debug && console.log("[performAiEdit] fullPrompt:", fullPrompt);

  // 3. Invoke the model via the provided LLM function
  const result = await llmFunction(fullPrompt);

  // 4. We parse the output to figure out which files changed
  const resultString = result.content;
  let changedFiles: VizFiles;
  const warnings: ApplyWarning[] = [];
  let editsParsed = 0;

  switch (editFormat) {
    case "whole": {
      const parsed = parseMarkdownFiles(resultString, "bold");
      editsParsed = Object.keys(parsed.files).length;
      changedFiles = mergeFileChanges(files, parsed.files);
      break;
    }
    case "diff": {
      const diffs = parseDiffs(resultString);
      editsParsed = diffs.length;
      const applied = applyDiffsSafe(files, diffs);
      changedFiles = applied.files;
      warnings.push(...applied.warnings);
      break;
    }
    case "diff-fenced": {
      const diffs = parseDiffFenced(resultString);
      editsParsed = diffs.length;
      const applied = applyDiffsSafe(files, diffs);
      changedFiles = applied.files;
      warnings.push(...applied.warnings);
      break;
    }
    case "udiff": {
      const hunks = parseUdiffs(resultString);
      editsParsed = hunks.length;
      const applied = applyUdiffsSafe(files, hunks);
      changedFiles = applied.files;
      warnings.push(...applied.warnings);
      break;
    }
    case "hybrid": {
      const diffs = parseDiffs(resultString);
      const wholeFiles = parseMarkdownFiles(resultString, "bold").files;
      editsParsed = diffs.length + Object.keys(wholeFiles).length;
      const applied = applyHybridEditsSafe(
        resultString,
        files,
        (text) => parseMarkdownFiles(text, "bold").files,
      );
      changedFiles = applied.files;
      warnings.push(...applied.warnings);
      break;
    }
    default:
      // This will catch any unhandled or unknown edit formats.
      throw new Error(`Unknown edit format: ${editFormat}`);
  }

  // Zero parsed edits is worth surfacing, but only when nothing else was
  // reported — otherwise it just adds noise on top of real failures.
  if (editsParsed === 0 && warnings.length === 0) {
    warnings.push({
      code: "NO_EDITS_PARSED",
      message: "The model returned no applicable edits.",
    });
  }

  // 6. Retrieve cost metadata for charging the user
  const openRouterGenerationId = result.generationId || "";
  let upstreamCostCents = 0;
  let provider = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (openRouterGenerationId && apiKey) {
    const costData = await getGenerationMetadata({
      apiKey,
      generationId: openRouterGenerationId,
    });
    upstreamCostCents = costData.upstreamCostCents;
    provider = costData.provider;
    inputTokens = costData.inputTokens;
    outputTokens = costData.outputTokens;
  }

  return {
    changedFiles,
    openRouterGenerationId,
    upstreamCostCents,
    provider,
    inputTokens,
    outputTokens,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    rawResponse: resultString, // Include the raw response
    warnings,
  };
}
