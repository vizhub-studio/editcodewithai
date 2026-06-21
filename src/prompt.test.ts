import { describe, it, expect } from "vitest";
import { assembleFullPrompt, PROMPT_TEMPLATE_VERSION } from "./prompt";

describe("prompt", () => {
  describe("assembleFullPrompt", () => {
    it("should combine task, files context, and 'whole' formatting instructions by default", () => {
      const prompt = "Update the code";
      const filesContext = "**file.js**\n```js\nconsole.log('hello');\n```";

      const result = assembleFullPrompt({ filesContext, prompt });

      // Check that all parts are included
      expect(result).toContain("## Your Task");
      expect(result).toContain("Update the code");
      expect(result).toContain("## Original Files");
      expect(result).toContain(filesContext);
      expect(result).toContain("## Formatting Instructions");
      expect(result).toContain(
        "To suggest changes you MUST include the ENTIRE content of the updated file.",
      );
    });

    it("should use diff format instructions when specified", () => {
      const prompt = "Fix bugs";
      const filesContext = "**test.js**\n```js\nlet x = 1;\n```";

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        editFormat: "diff",
      });

      expect(result).toContain("<<<<<<< SEARCH");
      expect(result).not.toContain(
        "To suggest changes you MUST include the ENTIRE content of the updated file.",
      );
    });

    it("should use diff-fenced format instructions when specified", () => {
      const prompt = "Fix bugs";
      const filesContext = "**test.js**\n```js\nlet x = 1;\n```";

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        editFormat: "diff-fenced",
      });

      expect(result).toContain("<<<<<<< SEARCH");
      expect(result).toContain(
        "search/replace block format with the file path inside the fence",
      );
    });

    it("should use udiff format instructions when specified", () => {
      const prompt = "Fix bugs";
      const filesContext = "**test.js**\n```js\nlet x = 1;\n```";

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        editFormat: "udiff",
      });

      expect(result).toContain("--- path/to/filename.ext");
      expect(result).toContain("unified diff format");
    });

    it("should use hybrid format instructions when specified", () => {
      const prompt = "Fix bugs";
      const filesContext = "**test.js**\n```js\nlet x = 1;\n```";

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        editFormat: "hybrid",
      });

      expect(result).toContain("Search/replace diff format");
      expect(result).toContain("Whole file format");
      expect(result).toContain("You can mix both formats");
    });

    it("should include image files list when provided", () => {
      const prompt = "Update the code";
      const filesContext = "**file.js**\n```js\nconsole.log('hello');\n```";
      const imageFiles = ["photo.jpg", "icon.png"];

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        imageFiles,
      });

      expect(result).toContain("Image files available:");
      expect(result).toContain(" * `photo.jpg`");
      expect(result).toContain(" * `icon.png`");
    });

    it("should not include image files section when no images", () => {
      const prompt = "Update the code";
      const filesContext = "**file.js**\n```js\nconsole.log('hello');\n```";

      const result = assembleFullPrompt({ filesContext, prompt });

      expect(result).not.toContain("Image files available:");
    });

    it("should not include image files section when empty array", () => {
      const prompt = "Update the code";
      const filesContext = "**file.js**\n```js\nconsole.log('hello');\n```";
      const imageFiles: string[] = [];

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        imageFiles,
      });

      expect(result).not.toContain("Image files available:");
    });

    it("should maintain the correct order of sections", () => {
      const prompt = "Fix bugs";
      const filesContext = "**test.js**\n```js\nlet x = 1;\n```";

      const result = assembleFullPrompt({ filesContext, prompt });
      const sections = result.split("\n\n");

      // Task should come before Files, which should come before Format
      const taskIndex = sections.findIndex((s) => s.includes("## Your Task"));
      const filesIndex = sections.findIndex((s) =>
        s.includes("## Original Files"),
      );
      const formatIndex = sections.findIndex((s) =>
        s.includes("## Formatting Instructions"),
      );

      expect(taskIndex).toBeLessThan(filesIndex);
      expect(filesIndex).toBeLessThan(formatIndex);
    });

    it("should maintain the correct order with image files", () => {
      const prompt = "Fix bugs";
      const filesContext = "**test.js**\n```js\nlet x = 1;\n```";
      const imageFiles = ["test.png"];

      const result = assembleFullPrompt({
        filesContext,
        prompt,
        imageFiles,
      });

      // Image files should be at the end
      expect(result).toMatch(
        /## Formatting Instructions[\s\S]*Image files available:/,
      );
    });
  });

  it("should export a prompt template version", () => {
    expect(PROMPT_TEMPLATE_VERSION).toBe(1);
  });
});
