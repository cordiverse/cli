import { Context } from 'cordis'
import { EntryOptions, Loader } from '@cordisjs/plugin-loader'
import * as daemon from './daemon.ts'
import * as dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Config {
  execArgv?: string[]
  url: string
  daemon: daemon.Config
  prelude?: EntryOptions[]
}

export async function start(config: Config) {
  // load .env files
  const override = {}
  const envFiles = ['.env', '.env.local']
  for (const filename of envFiles) {
    try {
      const raw = await readFile(join(process.cwd(), filename), 'utf8')
      Object.assign(override, dotenv.parse(raw))
    } catch {}
  }
  for (const key in override) {
    process.env[key] = override[key]
  }

  const ctx = new Context()
  if (config.daemon.enabled) {
    await ctx.plugin(daemon, config.daemon)
  }
  await ctx.plugin(Loader, {}) // TODO: inherit baseUrl from context
  for (const plugin of config.prelude ?? []) {
    await ctx.loader.create(plugin)
  }
  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: {
      url: config.url,
      enableLogs: true,
    },
  })
}
