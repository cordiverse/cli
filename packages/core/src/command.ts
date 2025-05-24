import { Context, DisposableList, Service } from 'cordis'
import { camelize, defineProperty, Dict } from 'cosmokit'
import { ArgDecl, TypeInit, Types } from '.'

export interface CommandConfig {
  unknownNegative?: 'option' | 'string'
  unknownOption?: 'allow' | 'error'
}

export interface CommandAlias {
  options?: {}
  args?: any[]
}

export interface OptionConfig<T extends TypeInit = TypeInit> {
  type?: T
  default?: any
  descPath?: string
}

export interface TypedOptionConfig<T extends TypeInit> extends OptionConfig<T> {
  type: T
}

export interface Option extends Omit<OptionConfig, 'type'> {
  source: string
  names: string[]
  decl?: ArgDecl
}

export interface Argv {
  args: any[]
  options: Dict
}

type TakeUntil<S extends string, D extends string, O extends string = ''> =
  | S extends `${infer C}${infer S}`
  ? C extends D ? [O, S, C] : TakeUntil<S, D, `${O}${C}`>
  : [O, S, never]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ParseOptionType<S extends string, T> =
  | TakeUntil<S, ':' | '>' | ']'> extends [string, infer S extends string, ':']
  ? | TakeUntil<S, '>' | ']'> extends [infer K extends keyof Types, string, any]
    ? Types[K]
    : never
  : T

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ParseOption<S extends string, T, K extends string = never> =
  | S extends `${infer C}${infer S}`
  ? | C extends ' ' | ',' | '-'
    ? ParseOption<S, T, K>
    : C extends '<' | '['
    ? | ParseOptionType<S, T> extends infer T
      ? | (S extends `..${string}` ? T[] : T) extends infer T
        ? | C extends '<'
          ? { [P in K]: T }
          : { [P in K]?: T }
        : never
      : never
    : TakeUntil<S, ' ' | ',', C> extends [infer P extends string, infer R extends string, any]
    ? ParseOption<R, T, K | camelize<P>>
    : never
  : { [P in K]?: boolean }

export class Command<in U = never, A extends any[] = any[], O extends {} = {}> {
  _arguments: ArgDecl[] = []
  _optionList = new DisposableList<Option>()
  _optionDict: Dict<Option | undefined> = Object.create(null)
  _aliases: Dict<CommandAlias> = Object.create(null)

  parent?: Command

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

  option<S extends string>(def: S, config: TypedOptionConfig<RegExp>): Command<U, A, O & ParseOption<S, string>>
  option<S extends string, R>(def: S, config: TypedOptionConfig<(source: string) => R>): Command<U, A, O & ParseOption<S, R>>
  option<S extends string, R extends string>(def: S, config: TypedOptionConfig<readonly R[]>): Command<U, A, O & ParseOption<S, R>>
  option<S extends string>(def: S, config?: OptionConfig): Command<U, A, O & ParseOption<S, string>>
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
    const decls = this.ctx.iroha.parseArgDecls(def, 'option')
    if (decls.length > 1) {
      throw new TypeError('option accepts at most one argument')
    }
    const decl = decls[0]
    const { type, ...rest } = config
    if (type) {
      if (!decl) {
        throw new TypeError('option with type requires argument')
      }
      Object.assign(decl, this.ctx.iroha.parseType(type))
    }
    const option: Option = {
      ...rest,
      names,
      source,
      decl,
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

  parse(source: string, args: any[] = [], options: Dict = {}): Argv {
    let variadic: ArgDecl | undefined
    let option: Option | undefined
    let names: string | string[]
    let rest: string
    let content: string
    let quotes: [string, string] | undefined
    const _options: Dict = Object.create(null)

    while (source) {
      // variadic argument
      const decl = this._arguments[args.length] || variadic
      if (decl.variadic) variadic = decl
      if (!decl) throw new TypeError('too many arguments')

      // greedy argument
      if (decl.greedy) {
        args.push(decl.parse(source))
        break
      }

      // normal argument
      // 1. tokens not starting with `-`
      // 2. quoted tokens
      // 3. numeric tokens at numeric type
      ;[{ content, quotes }, source] = this.ctx.iroha.parseToken(source)
      if (content[0] !== '-' || quotes || (+content) * 0 === 0 && this.config.unknownNegative !== 'option' && !this._optionDict[content.slice(1)]) {
        args.push(decl.parse(content))
        continue
      }

      // find -
      let i = 0
      for (; i < content.length; ++i) {
        if (content.charCodeAt(i) !== 45) break
      }

      // find =
      let j = i + 1
      for (; j < content.length; j++) {
        if (content.charCodeAt(j) === 61) break
      }

      const name = content.slice(i, j)
      names = i > 1 ? [camelize(name)] : name
      content = content.slice(++j)

      // peak parameter from next token
      quotes = undefined
      if (!content) {
        option = this._optionDict[names[names.length - 1]]
        if (option) {
          if (option.decl?.greedy) {
            content = source
            source = ''
          } else if (option.decl) {
            [{ content, quotes }, source] = this.ctx.iroha.parseToken(source)
          }
        } else if (i > 1 && content.slice(i, j).startsWith('no-') && (option = this._optionDict[camelize(content.slice(i + 3, j))])) {
          // explicit set undefined to skip default
          _options[option.source] = undefined
        } else if (source && this.config.unknownOption === 'allow') {
          [{ content, quotes }, rest] = this.ctx.iroha.parseToken(source)
          if (content[0] !== '-' || quotes || (+content) * 0 === 0 && this.config.unknownNegative !== 'option' && !this._optionDict[content.slice(1)]) {
            source = rest
          } else {
            content = ''
            quotes = undefined
          }
        }
      }

      // handle each name
      for (let j = 0; j < names.length; j++) {
        const name = names[j]
        const option = this._optionDict[name]
        const param = j === names.length - 1 ? content : ''
        if (option) {
          const value = option.decl ? option.decl.parse(param) : true
          if (option.decl?.variadic) {
            (_options[option.source] ??= []).push(value)
          } else {
            _options[option.source] = value
          }
        } else if (this.config.unknownOption === 'allow') {
          options[name] = j === names.length - 1 || quotes ? param : true
        } else {
          throw new TypeError(`unknown option: "${name}"`)
        }
      }
    }

    // check argument count
    if (args.length < this._arguments.length) {
      throw new TypeError(`missing arguments: ${this._arguments.slice(args.length).map(arg => `"${arg.name}"`).join(', ')}`)
    }

    // assign option values with default
    const missing: string[] = []
    for (const option of this._optionList) {
      let value = _options[option.source]
      if (value === undefined && !(option.source in _options)) {
        value = option.default
      }
      if (value === undefined) {
        if (option.decl?.required) missing.push(option.source)
        continue
      }
      for (const name of option.names) {
        options[name] = value
      }
    }
    if (missing.length) {
      throw new TypeError(`missing options: ${missing.map(source => `"${source}"`).join(', ')}`)
    }

    return { args, options }
  }
}
