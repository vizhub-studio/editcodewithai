# editcodewithai

A lightweight, model-agnostic library for AI-powered code editing.

See also [vizhub-benchmarks](https://github.com/vizhub-core/vizhub-benchmarks).

## Overview

`editcodewithai` is a JavaScript/TypeScript library that enables AI-powered code editing in your applications. It provides a simple interface to send code files and instructions to an LLM (Large Language Model) and receive edited code in return.

The library is designed to be **model-agnostic** — you provide a function that calls any LLM provider (OpenAI, Anthropic, OpenRouter, local models, etc.), and `editcodewithai` handles the prompt engineering, file parsing, and response processing.

Edit formats inspired by [Aider](https://aider.chat/). See [Aider: Edit Formats](https://aider.chat/docs/more/edit-formats.html) for details.

## Installation

```bash
npm install editcodewithai
```

## Usage

Here's a basic example of how to use `performAiEdit` to update a file:

```typescript
import {
  performAiEdit,
  FORMAT_INSTRUCTIONS,
  LlmFunction,
} from "editcodewithai";
import { VizFiles } from "@vizhub/viz-types";

// Your function to call the LLM
const myLlmFunction: LlmFunction = async (prompt: string) => {
  // ... call your LLM API with the prompt
  const llmResponse = "...";
  return {
    content: llmResponse, // The raw string response from the LLM
    generationId: "some-generation-id", // Optional, for cost tracking with OpenRouter
  };
};

const files: VizFiles = {
  file1: {
    name: "index.js",
    text: 'console.log("Hello, World!");',
  },
};

const prompt = 'Change the greeting to "Hello, Universe!"';

async function main() {
  const result = await performAiEdit({
    prompt,
    files,
    llmFunction: myLlmFunction,
    editFormat: "diff", // Specify the desired edit format
  });

  console.log(result.changedFiles["file1"].text);
  // Expected output: console.log("Hello, Universe!");
}

main();
```

## Edit Formats

This library supports five edit formats that instruct the LLM on how to specify file changes. Different models may perform better with different formats. You specify the format via the `editFormat` parameter in `performAiEdit`.

| Format        | Description                                                                                 | File path location       |
| ------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `whole`       | Complete file replacement (default). Simple but wasteful for small changes in large files.  | After `**file.js**` bold |
| `diff`        | Search/replace blocks. Efficient — only the changed portions are transmitted. (Aider-style) | Outside the code fence   |
| `diff-fenced` | Same search/replace blocks, but with file path _inside_ the code fence.                     | Inside the code fence    |
| `udiff`       | Unified diff format. Each hunk shows exact lines to add/remove with surrounding context.    | After `---` / `+++`      |
| `hybrid`      | Mix-and-match: the LLM chooses per file whether to use `whole` or `diff` format.            | Both styles supported    |

### `whole` (default)

The LLM returns the complete, updated content for each file that needs changes. The file name is written in bold (`**name**`) followed by a fenced code block.

**Example LLM response:**

````
**index.js**
```js
console.log("Hello, Universe!");
```
````

### `diff`

The LLM returns search/replace blocks. Each block specifies the file path on its own line, then a fenced block containing a `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` section. The library finds the `SEARCH` text in the original file and replaces it with the `REPLACE` text.

**Example LLM response:**

````
index.js
```
<<<<<<< SEARCH
console.log("Hello, World!");
=======
console.log("Hello, Universe!");
>>>>>>> REPLACE
```
````

### `diff-fenced`

Same search/replace concept as `diff`, but the file path is placed on the first line _inside_ the code fence instead of outside it.

**Example LLM response:**

````
```
index.js
<<<<<<< SEARCH
console.log("Hello, World!");
=======
console.log("Hello, Universe!");
>>>>>>> REPLACE
```
````

### `udiff`

The LLM returns standard unified diff hunks inside a ` ```diff ` code fence. Each hunk begins with `@@ ... @@` and uses `-` / `+` prefixes for removed / added lines. Lines prefixed with a space are context used for matching.

**Example LLM response:**

````diff
```diff
--- index.js
+++ index.js
@@ -1 +1 @@
-console.log("Hello, World!");
+console.log("Hello, Universe!");
```
````

### `hybrid`

The LLM can mix both whole-file and search/replace formats in the same response, choosing per file which is more appropriate. Use the **whole-file format** for major rewrites, new files, or when many parts of a file change. Use the **search/replace diff format** for small, targeted changes. If the same file appears in both formats, the whole-file content takes precedence (applied after the diff).

**Example LLM response:**

````
alpha.js
```
<<<<<<< SEARCH
const greeting = "Hello";
=======
const greeting = "Hi";
>>>>>>> REPLACE
```

**beta.js**

```js
// Entirely rewritten file
const beta = "new version";
```
````

## File Operations

The library handles several file operations automatically:

- **Updating existing files**: When the AI modifies a file's content (using any edit format).
- **Creating new files**: When the AI includes a file name that doesn't exist in the original set.
- **Deleting files**: When the AI returns empty/whitespace-only content for a file (works with `whole` format; for `diff`/`udiff`, deletions happen naturally when all content is replaced).

## API Reference

### `performAiEdit(params)`

The main entry point. Accepts a `PerformAiEditParams` object and returns a `PerformAiEditResult`.

#### Input: `PerformAiEditParams`

| Property      | Type                                            | Default    | Description                                                                      |
| ------------- | ----------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `prompt`      | `string`                                        | _required_ | Natural-language instructions describing the desired changes.                    |
| `files`       | `VizFiles`                                      | _required_ | A record of file objects (`{ [id]: { name, text } }`).                           |
| `llmFunction` | `LlmFunction`                                   | _required_ | Async function that sends the assembled prompt to an LLM and returns its output. |
| `editFormat`  | `"whole" \| "diff" \| "diff-fenced" \| "udiff"` | `"whole"`  | How the LLM should specify file changes.                                         |
| `apiKey`      | `string`                                        | optional   | OpenRouter API key — if provided, cost metadata is fetched automatically.        |

#### `LlmFunction`

```typescript
type LlmFunction = (prompt: string) => Promise<{
  content: string; // The raw string response from the LLM
  generationId?: string; // OpenRouter generation ID (for cost tracking)
}>;
```

#### Output: `PerformAiEditResult`

| Property                 | Type       | Description                                                    |
| ------------------------ | ---------- | -------------------------------------------------------------- |
| `changedFiles`           | `VizFiles` | The updated file collection with all edits applied.            |
| `openRouterGenerationId` | `string`   | The generation ID from the LLM function response.              |
| `upstreamCostCents`      | `number`   | Cost in cents (only populated if `apiKey` was provided).       |
| `provider`               | `string`   | The OpenRouter provider name used.                             |
| `inputTokens`            | `number`   | Number of input (prompt) tokens billed.                        |
| `outputTokens`           | `number`   | Number of output (completion) tokens billed.                   |
| `promptTemplateVersion`  | `number`   | Version of the prompt template used (for tracking migrations). |
| `rawResponse`            | `string`   | The raw string response from the LLM, unmodified.              |

### Exported Utilities

```typescript
import {
  // --- Prompt assembly ---
  assembleFullPrompt, // Build a complete prompt string from task, files, format
  FORMAT_INSTRUCTIONS, // { whole, diff, 'diff-fenced', udiff, hybrid } — full formatting instructions
  PROMPT_TEMPLATE_VERSION,

  // --- File processing ---
  mergeFileChanges, // Merge LLM output back into original files
  prepareFilesForPrompt, // Prepare files for prompt (truncation, image exclusion)
  isImageFile, // Check if a filename refers to an image

  // --- Diff parsing (manual use) ---
  parseDiffs, // Parse search/replace blocks (diff format)
  applyDiffs, // Apply parsed diffs to a file set
  parseDiffFenced, // Parse search/replace blocks (diff-fenced format)
  parseUdiffs, // Parse unified diff hunks
  applyUdiffs, // Apply parsed unified diff hunks to a file set
  applyHybridEdits, // Apply mixed whole-file + diff edits from a single response

  // --- Cost metadata ---
  getGenerationMetadata, // Fetch OpenRouter cost data for a generation ID
} from "editcodewithai";
```

## Format Instructions

The `FORMAT_INSTRUCTIONS` export contains the exact prompt text sent to the LLM for each edit format. You can use them in custom prompts:

```typescript
import { FORMAT_INSTRUCTIONS } from "editcodewithai";

// Access instructions for a specific format
console.log(FORMAT_INSTRUCTIONS.diff);
console.log(FORMAT_INSTRUCTIONS.whole);
console.log(FORMAT_INSTRUCTIONS["diff-fenced"]);
console.log(FORMAT_INSTRUCTIONS.udiff);

// Use in your own prompts
const customPrompt = `
${FORMAT_INSTRUCTIONS.diff}

Please update the following code to add error handling:
${yourCodeHere}
`;
```

## Image File Handling

Files with image extensions (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.svg`, `.webp`) are handled specially:

- They are **excluded** from the file listing sent to the LLM (binary content is not useful in the prompt).
- Their filenames are listed separately at the end of the prompt so the LLM is aware of them (e.g., to reference them in HTML `<img>` tags).
- The `isImageFile()` utility can be used to check if a filename is an image.

## File Truncation

When preparing files for the prompt via `prepareFilesForPrompt`, large files are truncated to keep prompts manageable:

- Regular files: truncated to **500 lines**, each line capped at **200 characters**.
- CSV and JSON files: truncated to **50 lines** (these files tend to be very large).
- Image files: excluded entirely (see above).

## Benchmarking

The project includes a benchmarking system for evaluating LLM edit quality across different models and edit formats.

```bash
# Run benchmarks
npm run benchmark

# Grade results
npm run grade
```

Benchmarks live in the `benchmarks/` directory. Results, caches, and challenges are gitignored to keep the repository size small.

## OpenRouter Cost Tracking

If you provide an `apiKey` (OpenRouter API key) and your `LlmFunction` returns a `generationId` from OpenRouter, the library automatically fetches cost metadata after each edit. The result includes `upstreamCostCents`, `provider`, `inputTokens`, and `outputTokens`.

The `getGenerationMetadata` utility implements retry logic with up to 10 attempts (1 second delay) to handle the brief delay before OpenRouter makes generation metadata available.

## Similar Projects

- **[Aider](https://aider.chat/)** — AI pair programming in the terminal with local git repos. The edit formats used in this library were inspired by Aider's search/replace approach.
- **[Bolt.new / Bolt.diy](https://bolt.new/)** — Prompt, run, edit, and deploy full-stack apps in the browser.
- **[Cline](https://cline.ai/)** — AI coding assistant for VS Code.
- **[Cerebras Coder](https://www.cerebras.net/)** — Code generation using Cerebras hardware.
- **[Pear AI](https://trypear.ai/)** — Open-source AI code editor.
- **[Void](https://void.dev/)** — Open-source AI coding environment with privacy focus.
- **[Cody](https://github.com/sourcegraph/cody)** — AI coding assistant by Sourcegraph, available as IDE extensions.

## Contributing

```bash
# Clone the repository
git clone https://github.com/vizhub-core/editcodewithai.git

# Install dependencies
cd editcodewithai
npm install
```

Before submitting a PR, ensure all checks pass:

```bash
npm test
npm run typecheck
npm run prettier
# Verify the README is up to date
```

Please create an issue first before creating a PR to discuss the changes you want to make. This helps ensure that your contributions align with the project's goals and vision.

## License

MIT. See the [LICENSE](LICENSE) file for details.
