#!/usr/bin/env node

import { dev } from "./commands/dev.js";
import { init } from "./commands/init.js";

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

  default:
    console.log(`
vex - Open-source backend on Cloudflare

Usage:
  vex init [dir]       Scaffold a new project
  vex dev [vexDir]     Start development server
`);
    process.exit(command ? 1 : 0);
}
