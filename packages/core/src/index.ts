import { Context, DisposableList, Service } from 'cordis'
import { Dict, hyphenate, Time } from 'cosmokit'
import type {} from '@cordisjs/plugin-loader'
import { Command, CommandConfig, ParseArgument } from './command'
import { Input } from './parser'
import kleur from 'kleur'

export * from './command'
export * from './parser'

declare module 'cordis' {
  interface Context {
    cli: CLI
  }

  interface Events {
    'cli/execute'(input: Input): any
  }
}

// https://github.com/microsoft/TypeScript/issues/17002
// it never got fixed so we have to do this
const isArray = Array.isArray as (arg: any) => arg is readonly any[]

const BRACKET_REGEXP = /<([^<>]+)>|\[([^\[\]]+)\]/g

export interface Type<T = any> {
  name?: string
  parse: Type.Parse<T>
  greedy?: boolean
  numeric?: boolean
}

export namespace Type {
  export type Parse<T = any> = (source: string) => T
}

export interface Types {
  string: string
  text: string
  boolean: boolean
  number: number
  integer: number
  posint: number
  natural: number
  date: Date
  time: Date
  datetime: Date
}

export type TypeInit =
  | RegExp
  | readonly string[]
  | Type.Parse
  | Type
  | undefined

export type ResolveTypeInit<T extends TypeInit> =
  | T extends RegExp ? string
  : T extends readonly (infer T)[] ? T
  : T extends Type.Parse<infer T> ? T
  : T extends Type<infer T> ? T
  : T extends undefined ? string // default type
  : never

export type ParamKind = 'argument' | 'option'

export interface Param extends Type {
  kind: ParamKind
  name: string
  variadic: boolean
  required: boolean
}

export namespace CLI {
  export interface Config {}
}

export class CLI extends Service {
  _builtin: Dict<Type | undefined> = {}
  _commands = new DisposableList<Command>()
  _aliases: Dict<Command | undefined> = Object.create(null)

  constructor(ctx: Context, public config: CLI.Config = {}) {
    super(ctx, 'cli')

    this.define('string', source => source)
    this.define('text', source => source, { greedy: true })
    this.define('boolean', () => true)

    this.define('number', (source) => {
      const value = +source
      if (Number.isFinite(value)) return value
      throw new Error('internal.invalid-number')
    }, { numeric: true })

    this.define('integer', (source) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value) return value
      throw new Error('internal.invalid-integer')
    }, { numeric: true })

    this.define('posint', (source) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value && value > 0) return value
      throw new Error('internal.invalid-posint')
    }, { numeric: true })

    this.define('natural', (source) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value && value >= 0) return value
      throw new Error('internal.invalid-natural')
    }, { numeric: true })

    this.define('date', (source) => {
      const timestamp = Time.parseDate(source)
      if (+timestamp) return timestamp
      throw new Error('internal.invalid-date')
    })

    ctx.inject({
      loader: {
        required: true,
        config: { await: true },
      },
    }, async () => {
      const input = new Input.Argv()
      const output = await this.execute(input)
      // eslint-disable-next-line no-console
      if (output) console.log(output)
    })
  }

  define<K extends keyof Types>(name: K, parse: Type.Parse<Types[K]>, options?: Omit<Type<Types[K]>, 'parse'>) {
    return this.ctx.effect(() => {
      this._builtin[name] = { name, ...options, parse }
      return () => delete this._builtin[name]
    })
  }

  parseType(type: any): Type {
    if (typeof type === 'string') {
      type = this._builtin[type]
      if (!type) throw new Error(`unknown type "${type}"`)
      return type
    } else if (typeof type === 'function') {
      return { parse: type }
    } else if (type instanceof RegExp) {
      const parse = (source: string) => {
        if (type.test(source)) return source
        throw new Error()
      }
      return { parse }
    } else if (isArray(type)) {
      const parse = (source: string) => {
        if (type.includes(source)) return source
        throw new Error()
      }
      return { parse }
    }
    return type ?? { parse: source => source }
  }

  parseParams(source: string, kind: ParamKind): Param[] {
    let cap: RegExpExecArray | null
    const args: Param[] = []
    while ((cap = BRACKET_REGEXP.exec(source))) {
      let rawName = cap[1] || cap[2]
      let variadic = false
      if (rawName.startsWith('...')) {
        rawName = rawName.slice(3)
        variadic = true
      }
      const [name, rawType] = rawName.split(':')
      args.push({
        ...this.parseType(rawType),
        name,
        kind,
        variadic,
        required: cap[0][0] === '<',
      })
    }
    return args
  }

  command<S extends string>(source: S, config?: CommandConfig): Command<ParseArgument<S>>
  command<S extends string>(source: S, desc: string, config?: CommandConfig): Command<ParseArgument<S>>
  command(source: string, ...args: [CommandConfig?] | [string, CommandConfig?]) {
    const desc = typeof args[0] === 'string' ? args.shift() as string : ''
    const config = (args[0] || {}) as CommandConfig
    const [path] = source.split(/(?=[\s<\[])/, 1)
    source = source.slice(path.length).trimStart()
    const command = new Command(this.ctx, hyphenate(path), source, desc, config)
    command._arguments = this.parseParams(source, 'argument')
    return command
  }

  execute(input: Input, args: any[] = [], options: Dict = {}) {
    // bail: plugins (like help) can intercept by returning a result
    const intercepted = this.ctx.bail('cli/execute', input)
    if (intercepted !== undefined) return intercepted

    if (input.isEmpty()) return this.error('no command provided')
    const token = input.next()
    const command = this._aliases[token.content]
    if (!command) {
      return this.error(`command "${token.content}" not found`)
    }

    // Multi-level command resolution (git-style subcommands)
    let resolved = command
    let name = token.content
    while (!input.isEmpty()) {
      const next = input.next()
      const subName = `${name}.${next.content}`
      const sub = this._aliases[subName]
      if (sub) {
        resolved = sub
        name = subName
      } else {
        input.unshift(next)
        break
      }
    }

    // Check if the first remaining token looks like a subcommand attempt
    // (not starting with -, not quoted) on a command that has subcommands
    if (!input.isEmpty()) {
      const peeked = input.next()
      const isParam = peeked.quotes || peeked.content.charCodeAt(0) === 45 // starts with -
      if (!isParam) {
        // Check if resolved command has subcommands
        const prefix = name + '.'
        let hasSubcommands = false
        for (const cmd of this._commands) {
          const cmdName = Object.keys(cmd._aliases)[0]
          if (cmdName?.startsWith(prefix) && !cmdName.slice(prefix.length).includes('.')) {
            hasSubcommands = true
            break
          }
        }
        if (hasSubcommands && !resolved._arguments.length) {
          return this.error(`no such command: \`${peeked.content}\``, name)
        }
      }
      input.unshift(peeked)
    }

    try {
      const argv = resolved.parse(input, args, options)
      return resolved.execute(argv)
    } catch (error: any) {
      return this.error(error.message, name)
    }
  }

  private error(message: string, command?: string): string {
    const lines = [kleur.bold().red('Error:') + ' ' + message]
    if (command) {
      lines.push('')
      lines.push([
        kleur.bold().green('Usage:'),
        kleur.bold().cyan(command.replace(/\./g, ' ')),
        kleur.cyan('[OPTIONS]'),
      ].join(' '))
    }
    lines.push('', 'For more information, try ' + kleur.bold().green("'--help'") + '.')
    return lines.join('\n')
  }
}

export default CLI
