import { Context } from 'cordis'
import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

declare module 'cordis' {
  interface Context {
    env: NodeJS.ProcessEnv
  }
}

function loadEnvFile(filepath: string): Record<string, string> {
  try {
    return parse(readFileSync(filepath))
  } catch {
    return {}
  }
}

export default function env(ctx: Context) {
  const baseDir = ctx.baseDir ?? process.cwd()
  const mode = process.env.NODE_ENV ?? 'development'

  // Load in priority order (low to high):
  // 1. .env
  // 2. .env.local
  // 3. .env.{mode}
  // 4. .env.{mode}.local
  const files = [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ]

  const merged: Record<string, string> = {}
  for (const file of files) {
    Object.assign(merged, loadEnvFile(resolve(baseDir, file)))
  }

  // Expand variable references (e.g. ${VAR})
  expand({ parsed: merged, processEnv: process.env })

  // Apply to process.env (don't override existing values)
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  // Register process.env as ctx.env
  ctx.provide('env', process.env)
}
