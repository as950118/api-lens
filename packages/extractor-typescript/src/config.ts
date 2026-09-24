import { existsSync, readFileSync } from "node:fs";
import type { HttpMethod } from "@apilens/core";

export interface ApiClientMapping {
  method: HttpMethod;
  path: string;
}

export interface ApilensConfig {
  /** Explicit mapping from API client calls (e.g. "userApi.getUser") to backend endpoints. */
  apiClientMap?: Record<string, ApiClientMapping>;
}

export function loadConfig(configPath: string | undefined): ApilensConfig {
  if (!configPath) return {};
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as ApilensConfig;
}
