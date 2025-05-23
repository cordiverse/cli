import { Context, DisposableList, Service } from 'cordis'
import { camelize, defineProperty, Dict } from 'cosmokit'
import { ArgDecl, Domains, Type } from '.'

export interface CommandConfig {}

export interface CommandAlias {
  options?: {}
  args?: any[]
}

export interface OptionConfig<T extends Type = Type> {
  values: Dict
  type?: T
  default?: any
  descPath?: string
}

export interface TypedOptionConfig<T extends Type> extends OptionConfig<T> {
  type: T
}

export interface ResolvedOptionConfig extends OptionConfig {
  source: string
  decl?: ArgDecl
  type: Type
}

type TakeUntil<S extends string, D extends string, O extends string = ''> =
  | S extends `${infer C}${infer S}`
  ? C extends D ? [O, S, C] : TakeUntil<S, D, `${O}${C}`>
  : [O, S, never]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ParseOptionType<S extends string, T> =
  | TakeUntil<S, ':' | '>' | ']'> extends [string, infer S extends string, ':']
  ? | TakeUntil<S, '>' | ']'> extends [infer K extends keyof Domains, string, any]
    ? Domains[K]
    : never
  : T

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ParseOption<S extends string, T, K extends string = never> =
  | S extends `${infer C}${infer S}`
  ? | C extends ' ' | ',' | '-'
    ? ParseOption<S, T, K>
    : C extends '<' | '['
    ? | ParseOptionType<S, T> extends infer T
      ? | C extends '<'
        ? { [P in K]: T }
        : { [P in K]?: T }
      : never
    : TakeUntil<S, ' ' | ',', C> extends [infer P extends string, infer R extends string, any]
    ? ParseOption<R, T, K | camelize<P>>
    : never
  : { [P in K]?: boolean }

export class Command<U, A extends any[] = any[], O extends {} = {}> {
  _optionList = new DisposableList<OptionConfig>()
  _optionDict: Dict<ResolvedOptionConfig> = Object.create(null)
  _aliases: Dict<CommandAlias> = Object.create(null)

  parent?: Command<U>

  constructor(public ctx: Context, public config: CommandConfig) {
    defineProperty(this, Service.tracker, {
      property: 'ctx',
    })
  }

  * [Service.init]() {
    yield this.ctx.iroha._commands.push(this)
  }

  alias(name: string, alias: CommandAlias) {
    const self = this
    return this.ctx.effect(function* () {
      self._aliases[name] = alias
      yield () => delete self._aliases[name]
      if (name.startsWith('.')) return
      self.ctx.iroha._aliases[name] = self
      yield () => delete self.ctx.iroha._aliases[name]
    })
  }

  option<S extends string>(def: S, config: TypedOptionConfig<RegExp>): Command<S, A, O & ParseOption<S, string>>
  option<S extends string, R>(def: S, config: TypedOptionConfig<(source: string) => R>): Command<S, A, O & ParseOption<S, R>>
  option<S extends string, R extends string>(def: S, config: TypedOptionConfig<readonly R[]>): Command<S, A, O & ParseOption<S, R>>
  option<S extends string>(def: S, config: OptionConfig): Command<S, A, O & ParseOption<S, string>>
  option(source: string, config: OptionConfig) {
    let def = source.trimStart()
    let cap: RegExpExecArray | null
    const names: string[] = []
    while ((cap = /^(-+)([^\s,<\[]+)[,\s]*/.exec(def))) {
      if (cap[2].length > 1 && cap[1] === '-') {
        throw new TypeError('invalid option name')
      }
      def = def.slice(cap.index + cap[0].length)
      names.push(camelize(cap[2]))
    }
    const decls = this.ctx.iroha.parseDecl(def)
    if (decls.length > 1) {
      throw new TypeError('too many option arguments')
    }
    const decl = decls[0]
    const option: ResolvedOptionConfig = {
      ...config,
      source,
      decl,
      type: this.ctx.iroha.parseType(config.type ?? decl?.type),
    }
    const conflicts = names.filter(name => this._optionDict[name])
    if (conflicts.length) {
      throw new TypeError(`duplicate option: ${conflicts.join(', ')}`)
    }
    const self = this
    this.ctx.effect(function* () {
      yield self._optionList.push(option)
      for (const name of names) {
        self._optionDict[name] = option
      }
      yield () => {
        for (const name of names) {
          delete self._optionDict[name]
        }
      }
    })
    return this
  }
}
