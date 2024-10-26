import { Awaitable, camelize, Dict, isNullable, remove } from 'cosmokit'
import { coerce } from '@koishijs/utils'
import { Fragment, Logger, Schema } from '@satorijs/core'
import { Argv } from './parser'
import { Context } from 'cordis'

export namespace Command {
  export type Action<A extends any[] = any[], O extends {} = {}>
    = (argv: Argv<A, O>, ...args: A) => Awaitable<void | Fragment>

  export type Usage = string | ((session: Session) => Awaitable<string>)
}

export class Command<A extends any[] = any[], O extends {} = {}> extends Argv.CommandBase<Command.Config> {
  _examples: string[] = []
  _usage?: Command.Usage

  private _actions: Command.Action[] = []
  private _checkers: Command.Action[] = [async (argv) => {
    return this.ctx.serial(argv.session, 'command/before-execute', argv)
  }]

  constructor(name: string, decl: string, ctx: Context, config: Command.Config) {
    super(name, decl, ctx, {
      ...config,
    })
  }

  usage(text: Command.Usage) {
    this._usage = text
    return this
  }

  example(example: string) {
    this._examples.push(example)
    return this
  }

  match(session: Session) {
    return this.ctx.filter(session)
  }

  check(callback: Command.Action<A, O>, append = false) {
    return this.before(callback, append)
  }

  before(callback: Command.Action<A, O>, append = false) {
    if (append) {
      this._checkers.push(callback)
    } else {
      this._checkers.unshift(callback)
    }
    this.caller.scope.disposables?.push(() => remove(this._checkers, callback))
    return this
  }

  action(callback: Command.Action<A, O>, prepend = false) {
    if (prepend) {
      this._actions.unshift(callback)
    } else {
      this._actions.push(callback)
    }
    this.caller.scope.disposables?.push(() => remove(this._actions, callback))
    return this
  }
}

export namespace Command {
  export interface Config extends Argv.CommandBase.Config {
    /** disallow unknown options */
    checkUnknown?: boolean
    /** check argument count */
    checkArgCount?: boolean
    /** show command warnings */
    showWarning?: boolean
    /** handle error */
    handleError?: boolean | ((error: Error, argv: Argv) => Awaitable<void | Fragment>)
  }

  export const Config: Schema<Config> = Schema.object({
    permissions: Schema.array(String).role('perms').default(['authority:1']).description('权限继承。'),
    dependencies: Schema.array(String).role('perms').description('权限依赖。'),
    slash: Schema.boolean().description('启用斜线指令功能。').default(true),
    checkUnknown: Schema.boolean().description('是否检查未知选项。').default(false).hidden(),
    checkArgCount: Schema.boolean().description('是否检查参数数量。').default(false).hidden(),
    showWarning: Schema.boolean().description('是否显示警告。').default(true).hidden(),
    handleError: Schema.union([Schema.boolean(), Schema.function()]).description('是否处理错误。').default(true).hidden(),
  })
}
