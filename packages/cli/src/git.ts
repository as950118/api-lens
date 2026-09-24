import { execFileSync } from "node:child_process";

const SOURCE = /\.(ts|tsx|mts|cts)$/;

/**
 * TypeScript files under `dir` changed since `ref` (committed, staged, unstaged
 * and untracked), relative to `dir`. Deleted files are included so their
 * index entries can be dropped.
 */
export function changedSourceFiles(dir: string, ref: string): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  let tracked: string[];
  try {
    tracked = git("diff", "--name-only", "--relative", ref);
  } catch (err) {
    throw new Error(`git diff against "${ref}" failed in ${dir}: ${(err as Error).message}`);
  }
  const untracked = git("ls-files", "--others", "--exclude-standard");
  return [...new Set([...tracked, ...untracked])].filter((f) => SOURCE.test(f) && !f.endsWith(".d.ts")).sort();
}
