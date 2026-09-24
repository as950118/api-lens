import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_JAR_PATH, JavaExtractor } from "../src/index.js";

const backend = fileURLToPath(new URL("../../../test/fixtures/backend", import.meta.url));

describe("JavaExtractor", () => {
  it("explains how to build the JAR when it is missing", async () => {
    const extractor = new JavaExtractor({ jarPath: "/nonexistent/extractor.jar" });
    await expect(extractor.extract(backend)).rejects.toThrow("Java extractor JAR not found");
  });

  it.skipIf(!existsSync(DEFAULT_JAR_PATH))("extracts a BackendManifest from a Spring backend", async () => {
    const manifest = await new JavaExtractor().extract(backend);
    expect(manifest.language).toBe("java");
    expect(manifest.warnings).toEqual([]);
    expect(manifest.endpoints.map((e) => e.id)).toContain("GET /users/{id}");

    const getUser = manifest.endpoints.find((e) => e.id === "GET /users/{id}")!;
    expect(getUser.response).toEqual({
      kind: "dto",
      dtoId: "com.example.user.UserResponse",
      typeArguments: [],
    });
    const userResponse = manifest.dtos.find((d) => d.id === "com.example.user.UserResponse")!;
    expect(userResponse.fields.map((f) => f.name)).toEqual([
      "updatedAt", "id", "name", "age", "profile", "status", "tags", "created_at",
    ]);
  });

  it("surfaces extractor failures", async () => {
    await expect(new JavaExtractor({ javaCommand: "false" }).extract(backend)).rejects.toThrow();
  });
});
