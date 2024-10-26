import { Awaitable, defineProperty, Dict, Time } from 'cosmokit'
import { Fragment } from '@satorijs/element'
import { Context } from 'cordis'
import { Command } from './command-1'
import { Argv } from './parser'

declare module 'cordis' {
  interface Context {
    iroha: CommandService
    command<D extends string>(def: D, config?: Command.Config): Command<ArgumentType<D>>
    command<D extends string>(def: D, desc: string, config?: Command.Config): Command<ArgumentType<D>>
  }

  interface Events {
    'command-added'(command: Command): void
    'command-removed'(command: Command): void
    'command-error'(argv: Argv, error: any): void
    'command/before-execute'(argv: Argv): Awaitable<void | Fragment>
  }
}

// https://github.com/microsoft/TypeScript/issues/17002
// it never got fixed so we have to do this
const isArray = Array.isArray as (arg: any) => arg is readonly any[]

const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g

interface DeclarationList extends Array<Declaration> {
  stripped: string
}

export interface Domains {
  string: string
  number: number
  boolean: boolean
  text: string
  integer: number
  posint: number
  natural: number
  date: Date
}

export type Type = keyof Domains | RegExp | readonly string[] | Transform | DomainConfig

export interface Declaration {
  name?: string
  type?: Type
  fallback?: any
  variadic?: boolean
  required?: boolean
}

export type Transform<T = any, S = never> = (source: string, session: S) => T

export interface DomainConfig<T = any, S = never> {
  transform?: Transform<T, S>
  greedy?: boolean
  numeric?: boolean
}

type ParamType<S extends string, F>
  = S extends `${any}:${infer T}` ? T extends keyof Domains ? Domains[T] : F : F

type Replace<S extends string, X extends string, Y extends string>
  = S extends `${infer L}${X}${infer R}` ? `${L}${Y}${Replace<R, X, Y>}` : S

type ExtractAll<S extends string, F>
  = S extends `${infer L}]${infer R}` ? [ParamType<L, F>, ...ExtractAll<R, F>] : []

type ExtractFirst<S extends string, F>
  = S extends `${infer L}]${any}` ? ParamType<L, F> : boolean

type ExtractSpread<S extends string> = S extends `${infer L}...${infer R}`
  ? [...ExtractAll<L, string>, ...ExtractFirst<R, string>[]]
  : [...ExtractAll<S, string>, ...string[]]

export type ArgumentType<S extends string> = ExtractSpread<Replace<S, '>', ']'>>

export type OptionType<S extends string> = ExtractFirst<Replace<S, '>', ']'>, any>

export interface OptionConfig<T extends Type = Type> {
  aliases?: string[]
  symbols?: string[]
  value?: any
  fallback?: any
  type?: T
  descPath?: string
}

export interface TypedOptionConfig<T extends Type> extends OptionConfig<T> {
  type: T
}

export interface OptionVariant extends OptionConfig {
  syntax: string
}

export interface OptionDeclaration extends Declaration, OptionVariant {
  name: string
  values: Dict<any>
  variants: Dict<OptionVariant>
}

export interface Config {
}

export class CommandService<S = never> {
  _commandList: Command[] = []
  _commands = new Map<string, Command>()
  _builtin: Dict<DomainConfig> = {}

  constructor(private ctx: Context, public config: Config = {}) {
    defineProperty(this, Context.current, ctx)

    this.defineDomain('string', source => source)
    this.defineDomain('text', source => source, { greedy: true })
    this.defineDomain('boolean', () => true)

    this.defineDomain('number', (source, session) => {
      const value = +source
      if (Number.isFinite(value)) return value
      throw new Error('internal.invalid-number')
    }, { numeric: true })

    this.defineDomain('integer', (source, session) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value) return value
      throw new Error('internal.invalid-integer')
    }, { numeric: true })

    this.defineDomain('posint', (source, session) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value && value > 0) return value
      throw new Error('internal.invalid-posint')
    }, { numeric: true })

    this.defineDomain('natural', (source, session) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value && value >= 0) return value
      throw new Error('internal.invalid-natural')
    }, { numeric: true })

    this.defineDomain('date', (source, session) => {
      const timestamp = Time.parseDate(source)
      if (+timestamp) return timestamp
      throw new Error('internal.invalid-date')
    })
  }

  available(session: Session) {
    return this._commandList
      .filter(cmd => cmd.match(session))
      .flatMap(cmd => Object.keys(cmd._aliases))
  }

  resolve(key: string) {
    return this._resolve(key).command
  }

  _resolve(key: string) {
    if (!key) return {}
    const segments = key.toLowerCase().split('.')
    let i = 1, name = segments[0], command: Command | undefined
    while ((command = this._commands.get(name)) && i < segments.length) {
      name = command.name + '.' + segments[i++]
    }
    return { command, name }
  }

  command(def: string, ...args: [Command.Config?] | [string, Command.Config?]) {
    const desc = typeof args[0] === 'string' ? args.shift() as string : ''
    const config = args[0] as Command.Config
    const path = def.split(' ', 1)[0].toLowerCase()
    const decl = def.slice(path.length)
    const segments = path.split(/(?=[./])/g)
    const caller: Context = this[Context.current]

    /** parent command in the chain */
    let parent: Command
    /** the first created command */
    let root: Command
    const created: Command[] = []
    segments.forEach((segment, index) => {
      const code = segment.charCodeAt(0)
      const name = code === 46 ? parent.name + segment : code === 47 ? segment.slice(1) : segment
      let command = this._commands.get(name)
      if (command) {
        if (parent) {
          if (command === parent) {
            throw new Error(`cannot set a command (${command.name}) as its own subcommand`)
          }
          if (command.parent) {
            if (command.parent !== parent) {
              throw new Error(`cannot create subcommand ${path}: ${command.parent.name}/${command.name} already exists`)
            }
          } else {
            command.parent = parent
          }
        }
        return parent = command
      }
      const isLast = index === segments.length - 1
      command = new Command(name, isLast ? decl : '', caller, isLast ? config : {})
      created.push(command)
      root ||= command
      if (parent) {
        command.parent = parent
      }
      parent = command
    })

    Object.assign(parent.config, config)
    created.forEach(command => caller.emit('command-added', command))
    parent[Context.current] = caller
    if (root) caller.collect(`command <${root.name}>`, () => root.dispose())
    return parent!
  }

  defineDomain<K extends keyof Domains>(name: K, transform: Transform<Domains[K]>, options?: DomainConfig<Domains[K], S>) {
    this._builtin[name] = { ...options, transform }
  }

  resolveDomain(type?: Type) {
    if (typeof type === 'function') {
      return { transform: type }
    } else if (type instanceof RegExp) {
      const transform = (source: string) => {
        if (type.test(source)) return source
        throw new Error()
      }
      return { transform }
    } else if (isArray(type)) {
      const transform = (source: string) => {
        if (type.includes(source)) return source
        throw new Error()
      }
      return { transform }
    } else if (typeof type === 'object' || typeof type === 'undefined') {
      return type ?? {}
    }
    return this._builtin[type] ?? {}
  }

  parseValue(source: string, kind: string, argv: Argv, decl: Declaration = {}) {
    // apply domain callback
    const { transform } = this.resolveDomain(decl.type)
    if (!transform) return source
    try {
      return transform(source, argv.session)
    } catch (err) {
      argv.error = `internal.invalid-${kind}`
    }
  }

  parseDecl(source: string) {
    let cap: RegExpExecArray | null
    const result = [] as unknown as DeclarationList
    // eslint-disable-next-line no-cond-assign
    while (cap = BRACKET_REGEXP.exec(source)) {
      let rawName = cap[0].slice(1, -1)
      let variadic = false
      if (rawName.startsWith('...')) {
        rawName = rawName.slice(3)
        variadic = true
      }
      const [name, rawType] = rawName.split(':')
      const type = rawType ? rawType.trim() as keyof Domains : undefined
      result.push({
        name,
        variadic,
        type,
        required: cap[0][0] === '<',
      })
    }
    result.stripped = source.replace(/:[\w-]+(?=[>\]])/g, str => {
      const domain = this._builtin[str.slice(1)]
      return domain?.greedy ? '...' : ''
    }).trimEnd()
    return result
  }
}
