import { describe, expect, it, vi } from "vitest";
import type { VizFiles } from "@vizhub/viz-types";
import { performAiEdit, applyDiffsSafe, applyUdiffsSafe, applyHybridEditsSafe } from "./index";
import type { EditFormat } from "./types";

const files = (): VizFiles => ({
  a: { name: "src/a.js", text: "first\nsecond\nrepeat\nrepeat" },
  b: { name: "b.js", text: "other" },
});
const diff = (fileName: string, search: string, replace: string) => ({
  fileName, search, replace,
});
const block = (name: string, search: string, replacement: string, fenced = false) =>
  [ ...(fenced ? ["```", name] : [name, "```"]), "<<<<<<< SEARCH",
    search, "=======", replacement, ">>>>>>> REPLACE", "```" ].join("\n");
const unified = (name: string, search: string, replacement: string) =>
  ["```diff", "--- " + name, "+++ " + name, "@@ -1 +1 @@", "-" + search, "+" + replacement, "```"].join("\n");

describe("opt-in per-file atomicity", () => {
  it("rolls back interleaved aliases before and after a failure without mutating input", () => {
    const original = files();
    const patches = [
      diff("src/a.js", "first", "FIRST"),
      diff("b.js", "other", "OTHER"),
      diff("A.js", "missing", "MISSING"),
      diff("./src//a.js", "second", "SECOND"),
    ];
    const result = applyDiffsSafe(original, patches, { atomicPerFile: true });
    expect(result.files.a).toEqual(original.a);
    expect(result.files.b.text).toBe("OTHER");
    expect(result.warnings.map(w => w.code)).toEqual(["SEARCH_NOT_FOUND"]);
    expect(original).toEqual(files());
    for (const options of [undefined, { atomicPerFile: false }]) {
      const legacy = applyDiffsSafe(original, patches, options);
      expect(legacy.files.a.text).toBe("FIRST\nSECOND\nrepeat\nrepeat");
    }
  });

  it("commits sequential successful changes to the same file", () => {
    const result = applyDiffsSafe(files(), [
      diff("a.js", "first", "FIRST"), diff("src/a.js", "FIRST", "FINAL"),
    ], { atomicPerFile: true });
    expect(result.files.a.text).toBe("FINAL\nsecond\nrepeat\nrepeat");
    expect(result.warnings).toEqual([]);
  });

  it.each([["repeat", "AMBIGUOUS_SEARCH"], [" ", "EMPTY_SEARCH"]])(
    "rolls back on %s with %s", (search, code) => {
      const original = files();
      const result = applyDiffsSafe(original, [
        diff("a.js", "first", "FIRST"), diff("a.js", search, "new"),
      ], { atomicPerFile: true });
      expect(result.files).toEqual(original);
      expect(result.warnings[0].code).toBe(code);
    },
  );

  it("does not guess unresolved targets or roll back an unrelated successful file", () => {
    const original = { ...files(), c: { name: "other/a.js", text: "third" } };
    const result = applyDiffsSafe(original, [
      diff("src/a.js", "first", "FIRST"), diff("a.js", "third", "THIRD"),
      diff("missing.js", "first", "new"), diff("b.js", "other", "OTHER"),
    ], { atomicPerFile: true });
    expect(result.files.a.text).toContain("FIRST");
    expect(result.files.b.text).toBe("OTHER");
    expect(result.files.c).toEqual(original.c);
    expect(result.warnings.map(w => w.code)).toEqual(["AMBIGUOUS_FILE", "FILE_NOT_FOUND"]);
  });

  it("rolls back unified diff hunks using the same policy", () => {
    const original = files();
    const result = applyUdiffsSafe(original, [
      { fileName: "src/a.js", original: "first", updated: "FIRST" },
      { fileName: "a.js", original: "missing", updated: "new" },
      { fileName: "b.js", original: "other", updated: "OTHER" },
    ], { atomicPerFile: true });
    expect(result.files.a).toEqual(original.a);
    expect(result.files.b.text).toBe("OTHER");
    expect(result.warnings[0].code).toBe("HUNK_NOT_FOUND");
  });

  it("preserves hybrid whole-file precedence and warning suppression", () => {
    const result = applyHybridEditsSafe(
      [block("src/a.js", "first", "FIRST"), block("src/a.js", "missing", "new")].join("\n\n"),
      files(), () => ({ "src/a.js": "whole" }), { atomicPerFile: true },
    );
    expect(result.files.a.text).toBe("whole");
    expect(result.warnings).toEqual([]);
  });

  it.each<EditFormat>(["diff", "diff-fenced", "udiff", "hybrid"])(
    "wires the policy through performAiEdit for %s", async editFormat => {
      const patch = editFormat === "udiff" ? unified :
        (name: string, search: string, replacement: string) =>
          block(name, search, replacement, editFormat === "diff-fenced");
      const content = [
        patch("src/a.js", "first", "FIRST"),
        patch("a.js", "missing", "new"),
        patch("b.js", "other", "OTHER"),
      ].join("\n\n");
      const original = files();
      const llmFunction = vi.fn(async () => ({ content }));
      const result = await performAiEdit({
        files: original, prompt: "edit", llmFunction, editFormat, atomicPerFile: true,
      });
      expect(result.changedFiles.a).toEqual(original.a);
      expect(result.changedFiles.b.text).toBe("OTHER");
      expect(result.warnings).toHaveLength(1);
      expect(llmFunction).toHaveBeenCalledTimes(1);
    },
  );
});
