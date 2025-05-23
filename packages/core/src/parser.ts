export interface Token {
  content: string
  quote?: [string, string]
}

export interface ParserResult {
  tokens: Token[]
}

const leftQuotes = `"'“‘`
const rightQuotes = `"'”’`

export class Parser {
  parseToken(source: string): [Token, string] {
    const quoteIndex = leftQuotes.indexOf(source[0])
    const rightQuote = rightQuotes[quoteIndex]
    const stopReg = new RegExp(rightQuote ? `${rightQuote}([\s]+|$)|$` : `[\s]+|$`)
    const capture = stopReg.exec(source)!
    const content = source.slice(0, capture.index)
    source = source.slice(capture.index + capture[0].length)
    const token: Token = {
      content,
      quote: rightQuote
        ? [source[0], capture[0] === rightQuote ? rightQuote : '']
        : undefined,
    }
    return [token, source]
  }

  parse(source: string): ParserResult {
    const tokens: Token[] = []
    let token: Token
    while (source) {
      ;[token, source] = this.parseToken(source)
      tokens.push(token)
    }
    return { tokens }
  }
}
