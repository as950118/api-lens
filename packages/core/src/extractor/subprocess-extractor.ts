import { spawn } from "node:child_process";
import type { LanguageExtractor, Manifest } from "./types.js";

export interface SubprocessExtractorConfig {
  language: Manifest["language"];
  /** Executable to run, e.g. "java". */
  command: string;
  /** Extra args placed before the root dir argument, e.g. ["-jar", "extractor.jar"]. */
  args: string[];
}

/**
 * Generic LanguageExtractor implementation for any out-of-process extractor
 * that follows the Tacet extractor protocol: invoked as
 * `<command> <args...> <rootDir>` and prints a single Manifest JSON document
 * to stdout. This is what lets extractors for languages other than
 * TypeScript/JavaScript be written in any language - e.g. the Java extractor
 * (Phase 2) is a small JavaParser-based JAR wired up through this class.
 */
export class SubprocessExtractor<M extends Manifest> implements LanguageExtractor<M> {
  readonly language: M["language"];
  private readonly config: SubprocessExtractorConfig;

  constructor(config: SubprocessExtractorConfig) {
    this.config = config;
    this.language = config.language as M["language"];
  }

  extract(rootDir: string): Promise<M> {
    const { command, args } = this.config;
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args, rootDir], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Extractor process "${command}" exited with code ${code}.\n${stderr}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as M);
        } catch (err) {
          reject(
            new Error(
              `Extractor process "${command}" did not print valid JSON manifest: ${(err as Error).message}`,
            ),
          );
        }
      });
    });
  }
}
