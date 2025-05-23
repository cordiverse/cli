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

export interface Type<out T = any> {
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

export type ArgKind = 'argument' | 'option'

export interface ArgDecl extends Type {
  kind: ArgKind
  name: string
  variadic: boolean
  required: boolean
}

export interface Token {
  content: string
  quotes?: [string, string]
}

export interface ParserResult {
  tokens: Token[]
}

const LEFT_QUOTES = `"'“‘`
const RIGHT_QUOTES = `"'”’`

export default class Iroha extends Service {
  _builtin: Dict<Type | undefined> = {}
  _commands = new DisposableList<Command>()
  _aliases: Dict<Command | undefined> = Object.create(null)

  constructor(ctx: Context) {
    super(ctx, 'iroha')

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

  parseArgDecls(source: string, kind: ArgKind): ArgDecl[] {
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
        ...this.parseType(rawType),
        name,
        kind,
        variadic,
        required: cap[0][0] === '<',
      })
    }
    return args
  }

  parseToken(source: string): [Token, string] {
    const quoteIndex = LEFT_QUOTES.indexOf(source[0])
    const rightQuote = RIGHT_QUOTES[quoteIndex]
    const stopReg = new RegExp(rightQuote ? `${rightQuote}([\s]+|$)|$` : `[\s]+|$`)
    const capture = stopReg.exec(source)!
    const content = source.slice(0, capture.index)
    source = source.slice(capture.index + capture[0].length)
    const token: Token = {
      content,
      quotes: rightQuote
        ? [source[0], capture[0] === rightQuote ? rightQuote : '']
        : undefined,
    }
    return [token, source]
  }
}
