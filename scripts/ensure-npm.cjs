#!/usr/bin/env node

const userAgent = process.env.npm_config_user_agent || ""
const execPath = process.env.npm_execpath || ""

const isNpmUserAgent = userAgent.startsWith("npm/")
const isNpmExecPath = /(^|[\\/])npm-cli\.js$/.test(execPath)

if (isNpmUserAgent || isNpmExecPath) {
  process.exit(0)
}

console.error("")
console.error("[ProjectNexus] This repository uses npm only.")
console.error("[ProjectNexus] Please run: npm install")
console.error(`[ProjectNexus] Detected user agent: ${userAgent || "<empty>"}`)
console.error(`[ProjectNexus] Detected exec path: ${execPath || "<empty>"}`)
console.error("")
process.exit(1)
