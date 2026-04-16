import { Context } from 'cordis'
import { EntryOptions, Loader } from '@cordisjs/plugin-loader'
import * as daemon from './daemon.ts'

export interface Config {
  baseUrl?: string
  execArgv?: string[]
  path: string
  daemon: daemon.Config
  prelude?: EntryOptions[]
}

export async function start(config: Config) {
  const ctx = new Context()
  ctx.baseUrl = config.baseUrl
  if (config.daemon.enabled) {
    await ctx.plugin(daemon, config.daemon)
  }
  await ctx.plugin(Loader)
  for (const plugin of config.prelude ?? []) {
    await ctx.loader.create(plugin)
  }
  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: {
      path: config.path,
      enableLogs: true,
    },
  })
}
