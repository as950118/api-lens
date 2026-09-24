export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  imports_json TEXT NOT NULL,
  exports_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS functions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  params_json TEXT NOT NULL,
  return_type TEXT,
  calls_json TEXT NOT NULL,
  line INTEGER NOT NULL,
  column INTEGER NOT NULL,
  component TEXT
);

CREATE TABLE IF NOT EXISTS api_calls (
  id TEXT PRIMARY KEY,
  endpoint_pattern TEXT,
  method TEXT,
  callee_expression TEXT NOT NULL,
  resolution TEXT NOT NULL,
  caller_function_id TEXT REFERENCES functions(id) ON DELETE SET NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  column INTEGER NOT NULL,
  arguments_json TEXT NOT NULL,
  return_var_type TEXT,
  code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS property_accesses (
  id TEXT PRIMARY KEY,
  api_call_id TEXT NOT NULL REFERENCES api_calls(id) ON DELETE CASCADE,
  object TEXT NOT NULL,
  path_json TEXT NOT NULL,
  flow TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  column INTEGER NOT NULL,
  containing_function_id TEXT REFERENCES functions(id) ON DELETE SET NULL,
  containing_component TEXT,
  code TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_endpoint ON api_calls(endpoint_pattern, method);
CREATE INDEX IF NOT EXISTS idx_api_calls_file ON api_calls(file_id);
CREATE INDEX IF NOT EXISTS idx_prop_access_apicall ON property_accesses(api_call_id);
CREATE INDEX IF NOT EXISTS idx_prop_access_file ON property_accesses(file_id);
`;
