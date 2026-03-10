# @zeroback/cli

CLI for Zeroback -- init, dev, deploy, codegen, reset, and run commands for developing and deploying your backend to Cloudflare.

## Installation

```bash
npm install @zeroback/cli
```

## Usage

```bash
# Scaffold a new Zeroback project
npx @zeroback/cli init

# Start the development server with hot reload
npx @zeroback/cli dev

# Deploy to Cloudflare Workers
npx @zeroback/cli deploy

# Regenerate typed API references and manifests
npx @zeroback/cli codegen

# Reset the local database
npx @zeroback/cli reset

# Run a function from the command line
npx @zeroback/cli run tasks:list
```

## Documentation

Full documentation at [zeroback.dev/cli](https://zeroback.dev/cli/).

## Part of the Zeroback monorepo

[github.com/zerodeploy-dev/zeroback](https://github.com/zerodeploy-dev/zeroback)
