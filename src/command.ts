import { camelCase, Dict, paramCase, remove } from 'cosmokit'
import { ArgumentType, Declaration, OptionConfig, OptionDeclaration, OptionType, TypedOptionConfig } from '.'
import { Context } from 'cordis'
import { Argv } from './parser'

export type Extend<O extends {}, K extends string, T> = {
  [P in K | keyof O]?: (P extends keyof O ? O[P] : unknown) & (P extends K ? T : unknown)
}

export namespace Command {
  export interface Alias {
    options?: Dict
    args?: string[]
  }

  export interface Config {
    strictOptions?: boolean
  }
}

export class Command<A extends any[] = any[], O extends {} = {}> {
  public declaration: string

  children: Command[] = []
  _parent: Command | null = null
  _aliases: Dict<Command.Alias> = {}

  public _arguments: Declaration[]
  public _options: Dict<OptionDeclaration> = {}
  public _disposables?: Disposable[] = []

  private _namedOptions: Dict<OptionDeclaration> = {}
  private _symbolicOptions: Dict<OptionDeclaration> = {}

  constructor(public readonly name: string, declaration: string, public ctx: Context, public config: Command.Config) {
    if (!name) throw new Error('expect a command name')
    const declList = this._arguments = ctx.iroha.parseDecl(declaration)
    this.declaration = declList.stripped
    this._registerAlias(name)
    ctx.iroha._commandList.push(this)
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Command <${this.name}>`
  }

  get caller(): Context {
    return this[Context.current] || this.ctx
  }

  get displayName() {
    return Object.keys(this._aliases)[0]
  }

  set displayName(name) {
    this._registerAlias(name, true)
  }

  get parent() {
    return this._parent
  }

  set parent(parent: Command | null) {
    if (this._parent === parent) return
    if (this._parent) {
      remove(this._parent.children, this)
    }
    this._parent = parent
    if (parent) {
      parent.children.push(this)
    }
  }

  private _registerAlias(name: string, prepend = false, options: Command.Alias = {}) {
    name = name.toLowerCase()
    if (name.startsWith('.')) name = this.parent!.name + name

    // add to list
    const existing = this._aliases[name]
    if (existing) {
      if (prepend) {
        this._aliases = { [name]: existing, ...this._aliases }
      }
      return
    } else if (prepend) {
      this._aliases = { [name]: options, ...this._aliases }
    } else {
      this._aliases[name] = options
    }

    // register global
    const previous = this.ctx.iroha._commands.get(name)
    if (!previous) {
      this.ctx.iroha._commands.set(name, this)
    } else if (previous !== this) {
      throw new Error(`duplicate command names: "${name}"`)
    }
  }

  alias(...names: string[]): this
  alias(name: string, options: Command.Alias): this
  alias(...args: any[]) {
    if (typeof args[1] === 'object') {
      this._registerAlias(args[0], false, args[1])
    } else {
      for (const name of args) {
        this._registerAlias(name)
      }
    }
    return this
  }

  subcommand<D extends string>(def: D, config?: Command.Config): Command<ArgumentType<D>>
  subcommand<D extends string>(def: D, desc: string, config?: Command.Config): Command<ArgumentType<D>>
  subcommand(def: string, ...args: any[]) {
    def = this.name + (def.charCodeAt(0) === 46 ? '' : '/') + def
    const desc = typeof args[0] === 'string' ? args.shift() as string : ''
    const config = args[0] as Command.Config || {}
    return this.ctx.command(def, desc, config)
  }

  _createOption(name: string, def: string, config: OptionConfig) {
    // do not use lookbehind assertion for Safari compatibility
    const cap = /^((?:-[\w-]*|[^,\s\w\x80-\uffff]+)(?:,\s*(?:-[\w-]*|[^,\s\w\x80-\uffff]+))*(?=\s|$))?((?:\s*\[[^\]]+?\]|\s*<[^>]+?>)*)(.*)$/.exec(def)!
    const param = paramCase(name)
    let syntax = cap[1] || '--' + param
    const bracket = cap[2] || ''

    const aliases: string[] = config.aliases ?? []
    const symbols: string[] = config.symbols ?? []
    for (let param of syntax.trim().split(',')) {
      param = param.trimStart()
      const name = param.replace(/^-+/, '')
      if (!name || !param.startsWith('-')) {
        symbols.push(param)
      } else {
        aliases.push(name)
      }
    }

    if (!('value' in config) && !aliases.includes(param)) {
      syntax += ', --' + param
    }

    const declList = this.ctx.iroha.parseDecl(bracket.trimStart())
    if (declList.stripped) syntax += ' ' + declList.stripped
    const option = this._options[name] ||= {
      ...declList[0],
      ...config,
      name,
      values: {},
      variants: {},
      syntax,
    }

    const fallbackType = typeof option.fallback
    if ('value' in config) {
      option.variants[config.value] = { ...config, syntax }
      aliases.forEach(name => option.values[name] = config.value)
    } else if (!bracket.trim()) {
      option.type = 'boolean'
    } else if (!option.type && (fallbackType === 'string' || fallbackType === 'number')) {
      option.type = fallbackType
    }

    this._assignOption(option, aliases, this._namedOptions)
    this._assignOption(option, symbols, this._symbolicOptions)
    if (!this._namedOptions[param]) {
      this._namedOptions[param] = option
    }
  }

  private _assignOption(option: OptionDeclaration, names: readonly string[], optionMap: Dict<OptionDeclaration>) {
    for (const name of names) {
      if (name in optionMap) {
        throw new Error(`duplicate option name "${name}" for command "${this.name}"`)
      }
      optionMap[name] = option
    }
  }

  option<K extends string>(name: K, desc: string, config: TypedOptionConfig<RegExp>): Command<A, Extend<O, K, string>>
  option<K extends string, R>(name: K, desc: string, config: TypedOptionConfig<(source: string) => R>): Command<A, Extend<O, K, R>>
  option<K extends string, R extends string>(name: K, desc: string, config: TypedOptionConfig<R[]>): Command<A, Extend<O, K, R>>
  option<K extends string, D extends string>(name: K, desc: D, config?: OptionConfig): Command<A, Extend<O, K, OptionType<D>>>
  option(name: string, ...args: [OptionConfig?] | [string, OptionConfig?]) {
    let desc = ''
    if (typeof args[0] === 'string') {
      desc = args.shift() as string
    }
    const config = { ...args[0] as OptionConfig }
    config.permissions ??= [`authority:${config.authority ?? 0}`]
    this._createOption(name, desc, config)
    this.caller.collect('option', () => this.removeOption(name))
    return this
  }

  removeOption<K extends string>(name: K) {
    if (!this._options[name]) return false
    const option = this._options[name]
    delete this._options[name]
    for (const key in this._namedOptions) {
      if (this._namedOptions[key] === option) {
        delete this._namedOptions[key]
      }
    }
    for (const key in this._symbolicOptions) {
      if (this._symbolicOptions[key] === option) {
        delete this._symbolicOptions[key]
      }
    }
    return true
  }

  parse(argv: string | Argv, terminator?: string, args: any[] = [], options: Dict<any> = {}): Argv {
    if (typeof argv === 'string') argv = Argv.parse(argv, terminator)

    if (!argv.source && argv.tokens) {
      argv.source = this.name + ' ' + Argv.stringify(argv)
    }

    let lastArgDecl: Declaration | undefined

    while (!argv.error && argv.tokens?.length) {
      const token = argv.tokens[0]
      let { content, quoted } = token

      // variadic argument
      const argDecl = this._arguments[args.length] || lastArgDecl || {}
      if (args.length === this._arguments.length - 1 && argDecl.variadic) {
        lastArgDecl = argDecl
      }

      // greedy argument
      if (content[0] !== '-' && this.ctx.iroha.resolveDomain(argDecl.type).greedy) {
        args.push(this.ctx.iroha.parseValue(Argv.stringify(argv), 'argument', argv, argDecl))
        break
      }

      // parse token
      argv.tokens.shift()
      let option: OptionDeclaration
      let names: string | string[]
      let param: string | undefined
      // symbolic option
      if (!quoted && (option = this._symbolicOptions[content])) {
        names = [paramCase(option.name)]
      } else {
        // normal argument
        if (content[0] !== '-' || quoted || (+content) * 0 === 0 && this.ctx.iroha.resolveDomain(argDecl.type).numeric) {
          args.push(this.ctx.iroha.parseValue(content, 'argument', argv, argDecl))
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
        if (this.config.strictOptions && !this._namedOptions[name]) {
          args.push(this.ctx.iroha.parseValue(content, 'argument', argv, argDecl))
          continue
        }
        if (i > 1 && name.startsWith('no-') && !this._namedOptions[name]) {
          options[camelCase(name.slice(3))] = false
          continue
        }
        names = i > 1 ? [name] : name
        param = content.slice(++j)
        option = this._namedOptions[names[names.length - 1]]
      }

      // get parameter from next token
      quoted = false
      if (!param) {
        const { type, values } = option || {}
        if (this.ctx.iroha.resolveDomain(type).greedy) {
          param = Argv.stringify(argv)
          quoted = true
          argv.tokens = []
        } else {
          // Option has bounded value or option is boolean.
          const isValued = names[names.length - 1] in (values || {}) || type === 'boolean'
          if (!isValued && argv.tokens.length && (type || argv.tokens[0]?.content !== '-')) {
            const token = argv.tokens.shift()!
            param = token.content
            quoted = token.quoted
          }
        }
      }

      // handle each name
      for (let j = 0; j < names.length; j++) {
        const name = names[j]
        const optDecl = this._namedOptions[name]
        const key = optDecl ? optDecl.name : camelCase(name)
        if (optDecl && name in optDecl.values) {
          options[key] = optDecl.values[name]
        } else {
          const source = j + 1 < names.length ? '' : param
          options[key] = this.ctx.iroha.parseValue(source, 'option', argv, optDecl)
        }
        if (argv.error) break
      }
    }

    // assign default values
    for (const { name, fallback } of Object.values(this._options)) {
      if (fallback !== undefined && !(name in options)) {
        options[name] = fallback
      }
    }

    delete argv.tokens
    return { ...argv, options, args, error: argv.error || '', command: this as any }
  }

  private stringifyArg(value: any) {
    value = '' + value
    return value.includes(' ') ? `"${value}"` : value
  }

  stringify(args: readonly string[], options: any) {
    let output = this.name
    for (const key in options) {
      const value = options[key]
      if (value === true) {
        output += ` --${key}`
      } else if (value === false) {
        output += ` --no-${key}`
      } else {
        output += ` --${key} ${this.stringifyArg(value)}`
      }
    }
    for (const arg of args) {
      output += ' ' + this.stringifyArg(arg)
    }
    return output
  }

  async execute(argv: Argv<A, O>, fallback: Next = Next.compose): Promise<Fragment> {
    argv.command ??= this
    argv.args ??= [] as any
    argv.options ??= {} as any

    const { args, options, error } = argv
    if (error) return error
    if (logger.level >= 3) logger.debug(argv.source ||= this.stringify(args, options))

    // before hooks
    for (const validator of this._checkers) {
      const result = await validator.call(this, argv, ...args)
      if (!isNullable(result)) return result
    }

    // FIXME empty actions will cause infinite loop
    if (!this._actions.length) return ''

    let index = 0
    const queue: Next.Queue = this._actions.map(action => async () => {
      return await action.call(this, argv, ...args)
    })

    queue.push(fallback)
    const length = queue.length
    argv.next = async (callback) => {
      if (callback !== undefined) {
        queue.push(next => Next.compose(callback, next))
        if (queue.length > Next.MAX_DEPTH) {
          throw new Error(`middleware stack exceeded ${Next.MAX_DEPTH}`)
        }
      }
      return queue[index++]?.(argv.next)
    }

    try {
      const result = await argv.next()
      if (!isNullable(result)) return result
    } catch (error) {
      if (index === length) throw error
      if (error instanceof SessionError) {
        return argv.session.text(error.path, error.param)
      }
      const stack = coerce(error)
      logger.warn(`${argv.source ||= this.stringify(args, options)}\n${stack}`)
      this.ctx.emit(argv.session, 'command-error', argv, error)
      if (typeof this.config.handleError === 'function') {
        const result = await this.config.handleError(error, argv)
        if (!isNullable(result)) return result
      } else if (this.config.handleError) {
        return argv.session.text('internal.error-encountered')
      }
    }

    return ''
  }

  dispose() {
    this._disposables.splice(0).forEach(dispose => dispose())
    this.ctx.emit('command-removed', this)
    for (const cmd of this.children.slice()) {
      cmd.dispose()
    }
    for (const name in this._aliases) {
      this.ctx.iroha._commands.delete(name)
    }
    remove(this.ctx.iroha._commandList, this)
    this.parent = null
  }
}
