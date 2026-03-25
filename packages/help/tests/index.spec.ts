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
      expect(result).to.include('error:')
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
      expect(result).to.include('error:')
      expect(result).to.include('not found')
      expect(result).to.include('--help')
    })

    it('should format parse error with usage', async () => {
      const cmd = ctx.cli.command('err-test')
      const input = new Input.String('err-test --unknown')
      const result = await ctx.cli.execute(input)
      expect(result).to.include('error:')
      expect(result).to.include('err-test')
      cmd.dispose()
    })
  })
})
