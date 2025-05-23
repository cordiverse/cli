import { Context, DisposableList, Service } from 'cordis'
import { Dict, Time } from 'cosmokit'
import { Command } from './command'

export * from './command'

declare module 'cordis' {
  interface Context {
    iroha: Iroha
  }
}

// https://github.com/microsoft/TypeScript/issues/17002
// it never got fixed so we have to do this
const isArray = Array.isArray as (arg: any) => arg is readonly any[]

const BRACKET_REGEXP = /<([^<>]+)>|\[([^\[\]]+)\]/g

export type Transform<S = never, T = any> = (source: string, session: S) => T

export interface DomainConfig<S = never, T = any> {
  name?: string
  transform?: Transform<S, T>
  greedy?: boolean
  numeric?: boolean
}

export interface Domains {
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

export type Type<S = never> = keyof Domains | RegExp | readonly string[] | Transform<S> | DomainConfig<S>

export interface ArgDecl {
  name: string
  type: DomainConfig
  variadic: boolean
  required: boolean
}

export default class Iroha<U = never> extends Service {
  _builtin: Dict<DomainConfig<U> | undefined> = {}
  _commands = new DisposableList<Command<U>>()
  _aliases: Dict<Command<U>> = Object.create(null)

  constructor(ctx: Context) {
    super(ctx, 'iroha')

    this.domain('string', source => source)
    this.domain('text', source => source, { greedy: true })
    this.domain('boolean', () => true)

    this.domain('number', (source, session) => {
      const value = +source
      if (Number.isFinite(value)) return value
      throw new Error('internal.invalid-number')
    }, { numeric: true })

    this.domain('integer', (source, session) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value) return value
      throw new Error('internal.invalid-integer')
    }, { numeric: true })

    this.domain('posint', (source, session) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value && value > 0) return value
      throw new Error('internal.invalid-posint')
    }, { numeric: true })

    this.domain('natural', (source, session) => {
      const value = +source
      if (value * 0 === 0 && Math.floor(value) === value && value >= 0) return value
      throw new Error('internal.invalid-natural')
    }, { numeric: true })

    this.domain('date', (source, session) => {
      const timestamp = Time.parseDate(source)
      if (+timestamp) return timestamp
      throw new Error('internal.invalid-date')
    })
  }

  domain<K extends keyof Domains>(name: K, transform: Transform<U, Domains[K]>, options?: DomainConfig<U, Domains[K]>) {
    return this.ctx.effect(() => {
      this._builtin[name] = { name, ...options, transform }
      return () => delete this._builtin[name]
    })
  }

  parseType(type: any): DomainConfig<U> {
    if (typeof type === 'string') {
      const domain = this._builtin[type]
      if (!domain) throw new Error(`unknown type "${type}"`)
      return domain
    } else if (typeof type === 'function') {
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
    }
    return type ?? {}
  }

  parseDecl(source: string): ArgDecl[] {
    let cap: RegExpExecArray | null
    const args: ArgDecl[] = []
    while ((cap = BRACKET_REGEXP.exec(source))) {
      let rawName = cap[1]
      let variadic = false
      if (rawName.startsWith('...')) {
        rawName = rawName.slice(3)
        variadic = true
      }
      const [name, rawType] = rawName.split(':')
      args.push({
        name,
        type: this.parseType(rawType),
        variadic,
        required: cap[0][0] === '<',
      })
    }
    return args
  }
}
