#!/usr/bin/env node

import { dev, buildAndGenerate, findWorkerDir } from "./commands/dev.js";
import { deploy } from "./commands/deploy.js";
import { init } from "./commands/init.js";
import * as path from "path";

function parseDeployArgs(argv: string[]): {
  vexDir?: string;
  dryRun: boolean;
  wranglerArgs: string[];
} {
  const args = argv.slice(3); // skip node, script, "deploy"
  const ddIdx = args.indexOf("--");
  const before = ddIdx >= 0 ? args.slice(0, ddIdx) : args;
  const wranglerArgs = ddIdx >= 0 ? args.slice(ddIdx + 1) : [];

  const dryRun = before.includes("--dry-run");
  const positional = before.filter((a) => !a.startsWith("--"));
  const vexDir = positional[0] || undefined;

  return { vexDir, dryRun, wranglerArgs };
}

const command = process.argv[2];

switch (command) {
  case "init": {
    const dir = process.argv[3] || ".";
    init(dir).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  case "dev": {
    const vexDir = process.argv[3] || undefined;
    dev({ vexDir }).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  case "deploy": {
    const { vexDir, dryRun, wranglerArgs } = parseDeployArgs(process.argv);
    deploy({ vexDir, dryRun, wranglerArgs }).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  case "codegen": {
    const vexDir = path.resolve(process.argv[3] || "./vex");
    const workerDir = path.resolve(findWorkerDir());
    buildAndGenerate(vexDir, workerDir).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  default:
    console.log(`
vex - Open-source backend on Cloudflare

Usage:
  vex init [dir]                          Scaffold a new project
  vex dev [vexDir]                        Start development server
  vex codegen [vexDir]                    Run codegen without starting dev server
  vex deploy [vexDir] [--dry-run] [-- …]  Codegen + wrangler deploy
`);
    process.exit(command ? 1 : 0);
}
