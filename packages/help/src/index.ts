import { Context } from 'cordis'
import type CLI from '@cordisjs/plugin-cli'
import type { Command } from '@cordisjs/plugin-cli'
import kleur from 'kleur'

declare module '@cordisjs/plugin-cli' {
  interface CommandConfig {
    hidden?: boolean
  }

  interface OptionConfig {
    hidden?: boolean
  }
}

export const name = 'cli-help'
export const inject = ['cli']

export interface Config {}

export function apply(ctx: Context, config: Config = {}) {
  const cli = ctx.cli

  cli.command('help [command:string]', 'Print help for a command')
    .option('-H, --show-hidden')
    .action(({ args, options }) => {
      const showHidden = !!(options as any).showHidden
      const target = args[0] as string | undefined
      if (!target) return showCommandList(cli, showHidden)
      const parts = args as string[]
      const resolved = resolveCommandName(cli, parts[0], parts.slice(1))
      if (!resolved) return kleur.bold().red('Error:') + ` command "${target}" not found`
      return showCommandHelp(cli, resolved.command, resolved.name, showHidden)
    })

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
        if (resolved) return showCommandHelp(cli, resolved.command, resolved.name)
      }
      return showCommandList(cli)
    }

    // Check for bare command with subcommands but no arguments/options
    // e.g. `cordis` or `yakumo` with no args → show help
    if (tokens.length === 1 && !tokens[0].quotes) {
      const resolved = resolveCommandName(cli, tokens[0].content, [])
      if (resolved) {
        const subs = getSubcommands(cli, resolved.name)
        // Only remaining tokens after command name would be the rest
        // Since we only have the command token, check if it has subcommands
        // and no required arguments
        const hasRequiredArgs = resolved.command._arguments.some(a => a.required)
        if (subs.length > 0 && !hasRequiredArgs) {
          return showCommandHelp(cli, resolved.command, resolved.name)
        }
      }
    }

    // Not help — push tokens back
    for (let i = tokens.length - 1; i >= 0; i--) {
      input.unshift(tokens[i])
    }
  })

  // Handle cli/error: append usage and help hint
  ctx.on('cli/error', (command, next) => {
    let output = next('')
    if (command) {
      const parts = command.split('.')
      const resolved = resolveCommandName(cli, parts[0], parts.slice(1))
      if (resolved) {
        const displayName = command.replace(/\./g, ' ')
        const argParts = resolved.command._arguments.map(formatArg)
        const usageParts = [kleur.bold().cyan(displayName), kleur.cyan('[OPTIONS]')]
        usageParts.push(...argParts)
        output += '\n\n' + kleur.bold().green('Usage:') + ' ' + usageParts.join(' ')
      }
    }
    output += '\n\n' + 'For more information, try ' + kleur.bold().cyan("'--help'") + '.'
    return output
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

function getSubcommands(cli: CLI, parentName: string, showHidden = false): { command: Command; name: string }[] {
  const prefix = parentName + '.'
  const subs: { command: Command; name: string }[] = []
  const seen = new Set<Command>()
  for (const cmd of cli._commands) {
    if (seen.has(cmd)) continue
    const name = Object.keys(cmd._aliases)[0]
    if (!name?.startsWith(prefix)) continue
    // Only direct children (no further dots after prefix)
    const rest = name.slice(prefix.length)
    if (rest.includes('.')) continue
    if (!showHidden && cmd.config.hidden) continue
    seen.add(cmd)
    subs.push({ command: cmd, name })
  }
  return subs.sort((a, b) => a.name.localeCompare(b.name))
}

function showCommandList(cli: CLI, showHidden = false): string {
  const commands = Array.from(cli._commands)
    .filter((cmd) => {
      const name = Object.keys(cmd._aliases)[0] || ''
      if (name.includes('.')) return false // only top-level
      if (!showHidden && cmd.config.hidden) return false
      return Object.keys(cmd._aliases).length > 0
    })
    .sort((a, b) => {
      const nameA = Object.keys(a._aliases)[0] || ''
      const nameB = Object.keys(b._aliases)[0] || ''
      return nameA.localeCompare(nameB)
    })

  const lines: string[] = [kleur.bold().green('Usage:') + ' <COMMAND> [OPTIONS]', '']

  if (commands.length === 0) {
    lines.push('No commands available.')
    return lines.join('\n')
  }

  lines.push(kleur.bold().green('Commands:'))
  const entries = commands.map(cmd => {
    const name = Object.keys(cmd._aliases)[0] || ''
    return { name, desc: cmd.description }
  })
  const maxLen = Math.max(...entries.map(e => e.name.length))

  for (const entry of entries) {
    const pad = ' '.repeat(Math.max(2, maxLen - entry.name.length + 4))
    const desc = entry.desc ? pad + entry.desc : ''
    lines.push('  ' + kleur.bold().cyan(entry.name) + desc)
  }

  lines.push('', 'See ' + kleur.bold().cyan("'<command> --help'") + ' for more information on a specific command.')
  return lines.join('\n')
}

function showCommandHelp(cli: CLI, command: Command, name: string, showHidden = false): string {
  const displayName = name.replace(/\./g, ' ')
  const argParts = command._arguments.map(formatArg)
  const optionList = Array.from(command._optionList)
    .filter(opt => showHidden || !opt.hidden)
  const hasOptions = optionList.length > 0
  const subcommands = getSubcommands(cli, name, showHidden)

  // Description
  const lines: string[] = []
  if (command.description) {
    lines.push(command.description, '')
  }

  // Usage
  const usageParts = [kleur.bold().cyan(displayName)]
  if (hasOptions) usageParts.push(kleur.cyan('[OPTIONS]'))
  if (subcommands.length) usageParts.push(kleur.cyan('[COMMAND]'))
  usageParts.push(...argParts)
  lines.push(kleur.bold().green('Usage:') + ' ' + usageParts.join(' '))

  // Arguments
  if (command._arguments.length > 0) {
    lines.push('', kleur.bold().green('Arguments:'))
    for (const arg of command._arguments) {
      lines.push('  ' + kleur.green(formatArg(arg)))
    }
  }

  // Options
  if (hasOptions) {
    lines.push('', kleur.bold().green('Options:'))
    const maxLen = Math.max(...optionList.map(o => o.source.length))
    for (const option of optionList) {
      const pad = ' '.repeat(Math.max(2, maxLen - option.source.length + 4))
      const desc = option.description ? pad + option.description : ''
      lines.push('  ' + kleur.bold().cyan(option.source) + desc)
    }
  }

  // Subcommands
  if (subcommands.length) {
    lines.push('', kleur.bold().green('Commands:'))
    const maxLen = Math.max(...subcommands.map(s => s.name.slice(name.length + 1).length))
    for (const sub of subcommands) {
      const subName = sub.name.slice(name.length + 1) // strip parent prefix
      const pad = ' '.repeat(Math.max(2, maxLen - subName.length + 4))
      const desc = sub.command.description ? pad + sub.command.description : ''
      lines.push('  ' + kleur.bold().cyan(subName) + desc)
    }
  }

  // Aliases
  const aliases = Object.keys(command._aliases).slice(1)
  if (aliases.length > 0) {
    lines.push('', kleur.bold().green('Aliases:') + ' ' + aliases.join(', '))
  }

  return lines.join('\n')
}

function formatArg(arg: { name: string; required: boolean; variadic: boolean }): string {
  const prefix = arg.variadic ? '...' : ''
  return arg.required ? `<${prefix}${arg.name}>` : `[${prefix}${arg.name}]`
}
