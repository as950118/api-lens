import { Project, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";
import { normalizePath, resolveEndpointExpression } from "../src/endpoint.js";

function resolveArg(code: string): string | null {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    "a.ts",
    `declare const id: number; declare const url: string; f(${code});`,
  );
  const call = sf.getDescendantsOfKind(SyntaxKind.CallExpression)[0];
  return resolveEndpointExpression(call.getArguments()[0]);
}

describe("normalizePath", () => {
  it.each([
    ["/users/{id}", "/users/{param}"],
    ["/users/:id/posts", "/users/{param}/posts"],
    ["/users/", "/users"],
    ["/users?page=1", "/users"],
    ["//users//{id}", "/users/{param}"],
    ["/", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("resolveEndpointExpression", () => {
  it.each([
    [`"/users"`, "/users"],
    ["`/users/${id}`", "/users/{param}"],
    [`"/users/" + id`, "/users/{param}"],
    [`"/users/" + id + "/posts"`, "/users/{param}/posts"],
    [`"https://api.example.com/users/" + id`, "/users/{param}"],
    ["url", null],
    [`"not-a-path"`, null],
  ])("%s -> %s", (code, expected) => {
    expect(resolveArg(code)).toBe(expected);
  });
});
