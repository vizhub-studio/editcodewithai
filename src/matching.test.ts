import { describe, it, expect } from "vitest";
import { findAnchor } from "./matching";

describe("findAnchor", () => {
  it("finds an exact substring and reports a single match", () => {
    const source = "const x = 1;\nconst y = 2;\n";
    const match = findAnchor(source, "const y = 2;");
    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("exact");
    expect(match!.matchCount).toBe(1);
    expect(source.slice(match!.start, match!.end)).toBe("const y = 2;");
  });

  it("reports ambiguity for repeated exact anchors", () => {
    const source = "foo();\nbar();\nfoo();\n";
    const match = findAnchor(source, "foo();");
    expect(match).not.toBeNull();
    expect(match!.matchCount).toBe(2);
    expect(match!.start).toBe(0);
  });

  it("finds a partial-line anchor", () => {
    const source = "const value = compute(1);\n";
    const match = findAnchor(source, "compute(1)");
    expect(match).not.toBeNull();
    expect(source.slice(match!.start, match!.end)).toBe("compute(1)");
  });

  it("returns null when nothing matches", () => {
    expect(findAnchor("const x = 1;", "const y = 2;")).toBeNull();
  });

  it("returns null for an empty anchor", () => {
    expect(findAnchor("const x = 1;", "")).toBeNull();
  });

  it("returns null for empty source", () => {
    expect(findAnchor("", "const x = 1;")).toBeNull();
  });

  describe("line-normalized strategy", () => {
    it("absorbs CRLF vs LF drift", () => {
      const source = "line one\r\nline two\r\nline three";
      const match = findAnchor(source, "line one\nline two\nline three");
      expect(match).not.toBeNull();
      expect(match!.strategy).toBe("line-normalized");
      expect(match!.matchCount).toBe(1);
      expect(source.slice(match!.start, match!.end)).toBe(
        "line one\r\nline two\r\nline three",
      );
    });

    it("absorbs a missing trailing newline", () => {
      const source = "line one\nline two";
      const match = findAnchor(source, "line one\nline two\n");
      expect(match).not.toBeNull();
      expect(match!.strategy).toBe("line-normalized");
      expect(source.slice(match!.start, match!.end)).toBe("line one\nline two");
    });

    it("absorbs trailing whitespace drift", () => {
      const source = "let a = 1;  \nlet b = 2;";
      const match = findAnchor(source, "let a = 1;\nlet b = 2;");
      expect(match).not.toBeNull();
      expect(match!.strategy).toBe("line-normalized");
      expect(match!.matchCount).toBe(1);
    });

    it("reports ambiguity when the normalized anchor matches twice", () => {
      const source = "a  \nb\na  \nb\n";
      const match = findAnchor(source, "a\nb");
      expect(match).not.toBeNull();
      expect(match!.strategy).toBe("line-normalized");
      expect(match!.matchCount).toBe(2);
    });

    it("does not handle leading-indentation drift", () => {
      const source = "function f() {\n    return 1;\n}";
      const match = findAnchor(source, "function f() {\nreturn 1;\n}");
      expect(match).toBeNull();
    });
  });
});
