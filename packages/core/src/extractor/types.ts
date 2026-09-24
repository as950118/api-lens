import type { BackendManifest, FrontendManifest } from "../ir/types.js";

export type Manifest = FrontendManifest | BackendManifest;

/**
 * Contract every language extractor must satisfy, whether it runs in-process
 * (written in JS/TS, e.g. the TypeScript extractor) or out-of-process (any
 * other language, invoked as a subprocess that prints a Manifest as JSON to
 * stdout, e.g. the Java extractor). The core engine only ever talks to this
 * interface - adding a language means adding an implementation of it, not
 * modifying core.
 */
export interface LanguageExtractor<M extends Manifest = Manifest> {
  readonly language: M["language"];
  extract(rootDir: string, options?: Record<string, unknown>): Promise<M>;
}
