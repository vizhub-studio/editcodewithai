import { describe, it, expect } from "vitest";
import { VizFiles } from "@vizhub/viz-types";
import { applyEditsSafe } from "./applyEngine";
import {
  applyDiffsSafe,
  applyUdiffsSafe,
  applyHybridEditsSafe,
  Diff,
  UdiffHunk,
} from "./fileUtils";
import type { FileCollection } from "@vizhub/viz-types";

const diffEdit = (fileName: string, search: string, replace: string): Diff => ({
  fileName,
  search,
  replace,
});

describe("applyEditsSafe", () => {
  it("applies an exact diff", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "test.js",
        search: "const x = 1;",
        replace: "const x = 2;",
      },
    ]);
    expect(result.files.file1.text).toBe("const x = 2;");
    expect(result.warnings).toEqual([]);
  });

  it("applies 4 of 5 diffs when 1 target is missing (acceptance criterion)", () => {
    const files: VizFiles = {
      a: { name: "a.js", text: "a1" },
      b: { name: "b.js", text: "b1" },
      c: { name: "c.js", text: "c1" },
      d: { name: "d.js", text: "d1" },
    };
    const result = applyEditsSafe(files, [
      { kind: "diff", fileName: "a.js", search: "a1", replace: "a2" },
      { kind: "diff", fileName: "b.js", search: "b1", replace: "b2" },
      { kind: "diff", fileName: "missing.js", search: "x", replace: "y" },
      { kind: "diff", fileName: "c.js", search: "c1", replace: "c2" },
      { kind: "diff", fileName: "d.js", search: "d1", replace: "d2" },
    ]);

    expect(result.files.a.text).toBe("a2");
    expect(result.files.b.text).toBe("b2");
    expect(result.files.c.text).toBe("c2");
    expect(result.files.d.text).toBe("d2");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "FILE_NOT_FOUND",
      fileName: "missing.js",
    });
  });

  it("skips and warns when the anchor is not found", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "test.js",
        search: "const y = 9;",
        replace: "const y = 8;",
      },
    ]);
    expect(result.files.file1.text).toBe("const x = 1;");
    expect(result.warnings[0].code).toBe("SEARCH_NOT_FOUND");
  });

  it("skips ambiguous searches instead of replacing the first", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "foo();\nbar();\nfoo();" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "test.js",
        search: "foo();",
        replace: "baz();",
      },
    ]);
    expect(result.files.file1.text).toBe("foo();\nbar();\nfoo();");
    expect(result.warnings[0].code).toBe("AMBIGUOUS_SEARCH");
  });

  it("skips and warns when multiple files share the target name", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "a" },
      file2: { name: "./test.js", text: "b" },
    };
    const result = applyEditsSafe(files, [
      { kind: "diff", fileName: "test.js", search: "a", replace: "c" },
    ]);
    expect(result.files.file1.text).toBe("a");
    expect(result.files.file2.text).toBe("b");
    expect(result.warnings[0].code).toBe("AMBIGUOUS_FILE");
  });

  it("skips empty search blocks", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "test.js",
        search: "  ",
        replace: "const y = 2;",
      },
    ]);
    expect(result.files.file1.text).toBe("const x = 1;");
    expect(result.warnings[0].code).toBe("EMPTY_SEARCH");
  });

  it("resolves normalized path differences", () => {
    const files: VizFiles = {
      file1: { name: "src/app.ts", text: "const x = 1;" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "./src//app.ts",
        search: "const x = 1;",
        replace: "const x = 2;",
      },
    ]);
    expect(result.files.file1.text).toBe("const x = 2;");
    expect(result.warnings).toEqual([]);
  });

  it("applies CRLF / trailing-whitespace normalized matches without warnings", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "let a = 1;  \r\nlet b = 2;\r\n" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "test.js",
        search: "let a = 1;\nlet b = 2;",
        replace: "let a = 9;\nlet b = 9;",
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.files.file1.text).toContain("let a = 9;");
    expect(result.files.file1.text).toContain("let b = 9;");
  });

  it("applies a udiff and reports missing hunks separately", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;\nconst y = 2;" },
    };
    const result = applyEditsSafe(files, [
      {
        kind: "udiff",
        fileName: "test.js",
        original: "const x = 1;",
        updated: "const x = 9;",
      },
      {
        kind: "udiff",
        fileName: "test.js",
        original: "const z = 3;",
        updated: "const z = 4;",
      },
    ]);
    expect(result.files.file1.text).toBe("const x = 9;\nconst y = 2;");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("HUNK_NOT_FOUND");
  });

  it("does not mutate the input files", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;" },
    };
    applyEditsSafe(files, [
      {
        kind: "diff",
        fileName: "test.js",
        search: "const x = 1;",
        replace: "const x = 2;",
      },
    ]);
    expect(files.file1.text).toBe("const x = 1;");
  });

  it("is deterministic", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "a\nb\nc" },
    };
    const edits = [
      { kind: "diff" as const, fileName: "test.js", search: "b", replace: "B" },
    ];
    const first = applyEditsSafe(files, edits);
    const second = applyEditsSafe(files, edits);
    expect(first).toEqual(second);
  });
});

describe("safe wrappers", () => {
  it("applyDiffsSafe returns files and warnings", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;" },
    };
    const result = applyDiffsSafe(files, [
      diffEdit("test.js", "const x = 1;", "const x = 2;"),
      diffEdit("missing.js", "a", "b"),
    ]);
    expect(result.files.file1.text).toBe("const x = 2;");
    expect(result.warnings).toHaveLength(1);
  });

  it("applyUdiffsSafe returns files and warnings", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: "const x = 1;" },
    };
    const hunks: UdiffHunk[] = [
      {
        fileName: "test.js",
        original: "const x = 1;",
        updated: "const x = 2;",
      },
    ];
    const result = applyUdiffsSafe(files, hunks);
    expect(result.files.file1.text).toBe("const x = 2;");
    expect(result.warnings).toEqual([]);
  });
});

describe("applyHybridEditsSafe", () => {
  const parseWholeFiles = (text: string): FileCollection => {
    const files: FileCollection = {};
    const regex = /\*\*(.+?)\*\*\n+```(?:\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      files[match[1].trim()] = match[2].trimEnd();
    }
    return files;
  };

  it("applies diffs and whole files together", () => {
    const files: VizFiles = {
      file1: { name: "alpha.js", text: 'const a = "old";' },
      file2: { name: "beta.js", text: 'const b = "old";' },
    };
    const response = [
      "alpha.js",
      "```",
      "<<<<<<< SEARCH",
      'const a = "old";',
      "=======",
      'const a = "new";',
      ">>>>>>> REPLACE",
      "```",
      "",
      "**beta.js**",
      "",
      "```js",
      'const b = "new";',
      "```",
    ].join("\n");

    const result = applyHybridEditsSafe(response, files, parseWholeFiles);
    expect(result.files.file1.text).toBe('const a = "new";');
    expect(result.files.file2.text).toBe('const b = "new";');
    expect(result.warnings).toEqual([]);
  });

  it("suppresses diff warnings for files also replaced wholesale", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: 'const x = "original";' },
    };
    const response = [
      // Stale diff anchor — would warn on its own.
      "test.js",
      "```",
      "<<<<<<< SEARCH",
      "this text does not exist",
      "=======",
      "replacement",
      ">>>>>>> REPLACE",
      "```",
      "",
      // Whole-file content supersedes it.
      "**test.js**",
      "",
      "```js",
      'const x = "from-whole";',
      "```",
    ].join("\n");

    const result = applyHybridEditsSafe(response, files, parseWholeFiles);
    expect(result.files.file1.text).toBe('const x = "from-whole";');
    expect(result.warnings).toEqual([]);
  });

  it("keeps diff warnings for files with no whole-file replacement", () => {
    const files: VizFiles = {
      file1: { name: "test.js", text: 'const x = "original";' },
    };
    const response = [
      "test.js",
      "```",
      "<<<<<<< SEARCH",
      "this text does not exist",
      "=======",
      "replacement",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n");

    const result = applyHybridEditsSafe(response, files, parseWholeFiles);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("SEARCH_NOT_FOUND");
  });
});
