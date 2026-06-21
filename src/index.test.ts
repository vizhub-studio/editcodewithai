import { describe, it, expect, vi, beforeEach } from "vitest";
import { performAiEdit, FORMAT_INSTRUCTIONS } from "./index";
import { VizFiles } from "@vizhub/viz-types";
import { LlmFunction } from "./types";

// Mock LLM function
const mockLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
  content: `**test.js**

\`\`\`js
console.log('updated');
\`\`\`
`,
  generationId: "test-generation-id",
});

// Mock the fetch function for cost metadata
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () =>
    Promise.resolve({
      data: {
        total_cost: 0.01,
        provider_name: "test-provider",
        tokens_prompt: 100,
        tokens_completion: 50,
      },
    }),
});
global.fetch = mockFetch;

describe("performAiEdit", () => {
  const mockFiles: VizFiles = {
    file1: {
      name: "test.js",
      text: 'console.log("original");',
    },
  };

  const defaultParams = {
    prompt: "Update the code",
    files: mockFiles,
    llmFunction: mockLlmFunction,
    apiKey: "test-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should process files and return expected result with 'whole' format", async () => {
    const result = await performAiEdit({
      ...defaultParams,
      editFormat: "whole",
    });

    expect(result).toMatchObject({
      openRouterGenerationId: "test-generation-id",
      upstreamCostCents: 1,
      provider: "test-provider",
      inputTokens: 100,
      outputTokens: 50,
      promptTemplateVersion: 1,
    });

    // Verify file content was updated
    expect(result.changedFiles["file1"].text).toBe("console.log('updated');");
  });

  it("should apply changes correctly with 'diff' format", async () => {
    const mockDiffLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: [
        "test.js",
        "```",
        "<<<<<<< SEARCH",
        'console.log("original");',
        "=======",
        'console.log("updated via diff");',
        ">>>>>>> REPLACE",
        "```",
      ].join("\n"),
      generationId: "test-diff-generation-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockDiffLlmFunction,
      editFormat: "diff",
    });

    expect(result.changedFiles["file1"].text).toBe(
      'console.log("updated via diff");',
    );
  });

  it("should apply changes correctly with 'diff-fenced' format", async () => {
    const mockDiffLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: [
        "```",
        "test.js",
        "<<<<<<< SEARCH",
        'console.log("original");',
        "=======",
        'console.log("updated via diff-fenced");',
        ">>>>>>> REPLACE",
        "```",
      ].join("\n"),
      generationId: "test-diff-fenced-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockDiffLlmFunction,
      editFormat: "diff-fenced",
    });

    expect(result.changedFiles["file1"].text).toBe(
      'console.log("updated via diff-fenced");',
    );
  });

  it("should apply changes correctly with 'udiff' format", async () => {
    const mockLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: [
        "```diff",
        "--- test.js",
        "+++ test.js",
        "@@ -1 +1 @@",
        '-console.log("original");',
        '+console.log("updated via udiff");',
        "```",
      ].join("\n"),
      generationId: "test-udiff-id",
    });
    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockLlmFunction,
      editFormat: "udiff",
    });
    expect(result.changedFiles["file1"].text).toBe(
      'console.log("updated via udiff");',
    );
  });

  it("should handle file deletion when empty content is returned", async () => {
    // Mock LLM function to return empty content for a file
    const mockDeleteLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: `**test.js**

\`\`\`js

\`\`\`
`,
      generationId: "test-generation-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockDeleteLlmFunction,
    });

    expect(Object.keys(result.changedFiles)).toHaveLength(0);
  });

  it("should handle new file creation", async () => {
    // Mock LLM function to return a new file
    const mockCreateLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: `**new-file.js**

\`\`\`js
console.log('new file');
\`\`\`
`,
      generationId: "test-generation-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockCreateLlmFunction,
    });

    const newFile = Object.values(result.changedFiles).find(
      (f) => f.name === "new-file.js",
    );
    expect(newFile).toBeDefined();
    expect(newFile?.text).toBe("console.log('new file');");
  });

  it("should apply changes correctly with 'hybrid' format using only diffs", async () => {
    const mockHybridLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: [
        "test.js",
        "```",
        "<<<<<<< SEARCH",
        'console.log("original");',
        "=======",
        'console.log("updated via hybrid diff");',
        ">>>>>>> REPLACE",
        "```",
      ].join("\n"),
      generationId: "test-hybrid-diff-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockHybridLlmFunction,
      editFormat: "hybrid",
    });

    expect(result.changedFiles["file1"].text).toBe(
      'console.log("updated via hybrid diff");',
    );
  });

  it("should apply changes correctly with 'hybrid' format using only whole files", async () => {
    const mockHybridWholeLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: `**test.js**

\`\`\`js
console.log("updated via hybrid whole");
\`\`\``,
      generationId: "test-hybrid-whole-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockHybridWholeLlmFunction,
      editFormat: "hybrid",
    });

    expect(result.changedFiles["file1"].text).toBe(
      'console.log("updated via hybrid whole");',
    );
  });

  it("should apply changes correctly with 'hybrid' format mixing both formats", async () => {
    const files: VizFiles = {
      file1: { name: "alpha.js", text: 'const a = "old";' },
      file2: { name: "beta.js", text: 'const b = "old";' },
    };

    const mockHybridMixedLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: [
        // Diff for alpha.js
        "alpha.js",
        "```",
        "<<<<<<< SEARCH",
        'const a = "old";',
        "=======",
        'const a = "updated via diff";',
        ">>>>>>> REPLACE",
        "```",
        "",
        // Whole-file for beta.js
        "**beta.js**",
        "",
        "\`\`\`js",
        'const b = "updated via whole";',
        "\`\`\`",
      ].join("\n"),
      generationId: "test-hybrid-mixed-id",
    });

    const result = await performAiEdit({
      prompt: "Update the code",
      files,
      llmFunction: mockHybridMixedLlmFunction,
      editFormat: "hybrid",
    });

    expect(result.changedFiles["file1"].text).toBe(
      'const a = "updated via diff";',
    );
    expect(result.changedFiles["file2"].text).toBe(
      'const b = "updated via whole";',
    );
  });

  it("should create new files with 'hybrid' format", async () => {
    const mockCreateLlmFunction: LlmFunction = vi.fn().mockResolvedValue({
      content: `**new-file.js**

\`\`\`js
console.log('new hybrid file');
\`\`\``,
      generationId: "test-hybrid-create-id",
    });

    const result = await performAiEdit({
      ...defaultParams,
      llmFunction: mockCreateLlmFunction,
      editFormat: "hybrid",
    });

    const newFile = Object.values(result.changedFiles).find(
      (f) => f.name === "new-file.js",
    );
    expect(newFile).toBeDefined();
    expect(newFile?.text).toBe("console.log('new hybrid file');");
  });
});

describe("FORMAT_INSTRUCTIONS", () => {
  it("should be exported and contain all edit formats", () => {
    expect(FORMAT_INSTRUCTIONS).toBeDefined();
    expect(typeof FORMAT_INSTRUCTIONS).toBe("object");

    // Check that all expected edit formats are present
    expect(FORMAT_INSTRUCTIONS).toHaveProperty("whole");
    expect(FORMAT_INSTRUCTIONS).toHaveProperty("diff");
    expect(FORMAT_INSTRUCTIONS).toHaveProperty("diff-fenced");
    expect(FORMAT_INSTRUCTIONS).toHaveProperty("udiff");
    expect(FORMAT_INSTRUCTIONS).toHaveProperty("hybrid");

    // Check that each format has string instructions
    expect(typeof FORMAT_INSTRUCTIONS.whole).toBe("string");
    expect(typeof FORMAT_INSTRUCTIONS.diff).toBe("string");
    expect(typeof FORMAT_INSTRUCTIONS["diff-fenced"]).toBe("string");
    expect(typeof FORMAT_INSTRUCTIONS.udiff).toBe("string");
    expect(typeof FORMAT_INSTRUCTIONS.hybrid).toBe("string");

    // Verify the instructions contain expected content
    expect(FORMAT_INSTRUCTIONS.whole).toContain("Formatting Instructions");
    expect(FORMAT_INSTRUCTIONS.diff).toContain("search/replace block format");
    expect(FORMAT_INSTRUCTIONS["diff-fenced"]).toContain(
      "file path inside the fence",
    );
    expect(FORMAT_INSTRUCTIONS.udiff).toContain("unified diff format");
    expect(FORMAT_INSTRUCTIONS.hybrid).toContain("You can mix both formats");
  });
});
