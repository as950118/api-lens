import { Command } from "commander";
import { formatIndexSummary, runIndexCommand } from "./commands/index-command.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("apilens")
    .description("Detect frontend code affected by backend API changes")
    .version("0.1.0");

  program
    .command("index")
    .description("Analyze a TypeScript frontend and build the ApiLens index")
    .argument("<frontendDir>", "frontend project root")
    .option("-c, --config <path>", "apilens.config.json (defaults to <frontendDir>/apilens.config.json)")
    .option("-o, --out <path>", "index database path", ".apilens/index.db")
    .option("-m, --manifest <path>", "also write the extracted manifest as JSON")
    .action(async (frontendDir: string, opts: { config?: string; out: string; manifest?: string }) => {
      const result = await runIndexCommand(frontendDir, opts);
      console.log(formatIndexSummary(result));
    });

  for (const [name, phase, description] of [
    ["analyze", 5, "Analyze backend API changes against the frontend index"],
    ["diff", 7, "Detect changed APIs between two git revisions"],
    ["verify", 6, "Run static analysis + AI verification"],
  ] as const) {
    program
      .command(name)
      .description(`${description} (not implemented yet - Phase ${phase})`)
      .allowUnknownOption()
      .action(() => {
        console.error(`apilens ${name} is not implemented yet (planned for Phase ${phase}).`);
        process.exitCode = 2;
      });
  }

  return program;
}
