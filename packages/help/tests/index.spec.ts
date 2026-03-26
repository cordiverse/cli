import { Context } from 'cordis'
import { expect } from 'chai'
import CLI from '../../core/src/index.ts'
import * as help from '../src/index.ts'
import { Input } from '../../core/src/parser.ts'

const ctx = new Context()

before(async () => {
  await ctx.plugin(CLI)
  await ctx.plugin(help)
})

describe('plugin-cli-help', () => {
  describe('help command', () => {
    it('should register help command', () => {
      expect(ctx.cli._aliases['help']).to.exist
    })

    it('should list available commands', async () => {
      const cmd = ctx.cli.command('help-greet <name>')
      const input = new Input.String('help')
      const result = await ctx.cli.execute(input)
      expect(result).to.be.a('string')
      expect(result).to.include('help-greet')
      expect(result).to.include('Commands:')
      cmd.dispose()
    })

    it('should show help for specific command', async () => {
      const cmd = ctx.cli.command('help-deploy <target>')
      cmd.option('-f, --force')
      cmd.option('-p, --port <port:number>')
      const input = new Input.String('help help-deploy')
      const result = await ctx.cli.execute(input)
      expect(result).to.be.a('string')
      expect(result).to.include('help-deploy')
      expect(result).to.include('<target>')
      expect(result).to.include('-f, --force')
      expect(result).to.include('-p, --port <port:number>')
      cmd.dispose()
    })

    it('should report unknown command', async () => {
      const input = new Input.String('help nonexistent')
      const result = await ctx.cli.execute(input)
      expect(result).to.include('Error:')
      expect(result).to.include('not found')
    })

    it('should show usage hint in list', async () => {
      const input = new Input.String('help')
      const result = await ctx.cli.execute(input)
      expect(result).to.include('--help')
    })
  })

  describe('-h / --help interception', () => {
    it('should intercept -h and show help', async () => {
      const cmd = ctx.cli.command('help-cmd <file>')
      cmd.option('-v, --verbose')
      let actionCalled = false
      cmd.action(() => { actionCalled = true })

      const input = new Input.String('help-cmd -h')
      const result = await ctx.cli.execute(input)
      expect(actionCalled).to.be.false
      expect(result).to.be.a('string')
      expect(result).to.include('help-cmd')
      expect(result).to.include('<file>')
      cmd.dispose()
    })

    it('should intercept --help and show help', async () => {
      const cmd = ctx.cli.command('help-another')
      cmd.action(() => 'normal')

      const input = new Input.String('help-another --help')
      const result = await ctx.cli.execute(input)
      expect(result).to.be.a('string')
      expect(result).to.include('help-another')
      cmd.dispose()
    })

    it('should not intercept when -h not passed', async () => {
      const cmd = ctx.cli.command('help-normal')
      cmd.action(() => 'normal result')

      const input = new Input.String('help-normal')
      const result = await ctx.cli.execute(input)
      expect(result).to.equal('normal result')
      cmd.dispose()
    })

    it('should intercept even with missing required args', async () => {
      const cmd = ctx.cli.command('help-strict <a> <b> <c>')
      cmd.action(() => 'should not run')

      const input = new Input.String('help-strict --help')
      const result = await ctx.cli.execute(input)
      expect(result).to.include('help-strict')
      expect(result).to.include('<a>')
      cmd.dispose()
    })
  })

  describe('error formatting', () => {
    it('should format unknown command error', async () => {
      const input = new Input.String('nonexistent')
      const result = await ctx.cli.execute(input)
      expect(result).to.include('Error:')
      expect(result).to.include('not found')
      expect(result).to.include('--help')
    })

    it('should format parse error with usage', async () => {
      const cmd = ctx.cli.command('err-test')
      const input = new Input.String('err-test --unknown')
      const result = await ctx.cli.execute(input)
      expect(result).to.include('Error:')
      expect(result).to.include('err-test')
      cmd.dispose()
    })
  })
})

describe('subcommands', () => {
  it('should list subcommands in command help', async () => {
    const parent = ctx.cli.command('pkg', 'Package manager')
    const build = ctx.cli.command('pkg.build', 'Build packages')
    const test = ctx.cli.command('pkg.test', 'Run tests')

    const input = new Input.String('help pkg')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('[COMMAND]')
    expect(result).to.include('build')
    expect(result).to.include('test')
    expect(result).to.include('Build packages')
    expect(result).to.include('Run tests')

    parent.dispose()
    build.dispose()
    test.dispose()
  })

  it('should show description in command list', async () => {
    const cmd = ctx.cli.command('described-cmd', 'A very useful command')
    const input = new Input.String('help')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('A very useful command')
    cmd.dispose()
  })

  it('should hide hidden commands by default', async () => {
    const visible = ctx.cli.command('visible-cmd', 'Visible')
    const hidden = ctx.cli.command('hidden-cmd', 'Hidden', { hidden: true })

    const input1 = new Input.String('help')
    const result1 = await ctx.cli.execute(input1)
    expect(result1).to.include('visible-cmd')
    expect(result1).to.not.include('hidden-cmd')

    visible.dispose()
    hidden.dispose()
  })

  it('should show hidden commands with -H', async () => {
    const visible = ctx.cli.command('vis2', 'Visible')
    const hidden = ctx.cli.command('hid2', 'Hidden', { hidden: true })

    const input = new Input.String('help -H')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('vis2')
    expect(result).to.include('hid2')

    visible.dispose()
    hidden.dispose()
  })
})

describe('hidden options', () => {
  it('should hide hidden options by default', async () => {
    const cmd = ctx.cli.command('opt-vis', 'Test')
    cmd.option('-v, --verbose')
    cmd.option('--internal', { hidden: true })

    const input = new Input.String('help opt-vis')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('--verbose')
    expect(result).to.not.include('--internal')

    cmd.dispose()
  })

  it('should show hidden options with -H', async () => {
    const cmd = ctx.cli.command('opt-vis2', 'Test')
    cmd.option('-v, --verbose')
    cmd.option('--internal', { hidden: true })

    const input = new Input.String('help -H opt-vis2')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('--verbose')
    expect(result).to.include('--internal')

    cmd.dispose()
  })
})

describe('bare command fallback to help', () => {
  it('should show help when bare command has subcommands', async () => {
    const parent = ctx.cli.command('myapp', 'My application')
    parent.option('-v, --version')
    parent.action(({ options }) => {
      if ((options as any).version) return 'v1.0.0'
    })
    const sub = ctx.cli.command('myapp.run', 'Run the app')

    // bare `myapp` → should show help (has subcommands, no args passed)
    const input = new Input.String('myapp')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('myapp')
    expect(result).to.include('run')
    expect(result).to.include('Commands:')

    parent.dispose()
    sub.dispose()
  })

  it('should not show help when -v is passed', async () => {
    const parent = ctx.cli.command('myapp2', 'My application')
    parent.option('-v, --version')
    parent.action(({ options }) => {
      if ((options as any).version) return 'v1.0.0'
    })
    const sub = ctx.cli.command('myapp2.run', 'Run the app')

    const input = new Input.String('myapp2 -v')
    const result = await ctx.cli.execute(input)
    expect(result).to.equal('v1.0.0')

    parent.dispose()
    sub.dispose()
  })

  it('should not fallback for command without subcommands', async () => {
    const cmd = ctx.cli.command('simple-cmd', 'Simple')
    cmd.action(() => 'hello')

    const input = new Input.String('simple-cmd')
    const result = await ctx.cli.execute(input)
    expect(result).to.equal('hello')

    cmd.dispose()
  })
})

describe('no such command for subcommand-bearing commands', () => {
  it('should report no such command instead of too many arguments', async () => {
    const parent = ctx.cli.command('tool', 'A tool')
    const sub = ctx.cli.command('tool.build', 'Build')

    const input = new Input.String('tool aaa')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('Error:')
    expect(result).to.include('no such command')
    expect(result).to.include('aaa')

    parent.dispose()
    sub.dispose()
  })

  it('should still allow options on parent command', async () => {
    const parent = ctx.cli.command('tool2', 'A tool')
    parent.option('-v, --verbose')
    parent.action(({ options }) => {
      if ((options as any).verbose) return 'verbose mode'
    })
    const sub = ctx.cli.command('tool2.build', 'Build')

    const input = new Input.String('tool2 --verbose')
    const result = await ctx.cli.execute(input)
    expect(result).to.equal('verbose mode')

    parent.dispose()
    sub.dispose()
  })

  it('should report too many arguments for commands without subcommands', async () => {
    const cmd = ctx.cli.command('nosubcmd', 'No subs')
    cmd.action(() => 'ok')

    const input = new Input.String('nosubcmd extra')
    const result = await ctx.cli.execute(input)
    expect(result).to.include('Error:')
    expect(result).to.include('too many arguments')

    cmd.dispose()
  })
})
