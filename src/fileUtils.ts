import { VizFiles, VizFile, FileCollection } from "@vizhub/viz-types";
import { generateVizFileId } from "@vizhub/viz-utils";

/**
 * If the LLM outputs empty text for a file, we interpret this
 * as a request to delete the file.
 */
export function shouldDeleteFile(file?: VizFile) {
  if (!file) return false;
  return file.text.trim() === "";
}

/**
 * Checks if a filename is an image file based on extension
 */
export function isImageFile(fileName: string): boolean {
  const imageExtensions = /\.(png|jpg|jpeg|gif|bmp|svg|webp)$/i;
  return imageExtensions.test(fileName);
}

/**
 * Processes files for the prompt by truncating large files and excluding images
 */
export function prepareFilesForPrompt(files: VizFiles): {
  files: FileCollection;
  imageFiles: string[];
} {
  const result: FileCollection = {};
  const imageFiles: string[] = [];

  Object.values(files).forEach((file) => {
    // Check if it's an image file
    if (isImageFile(file.name)) {
      imageFiles.push(file.name);
      return; // Skip processing image files
    }

    // Example: truncate large files, etc.
    result[file.name] = file.text
      .split("\n")
      .slice(
        0,
        file.name.endsWith(".csv") || file.name.endsWith(".json") ? 50 : 500,
      )
      .map((line) => line.slice(0, 200))
      .join("\n");
  });

  return { files: result, imageFiles };
}

/**
 * Merges original files with changes from the LLM
 */
export function mergeFileChanges(
  originalFiles: VizFiles,
  parsedFiles: FileCollection,
): VizFiles {
  // Start with existing files
  let changedFiles: VizFiles = Object.keys(originalFiles).reduce(
    (acc, fileId) => {
      const original = originalFiles[fileId];
      const changedText = parsedFiles[original.name];
      const changedFile =
        changedText !== undefined
          ? { name: original.name, text: changedText }
          : undefined;

      if (shouldDeleteFile(changedFile)) {
        // Exclude from new set
        return acc;
      }

      // If changedFile is present, use it; otherwise use original
      acc[fileId] = {
        ...original,
        text: changedFile ? changedFile.text : original.text,
      };
      return acc;
    },
    {} as VizFiles,
  );

  // Handle newly-created files
  Object.entries(parsedFiles).forEach(([fileName, fileText]) => {
    const existingFile = Object.values(changedFiles).find(
      (file) => file.name === fileName,
    );
    // If no existing file and not empty => it's a new file
    if (!existingFile && fileText.trim() !== "") {
      const newFileId = generateVizFileId();
      changedFiles[newFileId] = {
        name: fileName,
        text: fileText,
      };
    }
  });

  return changedFiles;
}

export interface Diff {
  fileName: string;
  search: string;
  replace: string;
}

export function parseDiffs(responseText: string): Diff[] {
  const diffs: Diff[] = [];
  // This regex captures the file path, and the content of the SEARCH and REPLACE blocks.
  const diffRegex =
    /^(.+)\n```\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE\n```/gm;

  const matches = responseText.matchAll(diffRegex);

  for (const match of matches) {
    const [_, fileName, search, replace] = match;
    diffs.push({
      fileName: fileName.trim(),
      search,
      replace,
    });
  }

  return diffs;
}

export function applyDiffs(originalFiles: VizFiles, diffs: Diff[]): VizFiles {
  // Create a mutable copy of the files to avoid side effects.
  const changedFiles: VizFiles = JSON.parse(JSON.stringify(originalFiles));

  for (const diff of diffs) {
    const fileId = Object.keys(changedFiles).find(
      (id) => changedFiles[id].name === diff.fileName,
    );

    if (!fileId) {
      throw new Error(`File not found: ${diff.fileName}`);
    }

    const file = changedFiles[fileId];
    if (!file.text.includes(diff.search)) {
      throw new Error(`Search block not found in file: ${diff.fileName}`);
    }

    // Replace only the first occurrence, which is the standard behavior of string.replace.
    file.text = file.text.replace(diff.search, diff.replace);
  }

  return changedFiles;
}

export function parseDiffFenced(responseText: string): Diff[] {
  const diffs: Diff[] = [];
  const diffRegex =
    /^```\n(.+)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE\n```/gm;

  const matches = responseText.matchAll(diffRegex);

  for (const match of matches) {
    const [_, fileName, search, replace] = match;
    diffs.push({
      fileName: fileName.trim(),
      search,
      replace,
    });
  }

  return diffs;
}

export interface UdiffHunk {
  fileName: string;
  original: string;
  updated: string;
}

export function parseUdiffs(responseText: string): UdiffHunk[] {
  const hunks: UdiffHunk[] = [];
  const udiffFileRegex = /```diff\n--- (.+?)\n\+\+\+ \1\n([\s\S]+?)```/g;

  let fileMatch;
  while ((fileMatch = udiffFileRegex.exec(responseText)) !== null) {
    const fileName = fileMatch[1].trim();
    const allHunksContent = fileMatch[2];

    const hunkParts = allHunksContent.split(/^@@ .* @@$/m).slice(1);

    for (const part of hunkParts) {
      if (part.trim() === "") continue;
      const lines = part.trim().split("\n");

      const original = [];
      const updated = [];
      for (const line of lines) {
        if (line.startsWith("+")) {
          updated.push(line.substring(1));
        } else if (line.startsWith("-")) {
          original.push(line.substring(1));
        } else {
          const content = line.startsWith(" ") ? line.substring(1) : line;
          original.push(content);
          updated.push(content);
        }
      }
      hunks.push({
        fileName: fileName,
        original: original.join("\n"),
        updated: updated.join("\n"),
      });
    }
  }
  return hunks;
}

/**
 * Hybrid edit mode: parses both whole-file blocks (bold-markdown)
 * and search/replace diff blocks from the same response.
 *
 * Strategy:
 * 1. Apply all search/replace diffs first.
 * 2. Then apply whole-file replacements on top.
 *    (If the same file appears in both forms, the whole-file content wins.)
 */
export function applyHybridEdits(
  responseText: string,
  originalFiles: VizFiles,
  parseWholeFiles: (text: string) => FileCollection,
): VizFiles {
  // Step 1: apply search/replace diffs
  const diffs = parseDiffs(responseText);
  let changedFiles = applyDiffs(originalFiles, diffs);

  // Step 2: parse and apply whole-file replacements on top
  const parsed = parseWholeFiles(responseText);
  changedFiles = mergeFileChanges(changedFiles, parsed);

  return changedFiles;
}

export function applyUdiffs(
  originalFiles: VizFiles,
  hunks: UdiffHunk[],
): VizFiles {
  const changedFiles: VizFiles = JSON.parse(JSON.stringify(originalFiles));

  for (const hunk of hunks) {
    const fileId = Object.keys(changedFiles).find(
      (id) => changedFiles[id].name === hunk.fileName,
    );

    if (!fileId) {
      throw new Error(`File not found: ${hunk.fileName}`);
    }

    const file = changedFiles[fileId];
    if (!file.text.includes(hunk.original)) {
      throw new Error(
        `Original content for hunk not found in file: ${hunk.fileName}`,
      );
    }

    file.text = file.text.replace(hunk.original, hunk.updated);
  }

  return changedFiles;
}
