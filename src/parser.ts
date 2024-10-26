import { Dict } from 'cosmokit'
import { escapeRegExp } from '@koishijs/utils'
import { h } from '@satorijs/core'
import { Command } from './command-1'

export interface Token {
  rest?: string
  content: string
  quoted: boolean
  terminator: string
  inters: Argv[]
}

export interface Argv<A extends any[] = any[], O extends {} = {}, S = never> {
  args?: A
  options?: O
  error?: string
  source?: string
  initiator?: string
  terminator?: string
  command?: Command<A, O>
  session?: S
  rest?: string
  pos?: number
  root?: boolean
  tokens?: Token[]
  name?: string
}

const leftQuotes = `"'“‘`
const rightQuotes = `"'”’`

export namespace Argv {
  export interface Interpolation {
    terminator?: string
    parse?(source: string): Argv
  }

  const bracs: Dict<Interpolation> = {}

  export function interpolate(initiator: string, terminator: string, parse?: (source: string) => Argv) {
    bracs[initiator] = { terminator, parse }
  }

  interpolate('$(', ')')

  export namespace whitespace {
    export const unescape = (source: string) => source
      .replace(/@__KOISHI_SPACE__@/g, ' ')
      .replace(/@__KOISHI_NEWLINE__@/g, '\n')
      .replace(/@__KOISHI_RETURN__@/g, '\r')
      .replace(/@__KOISHI_TAB__@/g, '\t')

    export const escape = (source: string) => source
      .replace(/ /g, '@__KOISHI_SPACE__@')
      .replace(/\n/g, '@__KOISHI_NEWLINE__@')
      .replace(/\r/g, '@__KOISHI_RETURN__@')
      .replace(/\t/g, '@__KOISHI_TAB__@')
  }

  export class Tokenizer {
    private bracs: Dict<Interpolation>

    constructor() {
      this.bracs = Object.create(bracs)
    }

    interpolate(initiator: string, terminator: string, parse?: (source: string) => Argv) {
      this.bracs[initiator] = { terminator, parse }
    }

    parseToken(source: string, stopReg = '$'): Token {
      const parent = { inters: [] } as Token
      const index = leftQuotes.indexOf(source[0])
      const quote = rightQuotes[index]
      let content = ''
      if (quote) {
        source = source.slice(1)
        stopReg = `${quote}(?=${stopReg})|$`
      }
      stopReg += `|${Object.keys({ ...this.bracs, ...bracs }).map(escapeRegExp).join('|')}`
      const regExp = new RegExp(stopReg)
      while (true) {
        const capture = regExp.exec(source)!
        content += whitespace.unescape(source.slice(0, capture.index))
        if (capture[0] in this.bracs) {
          source = source.slice(capture.index + capture[0].length).trimStart()
          const { parse, terminator } = this.bracs[capture[0]]
          const argv = parse?.(source) || this.parse(source, terminator)
          source = argv.rest
          parent.inters.push({ ...argv, pos: content.length, initiator: capture[0] })
        } else {
          const quoted = capture[0] === quote
          const rest = source.slice(capture.index + +quoted)
          parent.rest = rest.trimStart()
          parent.quoted = quoted
          parent.terminator = capture[0]
          if (quoted) {
            parent.terminator += rest.slice(0, -parent.rest.length)
          } else if (quote) {
            content = leftQuotes[index] + content
            parent.inters.forEach(inter => inter.pos += 1)
          }
          parent.content = content
          if (quote === "'") Argv.revert(parent)
          return parent
        }
      }
    }

    parse(source: string, terminator = ''): Argv {
      const tokens: Token[] = []
      source = h.parse(source).map((el) => {
        return el.type === 'text' ? el.toString() : whitespace.escape(el.toString())
      }).join('')
      let rest = source, term = ''
      const stopReg = `\\s+|[${escapeRegExp(terminator)}]|$`
      // eslint-disable-next-line no-unmodified-loop-condition
      while (rest && !(terminator && rest.startsWith(terminator))) {
        const token = this.parseToken(rest, stopReg)
        tokens.push(token)
        rest = token.rest
        term = token.terminator
        delete token.rest
      }
      if (rest.startsWith(terminator)) rest = rest.slice(1)
      source = source.slice(0, -(rest + term).length)
      rest = whitespace.unescape(rest)
      source = whitespace.unescape(source)
      return { tokens, rest, source }
    }

    stringify(argv: Argv) {
      const output = argv.tokens.reduce((prev, token) => {
        if (token.quoted) prev += leftQuotes[rightQuotes.indexOf(token.terminator[0])] || ''
        return prev + token.content + token.terminator
      }, '')
      if (argv.rest && !rightQuotes.includes(output[output.length - 1]) || argv.initiator) {
        return output.slice(0, -1)
      }
      return output
    }
  }

  const defaultTokenizer = new Tokenizer()

  export function parse(source: string, terminator = '') {
    return defaultTokenizer.parse(source, terminator)
  }

  export function stringify(argv: Argv) {
    return defaultTokenizer.stringify(argv)
  }

  export function revert(token: Token) {
    while (token.inters.length) {
      const { pos, source, initiator } = token.inters.pop()
      token.content = token.content.slice(0, pos)
        + initiator + source + bracs[initiator].terminator
        + token.content.slice(pos)
    }
  }
}
