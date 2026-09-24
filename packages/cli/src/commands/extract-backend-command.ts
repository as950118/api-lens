import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BackendManifest } from "@apilens/core";
import { JavaExtractor } from "@apilens/extractor-java";

export interface ExtractBackendOptions {
  out: string;
  jar?: string;
}

export async function runExtractBackendCommand(
  backendDir: string,
  options: ExtractBackendOptions,
): Promise<BackendManifest> {
  const root = resolve(backendDir);
  if (!existsSync(root)) throw new Error(`Backend directory not found: ${root}`);
  const manifest = await new JavaExtractor({ jarPath: options.jar }).extract(root);
  const out = resolve(options.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function formatBackendSummary(manifest: BackendManifest, out: string): string {
  const lines = [
    `ApiLens backend manifest written to ${resolve(out)}`,
    `  Endpoints:  ${manifest.endpoints.length}`,
    `  DTOs:       ${manifest.dtos.length}`,
    `  Enums:      ${manifest.enums.length}`,
    `  Warnings:   ${manifest.warnings.length}`,
  ];
  for (const warning of manifest.warnings) lines.push(`    - ${warning}`);
  return lines.join("\n");
}
