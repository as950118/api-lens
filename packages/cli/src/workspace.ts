import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  checkContract,
  ImpactAnalyzer,
  IndexStore,
  loadConfig,
  ProjectModel,
  type ApilensConfig,
  type ApiUsage,
  type ContractReport,
  type FrontendIndexUpdate,
} from "@apilens/core";
import { JavaExtractor } from "@apilens/extractor-java";
import { TypeScriptProject } from "@apilens/extractor-typescript";
import { changedSourceFiles } from "./git.js";

export const DEFAULT_INDEX_PATH = ".apilens/index.db";

export interface IndexFrontendOptions {
  configPath?: string;
  /** Also write the extracted manifest as JSON. */
  manifestPath?: string;
  /** Files that changed (relative to cwd or the frontend root). Scopes the report; the index is always kept consistent. */
  files?: string[];
  /** Git ref: use the TS files changed since it as `files`. */
  changedSince?: string;
}

export interface IndexFrontendResult extends FrontendIndexUpdate {
  indexPath: string;
  frontendDir: string;
  /** The changed files the caller asked about, relative to the frontend root; null for a full index. */
  scope: string[] | null;
  /** APIs used by the scope files (calls in them or response fields read in them). */
  apis: Pick<ApiUsage, "apiKey" | "status" | "handler">[];
}

export interface ExtractBackendOptions {
  /** Also write the manifest as JSON. */
  outPath?: string;
  jarPath?: string;
}

export interface ExtractBackendResult {
  indexPath: string;
  endpoints: number;
  dtos: number;
  enums: number;
  warnings: string[];
  changedEndpoints: string[];
}

export interface CheckOptions {
  files?: string[];
  changedSince?: string;
}

/**
 * Library entry point used by the CLI and MCP servers. Holds the loaded
 * frontend project between calls so repeated updates only re-read the files
 * that changed.
 */
export class ApiLensWorkspace {
  readonly indexPath: string;
  private project: TypeScriptProject | null = null;

  constructor(indexPath: string = DEFAULT_INDEX_PATH, private readonly configPath?: string) {
    this.indexPath = resolve(indexPath);
  }

  async indexFrontend(frontendDir: string, options: IndexFrontendOptions = {}): Promise<IndexFrontendResult> {
    const root = resolve(frontendDir);
    if (!existsSync(root)) throw new Error(`Frontend directory not found: ${root}`);
    const config = this.resolveConfig(root, options.configPath);
    const scope = this.scopeFiles(root, options.files, options.changedSince);

    if (this.project?.root === root && scope) {
      this.project.refresh(scope);
    } else {
      this.project = TypeScriptProject.load(root, config);
    }
    const manifest = this.project.extract();
    if (options.manifestPath) writeJson(options.manifestPath, manifest);

    const update = this.withStore((store) => {
      store.writeConfig(config);
      return store.writeManifest(manifest);
    });
    const apis = scope ? this.apisUsedBy(scope) : [];
    return { ...update, indexPath: this.indexPath, frontendDir: root, scope, apis };
  }

  async extractBackend(backendDir: string, options: ExtractBackendOptions = {}): Promise<ExtractBackendResult> {
    const root = resolve(backendDir);
    if (!existsSync(root)) throw new Error(`Backend directory not found: ${root}`);
    const manifest = await new JavaExtractor({ jarPath: options.jarPath }).extract(root);
    if (options.outPath) writeJson(options.outPath, manifest);
    const update = this.withStore((store) => store.writeBackendManifest(manifest));
    return {
      indexPath: this.indexPath,
      endpoints: update.endpoints,
      dtos: update.dtos,
      enums: manifest.enums.length,
      warnings: manifest.warnings,
      changedEndpoints: update.changedEndpoints,
    };
  }

  model(): ProjectModel {
    return this.withStore((store) => {
      const frontend = store.readFrontendManifest();
      if (!frontend) throw new Error(`No frontend index in ${this.indexPath}. Run \`apilens index <frontendDir>\` first.`);
      const config = this.configPath ? loadConfig(this.configPath) : store.readConfig();
      return new ProjectModel(frontend, store.readBackendManifest(), config);
    });
  }

  check(options: CheckOptions = {}): ContractReport {
    const model = this.model();
    const files = this.scopeFiles(model.frontend.rootDir, options.files, options.changedSince);
    return checkContract(model, { files: files ?? undefined });
  }

  impact(): ImpactAnalyzer {
    return new ImpactAnalyzer(this.model());
  }

  /** Converts user-supplied paths (cwd-relative, absolute or root-relative) to index paths. */
  toIndexPath(file: string, root?: string): string {
    const frontendRoot = root ?? this.model().frontend.rootDir;
    const absolute = isAbsolute(file) ? file : resolve(file);
    const insideRoot = absolute.startsWith(frontendRoot + sep);
    const rel = insideRoot && (existsSync(absolute) || !existsSync(join(frontendRoot, file)))
      ? relative(frontendRoot, absolute)
      : file.replace(/^\.\//, "");
    return rel.split(sep).join("/");
  }

  private scopeFiles(root: string, files?: string[], changedSince?: string): string[] | null {
    if (changedSince) return changedSourceFiles(root, changedSince);
    if (files?.length) return files.map((f) => this.toIndexPath(f, root));
    return null;
  }

  private apisUsedBy(files: string[]): IndexFrontendResult["apis"] {
    const analyzer = this.impact();
    const apis = new Map<string, IndexFrontendResult["apis"][number]>();
    for (const file of files) {
      for (const api of analyzer.impactOfFile(file).apis) {
        apis.set(api.apiKey, { apiKey: api.apiKey, status: api.status, handler: api.handler });
      }
    }
    return [...apis.values()].sort((a, b) => a.apiKey.localeCompare(b.apiKey));
  }

  private resolveConfig(frontendRoot: string, configPath?: string): ApilensConfig {
    const explicit = configPath ?? this.configPath;
    if (explicit) return loadConfig(explicit);
    const local = join(frontendRoot, "apilens.config.json");
    return existsSync(local) ? loadConfig(local) : {};
  }

  private withStore<T>(work: (store: IndexStore) => T): T {
    mkdirSync(dirname(this.indexPath), { recursive: true });
    const store = IndexStore.open(this.indexPath);
    try {
      return work(store);
    } finally {
      store.close();
    }
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}
