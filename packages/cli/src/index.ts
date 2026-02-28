#!/usr/bin/env node

import { dev, buildAndGenerate } from "./commands/dev.js";
import { deploy } from "./commands/deploy.js";
import { init } from "./commands/init.js";
import { prepareWorkerDir } from "./commands/prepare.js";
import { run } from "./commands/run.js";
import * as path from "path";

function parseDeployArgs(argv: string[]): {
  functionsDir?: string;
  dryRun: boolean;
  wranglerArgs: string[];
} {
  const args = argv.slice(3); // skip node, script, "deploy"
  const ddIdx = args.indexOf("--");
  const before = ddIdx >= 0 ? args.slice(0, ddIdx) : args;
  const wranglerArgs = ddIdx >= 0 ? args.slice(ddIdx + 1) : [];

  const dryRun = before.includes("--dry-run");
  const positional = before.filter((a) => !a.startsWith("--"));
  const functionsDir = positional[0] || undefined;

  return { functionsDir, dryRun, wranglerArgs };
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
    const functionsDir = process.argv[3] || undefined;
    dev({ functionsDir }).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  case "deploy": {
    const { functionsDir, dryRun, wranglerArgs } = parseDeployArgs(process.argv);
    deploy({ functionsDir, dryRun, wranglerArgs }).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  case "codegen": {
    const functionsDir = path.resolve(process.argv[3] || "./zeroback");
    prepareWorkerDir();
    buildAndGenerate(functionsDir).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  case "run": {
    const runArgs = process.argv.slice(3);
    const fnName = runArgs.find((a) => !a.startsWith("--"));
    if (!fnName) {
      console.error("Usage: zeroback run <functionName> [jsonArgs] [--url <url>]");
      process.exit(1);
    }

    const urlIdx = runArgs.indexOf("--url");
    const url = urlIdx >= 0 ? runArgs[urlIdx + 1] : "http://localhost:8788";
    if (urlIdx >= 0 && !url) {
      console.error("--url requires a value");
      process.exit(1);
    }

    // JSON args: first positional arg after fnName
    const positional = runArgs.filter((a, i) => !a.startsWith("--") && !(i > 0 && runArgs[i - 1] === "--url"));
    const jsonStr = positional[1] || "{}";
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(jsonStr);
    } catch {
      console.error(`Invalid JSON args: ${jsonStr}`);
      process.exit(1);
    }

    run({ fn: fnName, args: parsedArgs, url }).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  }

  default:
    console.log(`
zeroback - Open-source backend on Cloudflare

Usage:
  zeroback init [dir]                          Scaffold a new project
  zeroback dev [functionsDir]                        Start development server
  zeroback codegen [functionsDir]                    Run codegen without starting dev server
  zeroback deploy [functionsDir] [--dry-run] [-- …]  Codegen + wrangler deploy
  zeroback run <fn> [jsonArgs] [--url <url>]   Invoke a function on the dev server
`);
    process.exit(command ? 1 : 0);
}
