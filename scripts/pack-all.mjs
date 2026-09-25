// Packs every publishable npm workspace into ./dist-packages (the same tarballs `npm publish` uploads).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "dist-packages");
mkdirSync(out, { recursive: true });
const workspaces = ["core", "extractor-typescript", "extractor-java", "ai-anthropic", "cli", "mcp"];
for (const ws of workspaces) {
  const dir = join(root, "packages", ws);
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  const { name } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  execFileSync("npm", ["pack", "--pack-destination", out], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  console.log(`packed ${name}`);
}
