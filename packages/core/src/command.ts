import { Context, DisposableList, Service } from 'cordis'
import { camelize, defineProperty, Dict } from 'cosmokit'
import { ArgDecl, Token, TypeInit, Types } from '.'

export interface CommandConfig {
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

export interface Option<U> extends Omit<OptionConfig, 'type'> {
  source: string
  names: string[]
  decl?: ArgDecl<U>
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
      ? | C extends '<'
        ? { [P in K]: T }
        : { [P in K]?: T }
      : never
    : TakeUntil<S, ' ' | ',', C> extends [infer P extends string, infer R extends string, any]
    ? ParseOption<R, T, K | camelize<P>>
    : never
  : { [P in K]?: boolean }

export class Command<U, A extends any[] = any[], O extends {} = {}> {
  _params: ArgDecl<U>[] = []
  _optionList = new DisposableList<Option<U>>()
  _optionDict: Dict<Option<U> | undefined> = Object.create(null)
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
    const decls = this.ctx.iroha.parseArgDecls(def, 'option')
    if (decls.length > 1) {
      throw new TypeError('too many option arguments')
    }
    const decl = decls[0]
    const { type, ...rest } = config
    if (type) {
      if (!decl) {
        throw new TypeError('option type requires argument')
      }
      Object.assign(decl, this.ctx.iroha.parseType(type))
    }
    const option: Option<U> = {
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

  parse(source: string, session: U, args: any[] = [], options: Dict = {}): Argv {
    let variadic: ArgDecl | undefined
    let token: Token
    let option: Option<U> | undefined
    let names: string | string[]
    let param: any
    let content: string
    let quotes: [string, string] | undefined

    while (source) {
      // variadic argument
      const decl = this._params[args.length] || variadic || {}
      // TODO: check args.length === this._arguments.length - 1
      if (decl.variadic) variadic = decl

      // greedy argument
      if (decl.greedy) {
        args.push(decl.parse(source, session))
        break
      }

      // normal argument
      // 1. tokens not starting with `-`
      // 2. quoted tokens
      // 3. numeric tokens at numeric type
      ;[{ content, quotes }, source] = this.ctx.iroha.parseToken(source)
      if (content[0] !== '-' || quotes || (+content) * 0 === 0 && decl.numeric) {
        args.push(decl.parse(content, session))
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
      if (!this._optionDict[name]) {
        args.push(decl.parse(content, session))
        continue
      }
      // if (i > 1 && name.startsWith('no-') && !this._optionDict[name]) {
      //   options[camelCase(name.slice(3))] = false
      //   continue
      // }
      names = i > 1 ? [name] : name
      param = content.slice(++j)
      option = this._optionDict[names[names.length - 1]]

      // peak parameter from next token
      if (!param) {
        if (option?.decl?.greedy) {
          param = source
          source = ''
        } else if (option?.decl) {
          [token, source] = this.ctx.iroha.parseToken(source)
          param = token.content
        } else if (!option && source && this.config.unknownOption === 'allow') {
          let rest: string
          [{ content, quotes }, rest] = this.ctx.iroha.parseToken(source)
          if (content[0] !== '-' || quotes) {
            param = content
            source = rest
          }
        }
      }

      // handle each name
      for (let j = 0; j < names.length; j++) {
        const name = names[j]
        const option = this._optionDict[name]
        content = j === names.length - 1 ? param : ''
        if (option) {
          const value = option.decl ? option.decl.parse(content, session) : true
          for (const key of option.names) {
            options[key] = value
          }
        } else if (this.config.unknownOption === 'allow') {
          options[camelize(name)] = j === names.length - 1 ? param : true // quoted ""
        } else {
          throw new TypeError(`unknown option "${name}"`)
        }
      }
    }

    // assign default values
    for (const option of this._optionList) {
      if (option.default === undefined || option.names[0] in options) continue
      for (const name of option.names) {
        options[name] = option.default
      }
    }

    return { args, options }
  }
}
