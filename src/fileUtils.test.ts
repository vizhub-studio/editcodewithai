import { describe, it, expect } from "vitest";
import {
  shouldDeleteFile,
  prepareFilesForPrompt,
  isImageFile,
  mergeFileChanges,
  parseDiffs,
  applyDiffs,
  Diff,
  parseDiffFenced,
  UdiffHunk,
  parseUdiffs,
  applyUdiffs,
  applyHybridEdits,
} from "./fileUtils";
import { VizFiles, FileCollection } from "@vizhub/viz-types";

describe("fileUtils", () => {
  describe("isImageFile", () => {
    it("should identify image files by extension", () => {
      expect(isImageFile("photo.png")).toBe(true);
      expect(isImageFile("Photo.PNG")).toBe(true);
      expect(isImageFile("image.jpg")).toBe(true);
      expect(isImageFile("image.jpeg")).toBe(true);
      expect(isImageFile("icon.gif")).toBe(true);
      expect(isImageFile("bitmap.bmp")).toBe(true);
      expect(isImageFile("vector.svg")).toBe(true);
      expect(isImageFile("modern.webp")).toBe(true);
    });

    it("should not identify non-image files", () => {
      expect(isImageFile("script.js")).toBe(false);
      expect(isImageFile("style.css")).toBe(false);
      expect(isImageFile("data.json")).toBe(false);
      expect(isImageFile("README.md")).toBe(false);
      expect(isImageFile("photo.txt")).toBe(false);
      expect(isImageFile("no-extension")).toBe(false);
    });
  });

  describe("shouldDeleteFile", () => {
    it("should return true for empty file content", () => {
      expect(shouldDeleteFile({ name: "test.js", text: "" })).toBe(true);
      expect(shouldDeleteFile({ name: "test.js", text: "  " })).toBe(true);
      expect(shouldDeleteFile({ name: "test.js", text: "\n" })).toBe(true);
    });

    it("should return false for non-empty file content", () => {
      expect(
        shouldDeleteFile({ name: "test.js", text: "console.log('hi');" }),
      ).toBe(false);
    });

    it("should return false for undefined file", () => {
      expect(shouldDeleteFile(undefined)).toBe(false);
    });
  });

  describe("prepareFilesForPrompt", () => {
    it("should exclude image files and return them separately", () => {
      const files: VizFiles = {
        file1: { name: "script.js", text: "console.log('hello');" },
        file2: { name: "photo.png", text: "binary image data" },
        file3: { name: "icon.svg", text: "<svg>...</svg>" },
        file4: { name: "style.css", text: "body { margin: 0; }" },
      };

      const result = prepareFilesForPrompt(files);

      expect(result.files).toHaveProperty("script.js");
      expect(result.files).toHaveProperty("style.css");
      expect(result.files).not.toHaveProperty("photo.png");
      expect(result.files).not.toHaveProperty("icon.svg");

      expect(result.imageFiles).toEqual(["photo.png", "icon.svg"]);
    });

    it("should truncate large files", () => {
      const files: VizFiles = {
        file1: {
          name: "large.js",
          text: Array(1000).fill("console.log('line');").join("\n"),
        },
      };

      const result = prepareFilesForPrompt(files);
      expect(result.files["large.js"]).toBeDefined();
      expect(result.files["large.js"].split("\n").length).toBe(500); // Truncated to 500 lines
      expect(result.imageFiles).toEqual([]);
    });

    it("should truncate CSV and JSON files more aggressively", () => {
      const files: VizFiles = {
        file1: {
          name: "data.csv",
          text: Array(100).fill("a,b,c").join("\n"),
        },
        file2: {
          name: "data.json",
          text: Array(100).fill('{"key": "value"}').join("\n"),
        },
      };

      const result = prepareFilesForPrompt(files);

      expect(result.files["data.csv"].split("\n").length).toBe(50); // Truncated to 50 lines
      expect(result.files["data.json"].split("\n").length).toBe(50); // Truncated to 50 lines
      expect(result.imageFiles).toEqual([]);
    });

    it("should truncate long lines", () => {
      const files: VizFiles = {
        file1: {
          name: "longline.js",
          text: "console.log('" + "x".repeat(500) + "');",
        },
      };

      const result = prepareFilesForPrompt(files);
      expect(result.files["longline.js"].length).toBeLessThan(201); // Truncated to 200 chars
      expect(result.imageFiles).toEqual([]);
    });

    it("should handle files with no images", () => {
      const files: VizFiles = {
        file1: { name: "script.js", text: "console.log('hello');" },
        file2: { name: "style.css", text: "body { margin: 0; }" },
      };

      const result = prepareFilesForPrompt(files);

      expect(Object.keys(result.files)).toHaveLength(2);
      expect(result.imageFiles).toEqual([]);
    });

    it("should handle files with only images", () => {
      const files: VizFiles = {
        file1: { name: "photo.jpg", text: "binary data" },
        file2: { name: "icon.png", text: "more binary data" },
      };

      const result = prepareFilesForPrompt(files);

      expect(Object.keys(result.files)).toHaveLength(0);
      expect(result.imageFiles).toEqual(["photo.jpg", "icon.png"]);
    });
  });

  describe("mergeFileChanges", () => {
    it("should keep unchanged files", () => {
      const originalFiles: VizFiles = {
        file1: { name: "unchanged.js", text: "console.log('original');" },
      };
      const parsedFiles: FileCollection = {};

      const result = mergeFileChanges(originalFiles, parsedFiles);
      expect(result).toEqual(originalFiles);
    });

    it("should update changed files", () => {
      const originalFiles: VizFiles = {
        file1: { name: "changed.js", text: "console.log('original');" },
      };
      const parsedFiles: FileCollection = {
        "changed.js": "console.log('updated');",
      };

      const result = mergeFileChanges(originalFiles, parsedFiles);
      expect(result.file1.text).toBe("console.log('updated');");
    });

    it("should delete files with empty content", () => {
      const originalFiles: VizFiles = {
        file1: { name: "keep.js", text: "console.log('keep');" },
        file2: { name: "delete.js", text: "console.log('delete');" },
      };
      const parsedFiles: FileCollection = {
        "delete.js": "",
      };

      const result = mergeFileChanges(originalFiles, parsedFiles);
      expect(Object.keys(result)).toHaveLength(1);
      expect(result.file1).toBeDefined();
      expect(result.file2).toBeUndefined();
    });

    it("should add new files", () => {
      const originalFiles: VizFiles = {
        file1: { name: "existing.js", text: "console.log('existing');" },
      };
      const parsedFiles: FileCollection = {
        "new.js": "console.log('new');",
      };

      const result = mergeFileChanges(originalFiles, parsedFiles);
      expect(Object.keys(result)).toHaveLength(2);

      const newFile = Object.values(result).find((f) => f.name === "new.js");
      expect(newFile).toBeDefined();
      expect(newFile?.text).toBe("console.log('new');");
    });

    it("should handle multiple operations at once", () => {
      const originalFiles: VizFiles = {
        file1: { name: "keep.js", text: "console.log('keep');" },
        file2: { name: "update.js", text: "console.log('original');" },
        file3: { name: "delete.js", text: "console.log('delete');" },
      };
      const parsedFiles: FileCollection = {
        "update.js": "console.log('updated');",
        "delete.js": "",
        "new.js": "console.log('new');",
      };

      const result = mergeFileChanges(originalFiles, parsedFiles);

      // Check kept file
      expect(result.file1.text).toBe("console.log('keep');");

      // Check updated file
      expect(result.file2.text).toBe("console.log('updated');");

      // Check deleted file
      expect(result.file3).toBeUndefined();

      // Check new file
      const newFile = Object.values(result).find((f) => f.name === "new.js");
      expect(newFile).toBeDefined();
      expect(newFile?.text).toBe("console.log('new');");
    });
  });
});

describe("diff utilities", () => {
  describe("parseDiffs", () => {
    it("should parse a single valid diff block", () => {
      const responseText = [
        "path/to/file.js",
        "```",
        "<<<<<<< SEARCH",
        "const x = 1;",
        "=======",
        "const x = 2;",
        ">>>>>>> REPLACE",
        "```",
      ].join("\n");
      const expected: Diff[] = [
        {
          fileName: "path/to/file.js",
          search: "const x = 1;",
          replace: "const x = 2;",
        },
      ];
      expect(parseDiffs(responseText)).toEqual(expected);
    });

    it("should parse multiple diff blocks", () => {
      const responseText = [
        "file1.js",
        "```",
        "<<<<<<< SEARCH",
        "hello",
        "=======",
        "world",
        ">>>>>>> REPLACE",
        "```",
        "",
        "file2.js",
        "```",
        "<<<<<<< SEARCH",
        "foo",
        "=======",
        "bar",
        ">>>>>>> REPLACE",
        "```",
      ].join("\n");
      const expected: Diff[] = [
        { fileName: "file1.js", search: "hello", replace: "world" },
        { fileName: "file2.js", search: "foo", replace: "bar" },
      ];
      expect(parseDiffs(responseText)).toEqual(expected);
    });

    it("should handle multiline search and replace", () => {
      const searchBlock = `function hello() {\n  console.log("hello");\n}`;
      const replaceBlock = `function goodbye() {\n  console.log("goodbye");\n}`;
      const responseText = [
        "path/to/file.js",
        "```",
        "<<<<<<< SEARCH",
        searchBlock,
        "=======",
        replaceBlock,
        ">>>>>>> REPLACE",
        "```",
      ].join("\n");
      const expected: Diff[] = [
        {
          fileName: "path/to/file.js",
          search: searchBlock,
          replace: replaceBlock,
        },
      ];
      expect(parseDiffs(responseText)).toEqual(expected);
    });

    it("should return an empty array for invalid format", () => {
      const invalidDiff = "this is not a diff";
      expect(parseDiffs(invalidDiff)).toEqual([]);
    });
  });

  describe("applyDiffs", () => {
    it("should apply a diff to the correct file", () => {
      const files: VizFiles = {
        file1: { name: "path/to/file.js", text: "const x = 1;" },
        file2: { name: "another/file.js", text: "const y = 1;" },
      };
      const diffs: Diff[] = [
        {
          fileName: "path/to/file.js",
          search: "const x = 1;",
          replace: "const x = 2;",
        },
      ];
      const updatedFiles = applyDiffs(files, diffs);
      expect(updatedFiles.file1.text).toBe("const x = 2;");
      expect(updatedFiles.file2.text).toBe("const y = 1;");
    });

    it("should throw an error if file not found", () => {
      const files: VizFiles = {
        file1: { name: "path/to/file.js", text: "const x = 1;" },
      };
      const diffs: Diff[] = [
        {
          fileName: "nonexistent.js",
          search: "const x = 1;",
          replace: "const x = 2;",
        },
      ];
      expect(() => applyDiffs(files, diffs)).toThrow(
        "File not found: nonexistent.js",
      );
    });

    it("should throw an error if search block not found", () => {
      const files: VizFiles = {
        file1: { name: "path/to/file.js", text: "const x = 1;" },
      };
      const diffs: Diff[] = [
        {
          fileName: "path/to/file.js",
          search: "const y = 1;",
          replace: "const y = 2;",
        },
      ];
      expect(() => applyDiffs(files, diffs)).toThrow(
        "Search block not found in file: path/to/file.js",
      );
    });
  });
});

describe("diff-fenced utilities", () => {
  describe("parseDiffFenced", () => {
    it("should parse a single valid diff-fenced block", () => {
      const responseText = [
        "```",
        "path/to/file.js",
        "<<<<<<< SEARCH",
        "const x = 1;",
        "=======",
        "const x = 2;",
        ">>>>>>> REPLACE",
        "```",
      ].join("\n");
      const expected: Diff[] = [
        {
          fileName: "path/to/file.js",
          search: "const x = 1;",
          replace: "const x = 2;",
        },
      ];
      expect(parseDiffFenced(responseText)).toEqual(expected);
    });
  });
});

describe("udiff utilities", () => {
  describe("parseUdiffs", () => {
    it("should parse a simple udiff with addition and deletion", () => {
      const responseText = [
        "```diff",
        "--- file.js",
        "+++ file.js",
        "@@ -1,3 +1,3 @@",
        " line 1",
        "-line 2",
        "+line two",
        " line 3",
        "```",
      ].join("\n");
      const expected: UdiffHunk[] = [
        {
          fileName: "file.js",
          original: "line 1\nline 2\nline 3",
          updated: "line 1\nline two\nline 3",
        },
      ];
      expect(parseUdiffs(responseText)).toEqual(expected);
    });

    it("should parse a udiff with only additions", () => {
      const responseText = [
        "```diff",
        "--- file.js",
        "+++ file.js",
        "@@ -1,2 +1,3 @@",
        " line 1",
        "+new line",
        " line 2",
        "```",
      ].join("\n");
      const expected: UdiffHunk[] = [
        {
          fileName: "file.js",
          original: "line 1\nline 2",
          updated: "line 1\nnew line\nline 2",
        },
      ];
      expect(parseUdiffs(responseText)).toEqual(expected);
    });

    it("should parse a udiff with only deletions", () => {
      const responseText = [
        "```diff",
        "--- file.js",
        "+++ file.js",
        "@@ -1,3 +1,2 @@",
        " line 1",
        "-line to delete",
        " line 2",
        "```",
      ].join("\n");
      const expected: UdiffHunk[] = [
        {
          fileName: "file.js",
          original: "line 1\nline to delete\nline 2",
          updated: "line 1\nline 2",
        },
      ];
      expect(parseUdiffs(responseText)).toEqual(expected);
    });

    it("should parse multiple hunks for the same file", () => {
      const responseText = [
        "```diff",
        "--- file.js",
        "+++ file.js",
        "@@ -1,3 +1,3 @@",
        " context 1",
        "-delete 1",
        "+add 1",
        "@@ -10,3 +10,3 @@",
        " context 2",
        "-delete 2",
        "+add 2",
        "```",
      ].join("\n");
      const expected: UdiffHunk[] = [
        {
          fileName: "file.js",
          original: "context 1\ndelete 1",
          updated: "context 1\nadd 1",
        },
        {
          fileName: "file.js",
          original: "context 2\ndelete 2",
          updated: "context 2\nadd 2",
        },
      ];
      expect(parseUdiffs(responseText)).toEqual(expected);
    });
  });

  describe("applyUdiffs", () => {
    it("should apply a udiff hunk", () => {
      const files: VizFiles = {
        file1: { name: "file.js", text: " line 1\nline 2\n line 3" },
      };
      const hunks: UdiffHunk[] = [
        {
          fileName: "file.js",
          original: " line 1\nline 2\n line 3",
          updated: " line 1\nline two\n line 3",
        },
      ];
      const updatedFiles = applyUdiffs(files, hunks);
      expect(updatedFiles.file1.text).toBe(" line 1\nline two\n line 3");
    });

    it("should throw an error if original content not found", () => {
      const files: VizFiles = {
        file1: { name: "file.js", text: "some other content" },
      };
      const hunks: UdiffHunk[] = [
        {
          fileName: "file.js",
          original: " line 1\nline 2\n line 3",
          updated: " line 1\nline two\n line 3",
        },
      ];
      expect(() => applyUdiffs(files, hunks)).toThrow(
        "Original content for hunk not found in file: file.js",
      );
    });
  });
});

describe("hybrid utilities", () => {
  // Helper: a simplified whole-file parser for testing
  function parseWholeFiles(text: string): FileCollection {
    const files: FileCollection = {};
    // Matches **filename**\n\n```...``` or **filename**\n```...```
    const wholeRegex = /\*\*(.+?)\*\*\n+```(?:\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = wholeRegex.exec(text)) !== null) {
      files[match[1].trim()] = match[2].trimEnd();
    }
    return files;
  }

  describe("applyHybridEdits", () => {
    it("should apply only diff blocks when no whole-file blocks are present", () => {
      const files: VizFiles = {
        file1: { name: "test.js", text: 'console.log("original");' },
      };
      const response = [
        "test.js",
        "```",
        "<<<<<<< SEARCH",
        'console.log("original");',
        "=======",
        'console.log("updated via diff");',
        ">>>>>>> REPLACE",
        "```",
      ].join("\n");

      const result = applyHybridEdits(response, files, parseWholeFiles);
      expect(result["file1"].text).toBe('console.log("updated via diff");');
    });

    it("should apply only whole-file blocks when no diffs are present", () => {
      const files: VizFiles = {
        file1: { name: "test.js", text: 'console.log("original");' },
      };
      const response = `**test.js**

\`\`\`js
console.log("updated via whole");
\`\`\``;

      const result = applyHybridEdits(response, files, parseWholeFiles);
      expect(result["file1"].text).toBe('console.log("updated via whole");');
    });

    it("should mix both formats: diff for one file, whole for another", () => {
      const files: VizFiles = {
        file1: { name: "alpha.js", text: 'const a = "old";' },
        file2: { name: "beta.js", text: 'const b = "old";' },
      };
      const response = [
        // Diff-style change for alpha.js
        "alpha.js",
        "```",
        "<<<<<<< SEARCH",
        'const a = "old";',
        "=======",
        'const a = "updated via diff";',
        ">>>>>>> REPLACE",
        "```",
        "",
        // Whole-file change for beta.js
        "**beta.js**",
        "",
        "```js",
        'const b = "updated via whole";',
        "```",
      ].join("\n");

      const result = applyHybridEdits(response, files, parseWholeFiles);
      expect(result["file1"].text).toBe('const a = "updated via diff";');
      expect(result["file2"].text).toBe('const b = "updated via whole";');
    });

    it("should let whole-file override diff when both target the same file", () => {
      const files: VizFiles = {
        file1: { name: "test.js", text: 'const x = "original";' },
      };
      const response = [
        // Diff attempts to change it
        "test.js",
        "```",
        "<<<<<<< SEARCH",
        'const x = "original";',
        "=======",
        'const x = "from-diff";',
        ">>>>>>> REPLACE",
        "```",
        "",
        // Whole-file overrides it
        "**test.js**",
        "",
        "```js",
        'const x = "from-whole-wins";',
        "```",
      ].join("\n");

      const result = applyHybridEdits(response, files, parseWholeFiles);
      // Whole-file content should win
      expect(result["file1"].text).toBe('const x = "from-whole-wins";');
    });

    it("should create new files via whole-file blocks", () => {
      const files: VizFiles = {
        file1: { name: "existing.js", text: "keep me" },
      };
      const response = `**new-file.js**

\`\`\`js
console.log("new file");
\`\`\``;

      const result = applyHybridEdits(response, files, parseWholeFiles);
      const newFile = Object.values(result).find(
        (f) => f.name === "new-file.js",
      );
      expect(newFile).toBeDefined();
      expect(newFile!.text).toBe('console.log("new file");');
      // Existing file unchanged
      expect(result["file1"].text).toBe("keep me");
    });

    it("should delete files via empty whole-file content", () => {
      const files: VizFiles = {
        file1: { name: "keep.js", text: "keep me" },
        file2: { name: "delete.js", text: "delete me" },
      };
      const response = `**delete.js**

\`\`\`
\`\`\``;

      const result = applyHybridEdits(response, files, parseWholeFiles);
      expect(Object.keys(result)).toHaveLength(1);
      expect(result["file1"]).toBeDefined();
      expect(result["file2"]).toBeUndefined();
    });
  });
});
