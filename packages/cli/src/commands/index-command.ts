import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { IndexStore, type IndexSummary } from "@apilens/core";
import { TypeScriptExtractor } from "@apilens/extractor-typescript";

export interface IndexCommandOptions {
  config?: string;
  out: string;
  manifest?: string;
}

export interface IndexCommandResult {
  dbPath: string;
  summary: IndexSummary;
}

export async function runIndexCommand(
  frontendDir: string,
  options: IndexCommandOptions,
): Promise<IndexCommandResult> {
  const root = resolve(frontendDir);
  if (!existsSync(root)) throw new Error(`Frontend directory not found: ${root}`);

  const defaultConfig = join(root, "apilens.config.json");
  const configPath = options.config ?? (existsSync(defaultConfig) ? defaultConfig : undefined);
  const manifest = await new TypeScriptExtractor().extract(root, { configPath });

  if (options.manifest) {
    mkdirSync(dirname(resolve(options.manifest)), { recursive: true });
    writeFileSync(options.manifest, JSON.stringify(manifest, null, 2));
  }

  const dbPath = resolve(options.out);
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = IndexStore.open(dbPath);
  try {
    return { dbPath, summary: store.writeManifest(manifest) };
  } finally {
    store.close();
  }
}

export function formatIndexSummary({ dbPath, summary }: IndexCommandResult): string {
  return [
    `ApiLens index written to ${dbPath}`,
    `  Files:              ${summary.files}`,
    `  Functions:          ${summary.functions}`,
    `  API calls:          ${summary.apiCalls} (${summary.resolvedApiCalls} with resolved endpoint)`,
    `  Property accesses:  ${summary.propertyAccesses}`,
  ].join("\n");
}
