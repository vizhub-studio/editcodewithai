import { parseMarkdownFiles, formatMarkdownFiles } from "llm-code-format";
import type { PerformAiEditParams, PerformAiEditResult } from "./types";
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
  parseDiffFenced,
  parseUdiffs,
  applyUdiffs,
  applyHybridEdits,
  isImageFile,
} from "./fileUtils";

export type {
  LlmFunction,
  PerformAiEditParams,
  PerformAiEditResult,
  EditFormat,
} from "./types";

export {
  FORMAT_INSTRUCTIONS,
  mergeFileChanges,
  prepareFilesForPrompt,
  isImageFile,
  parseDiffs,
  applyDiffs,
  parseDiffFenced,
  parseUdiffs,
  applyUdiffs,
  applyHybridEdits,
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
  let changedFiles;

  switch (editFormat) {
    case "whole": {
      const parsed = parseMarkdownFiles(resultString, "bold");
      changedFiles = mergeFileChanges(files, parsed.files);
      break;
    }
    case "diff": {
      const diffs = parseDiffs(resultString);
      changedFiles = applyDiffs(files, diffs);
      break;
    }
    case "diff-fenced": {
      const diffs = parseDiffFenced(resultString);
      changedFiles = applyDiffs(files, diffs);
      break;
    }
    case "udiff": {
      const hunks = parseUdiffs(resultString);
      changedFiles = applyUdiffs(files, hunks);
      break;
    }
    case "hybrid": {
      changedFiles = applyHybridEdits(
        resultString,
        files,
        (text) => parseMarkdownFiles(text, "bold").files,
      );
      break;
    }
    default:
      // This will catch any unhandled or unknown edit formats.
      throw new Error(`Unknown edit format: ${editFormat}`);
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
  };
}
