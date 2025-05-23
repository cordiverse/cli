import { Context, Service } from 'cordis'
import { Dict, Time } from 'cosmokit'

declare module 'cordis' {
  interface Context {
    iroha: Iroha
  }
}

// https://github.com/microsoft/TypeScript/issues/17002
// it never got fixed so we have to do this
const isArray = Array.isArray as (arg: any) => arg is readonly any[]

export type Transform<S = never, T = any> = (source: string, session: S) => T

export interface DomainConfig<S = never, T = any> {
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

export default class Iroha<S = never> extends Service {
  _builtin: Dict<DomainConfig<S>> = {}

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

  domain<K extends keyof Domains>(name: K, transform: Transform<S, Domains[K]>, options?: DomainConfig<S, Domains[K]>) {
    return this.ctx.effect(() => {
      this._builtin[name] = { ...options, transform }
      return () => delete this._builtin[name]
    })
  }

  resolveDomain(type?: Type<S>) {
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
}
