import { Context } from 'cordis'
import type CLI from '@cordisjs/plugin-cli'
import type { Command } from '@cordisjs/plugin-cli'
import kleur from 'kleur'

export const name = 'cli-help'
export const inject = ['cli']

export interface Config {}

export function apply(ctx: Context, config: Config = {}) {
  const cli = ctx.cli

  cli.command('help [command:string]', 'Print help for a command')
    .action(({ args }) => {
      const target = args[0] as string | undefined
      if (!target) return showCommandList(cli)
      const parts = args as string[]
      const resolved = resolveCommandName(cli, parts[0], parts.slice(1))
      if (!resolved) return cli.formatError(`command "${target}" not found`)
      return showCommandHelp(resolved.command, resolved.name)
    })

  // Intercept -h/--help via waterfall
  ctx.on('cli/execute', (input) => {
    const tokens: { content: string; quotes?: [string, string] }[] = []
    while (!input.isEmpty()) {
      tokens.push(input.next())
    }

    if (tokens.length === 0) return showCommandList(cli)

    const hasHelp = tokens.some((t, i) =>
      i > 0 && !t.quotes && (t.content === '-h' || t.content === '--help'),
    )

    if (hasHelp) {
      const nonHelp = tokens.filter(t => t.content !== '-h' && t.content !== '--help')
      if (nonHelp.length) {
        const resolved = resolveCommandName(cli, nonHelp[0].content,
          nonHelp.slice(1).map(t => t.content))
        if (resolved) return showCommandHelp(resolved.command, resolved.name)
      }
      return showCommandList(cli)
    }

    // Not help — push tokens back
    for (let i = tokens.length - 1; i >= 0; i--) {
      input.unshift(tokens[i])
    }
  })
}

function resolveCommandName(cli: CLI, first: string, rest: string[]): { command: Command; name: string } | null {
  let command = cli._aliases[first]
  if (!command) return null
  let name = first
  for (const part of rest) {
    const sub = cli._aliases[`${name}.${part}`]
    if (!sub) break
    command = sub
    name = `${name}.${part}`
  }
  return { command, name }
}

function showCommandList(cli: CLI): string {
  const commands = Array.from(cli._commands)
    .filter((cmd) => Object.keys(cmd._aliases).length > 0)
    .sort((a, b) => {
      const nameA = Object.keys(a._aliases)[0] || ''
      const nameB = Object.keys(b._aliases)[0] || ''
      return nameA.localeCompare(nameB)
    })

  const topLevel = commands.filter(cmd => {
    const name = Object.keys(cmd._aliases)[0] || ''
    return !name.includes('.')
  })

  const lines: string[] = [kleur.bold('Usage:') + ' <COMMAND> [OPTIONS]', '']

  if (topLevel.length === 0) {
    lines.push('No commands available.')
    return lines.join('\n')
  }

  lines.push(kleur.bold('Commands:'))
  const maxLen = Math.max(...topLevel.map(cmd => (Object.keys(cmd._aliases)[0] || '').length))
  for (const cmd of topLevel) {
    const name = Object.keys(cmd._aliases)[0] || ''
    const pad = ' '.repeat(Math.max(2, maxLen - name.length + 4))
    lines.push('  ' + kleur.bold().green(name) + pad)
  }

  lines.push('', 'See ' + kleur.bold().green("'<command> --help'") + ' for more information on a specific command.')
  return lines.join('\n')
}

function showCommandHelp(command: Command, name: string): string {
  const displayName = name.replace(/\./g, ' ')
  const argParts = command._arguments.map(formatArg)
  const optionList = Array.from(command._optionList)
  const hasOptions = optionList.length > 0

  const usageParts = [displayName]
  if (hasOptions) usageParts.push('[OPTIONS]')
  usageParts.push(...argParts)

  const lines: string[] = [kleur.bold('Usage:') + ' ' + usageParts.join(' ')]

  if (command._arguments.length > 0) {
    lines.push('', kleur.bold('Arguments:'))
    for (const arg of command._arguments) {
      lines.push('  ' + kleur.green(formatArg(arg)))
    }
  }

  if (hasOptions) {
    lines.push('', kleur.bold('Options:'))
    for (const option of optionList) {
      lines.push('  ' + option.source)
    }
  }

  const aliases = Object.keys(command._aliases).slice(1)
  if (aliases.length > 0) {
    lines.push('', kleur.bold('Aliases:') + ' ' + aliases.join(', '))
  }

  return lines.join('\n')
}

function formatArg(arg: { name: string; required: boolean; variadic: boolean }): string {
  const prefix = arg.variadic ? '...' : ''
  return arg.required ? `<${prefix}${arg.name}>` : `[${prefix}${arg.name}]`
}
