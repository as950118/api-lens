import { DatabaseSync } from "node:sqlite";
import type {
  ApiCallInfo,
  FileInfo,
  FrontendManifest,
  PropertyAccessInfo,
} from "../ir/types.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export interface IndexSummary {
  files: number;
  functions: number;
  apiCalls: number;
  resolvedApiCalls: number;
  propertyAccesses: number;
}

type Row = Record<string, unknown>;

/**
 * SQLite-backed storage for the IR. The only module that knows about SQL;
 * CLI commands and the (future) diff/impact engines go through it.
 */
export class IndexStore {
  private constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.setMeta("schemaVersion", String(SCHEMA_VERSION));
  }

  static open(dbPath: string): IndexStore {
    return new IndexStore(new DatabaseSync(dbPath));
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM index_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO index_meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  /** Replaces the whole index with the given manifest atomically. */
  writeManifest(manifest: FrontendManifest): IndexSummary {
    this.db.exec("BEGIN");
    try {
      this.db.exec(`
        DELETE FROM property_accesses;
        DELETE FROM api_calls;
        DELETE FROM functions;
        DELETE FROM files;
      `);

      const fileIds = new Map<string, number>();
      const insertFile = this.db.prepare(
        "INSERT INTO files (path, imports_json, exports_json) VALUES (?, ?, ?)",
      );
      for (const file of manifest.files) {
        const { lastInsertRowid } = insertFile.run(
          file.path,
          JSON.stringify(file.imports),
          JSON.stringify(file.exports),
        );
        fileIds.set(file.path, Number(lastInsertRowid));
      }
      const fileId = (path: string, owner: string): number => {
        const id = fileIds.get(path);
        if (id === undefined) throw new Error(`${owner} references unknown file ${path}`);
        return id;
      };

      const insertFunction = this.db.prepare(
        `INSERT INTO functions
          (id, name, file_id, params_json, return_type, calls_json, line, column, component)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const fn of manifest.functions) {
        insertFunction.run(
          fn.id,
          fn.name,
          fileId(fn.file, fn.id),
          JSON.stringify(fn.params),
          fn.returnType,
          JSON.stringify(fn.calls),
          fn.location.line,
          fn.location.column,
          fn.containingComponent,
        );
      }

      const insertApiCall = this.db.prepare(
        `INSERT INTO api_calls
          (id, endpoint_pattern, method, callee_expression, resolution, caller_function_id,
           file_id, line, column, arguments_json, return_var_type, code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const call of manifest.apiCalls) {
        insertApiCall.run(
          call.id,
          call.endpointPattern,
          call.method,
          call.calleeExpression,
          call.resolution,
          call.callerFunctionId,
          fileId(call.file, call.id),
          call.location.line,
          call.location.column,
          JSON.stringify(call.arguments),
          call.returnVarType,
          call.code,
        );
      }

      const insertAccess = this.db.prepare(
        `INSERT INTO property_accesses
          (id, api_call_id, object, path_json, flow, file_id, line, column,
           containing_function_id, containing_component, code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const access of manifest.propertyAccesses) {
        insertAccess.run(
          access.id,
          access.apiCallId,
          access.object,
          JSON.stringify(access.path),
          access.flow,
          fileId(access.file, access.id),
          access.location.line,
          access.location.column,
          access.containingFunctionId,
          access.containingComponent,
          access.code,
        );
      }

      this.setMeta("language", manifest.language);
      this.setMeta("rootDir", manifest.rootDir);
      this.setMeta("generatedAt", manifest.generatedAt);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return this.summary();
  }

  summary(): IndexSummary {
    const count = (sql: string): number => (this.db.prepare(sql).get() as { c: number }).c;
    return {
      files: count("SELECT COUNT(*) AS c FROM files"),
      functions: count("SELECT COUNT(*) AS c FROM functions"),
      apiCalls: count("SELECT COUNT(*) AS c FROM api_calls"),
      resolvedApiCalls: count(
        "SELECT COUNT(*) AS c FROM api_calls WHERE endpoint_pattern IS NOT NULL",
      ),
      propertyAccesses: count("SELECT COUNT(*) AS c FROM property_accesses"),
    };
  }

  listFiles(): FileInfo[] {
    const rows = this.db.prepare("SELECT * FROM files ORDER BY path").all() as Row[];
    return rows.map((r) => ({
      path: r.path as string,
      imports: JSON.parse(r.imports_json as string),
      exports: JSON.parse(r.exports_json as string),
    }));
  }

  listApiCalls(): ApiCallInfo[] {
    const rows = this.db
      .prepare(
        `SELECT ac.*, f.path AS file_path FROM api_calls ac
         JOIN files f ON f.id = ac.file_id ORDER BY f.path, ac.line, ac.column`,
      )
      .all() as Row[];
    return rows.map(toApiCall);
  }

  /** Entry point for impact analysis: api calls hitting a normalized endpoint. */
  findApiCallsByEndpoint(method: string, endpointPattern: string): ApiCallInfo[] {
    const rows = this.db
      .prepare(
        `SELECT ac.*, f.path AS file_path FROM api_calls ac
         JOIN files f ON f.id = ac.file_id
         WHERE ac.method = ? AND ac.endpoint_pattern = ?
         ORDER BY f.path, ac.line, ac.column`,
      )
      .all(method, endpointPattern) as Row[];
    return rows.map(toApiCall);
  }

  findPropertyAccessesForApiCall(apiCallId: string): PropertyAccessInfo[] {
    const rows = this.db
      .prepare(
        `SELECT pa.*, f.path AS file_path FROM property_accesses pa
         JOIN files f ON f.id = pa.file_id
         WHERE pa.api_call_id = ?
         ORDER BY f.path, pa.line, pa.column`,
      )
      .all(apiCallId) as Row[];
    return rows.map(toPropertyAccess);
  }
}

function toApiCall(r: Row): ApiCallInfo {
  const file = r.file_path as string;
  return {
    id: r.id as string,
    endpointPattern: (r.endpoint_pattern as string | null) ?? null,
    method: (r.method as ApiCallInfo["method"]) ?? null,
    calleeExpression: r.callee_expression as string,
    resolution: r.resolution as ApiCallInfo["resolution"],
    callerFunctionId: (r.caller_function_id as string | null) ?? null,
    file,
    location: { file, line: r.line as number, column: r.column as number },
    arguments: JSON.parse(r.arguments_json as string),
    returnVarType: (r.return_var_type as string | null) ?? null,
    code: r.code as string,
  };
}

function toPropertyAccess(r: Row): PropertyAccessInfo {
  const file = r.file_path as string;
  return {
    id: r.id as string,
    apiCallId: r.api_call_id as string,
    object: r.object as string,
    path: JSON.parse(r.path_json as string),
    flow: r.flow as PropertyAccessInfo["flow"],
    file,
    location: { file, line: r.line as number, column: r.column as number },
    containingFunctionId: (r.containing_function_id as string | null) ?? null,
    containingComponent: (r.containing_component as string | null) ?? null,
    code: r.code as string,
  };
}
