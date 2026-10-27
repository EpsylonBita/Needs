import { safeRetailUrl } from '../merchant-verifier'

export type HtmlNode = { tag: string; attrs: Record<string, string>; content: number; end: number; parent: HtmlNode | null; closed: boolean }
export type HtmlDocument = { source: string; nodes: HtmlNode[] }
export const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
export const excluded = (value: string) => /\b(?:used|refurbished|renewed|outlet|open[ -]?box|b[ -]?stock|bulk|bundle|demo|second[ -]?hand)\b|μεταχειρισ|ανακατασκευ|εκθεσιακ/.test(normalize(value))

export function decode(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|euro);/gi, (_, entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()]
    const point = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  })
}

/** Bounded catalogue-only scanner: no scripts, browser execution or external resources. */
export function parseHtml(html: string): HtmlDocument | null {
  if (Buffer.byteLength(html, 'utf8') > 1024 * 1024) return null
  const source = html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
  const nodes: HtmlNode[] = [], stack: HtmlNode[] = []
  for (const match of source.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tag = match[1].toLowerCase(), raw = match[0]
    if (raw.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag)
      if (index >= 0) for (const node of stack.splice(index)) { node.end = match.index; node.closed = true }
      continue
    }
    if (nodes.length >= 25000 || stack.length >= 150) return null
    const attrs: Record<string, string> = {}
    for (const attr of raw.slice(match[1].length + 1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = attr[1].toLowerCase()
      if (!(key in attrs)) attrs[key] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    const content = match.index + raw.length
    const closed = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) || /\/\s*>$/.test(raw)
    const node: HtmlNode = { tag, attrs, content, end: content, parent: stack.at(-1) ?? null, closed }
    nodes.push(node)
    if (!closed) stack.push(node)
  }
  return { source, nodes }
}
export function inside(node: HtmlNode, parent: HtmlNode): boolean {
  for (let current = node.parent; current; current = current.parent) if (current === parent) return true
  return false
}
export function hasClass(node: HtmlNode, name: string): boolean { return node.attrs.class?.split(/\s+/).includes(name) ?? false }
export function text(doc: HtmlDocument, node: HtmlNode): string { return decode(doc.source.slice(node.content, node.end).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() }
export function ownUrl(value: string, origin: string, base = origin): string | null {
  try {
    const url = safeRetailUrl(new URL(value, base).href)
    return url && new URL(url).origin === origin && !excluded(url) ? url : null
  } catch { return null }
}
export function canonicalUrl(doc: HtmlDocument, url: string, origin: string): string | null {
  const nodes = doc.nodes.filter(node => node.tag === 'link' && node.attrs.rel === 'canonical')
  const canonical = nodes.length === 1 ? ownUrl(nodes[0].attrs.href ?? '', origin) : null
  return canonical && new URL(canonical).pathname === new URL(url).pathname ? canonical : null
}
export function visible(node: HtmlNode): boolean {
  for (let current: HtmlNode | null = node; current; current = current.parent) {
    if ('hidden' in current.attrs || current.attrs['aria-hidden'] === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(current.attrs.style ?? '') || hasClass(current, 'hidden')) return false
  }
  return true
}
export function priceAmount(value: string, locale: 'el' | 'en'): number | null {
  const plain = value.replace(/\s+/g, '')
  const pattern = locale === 'el' ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{2})?$/ : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/
  if (!pattern.test(plain)) return null
  const number = Number(locale === 'el' ? plain.replace(/\./g, '').replace(',', '.') : plain.replace(/,/g, ''))
  return Number.isFinite(number) && number > 0 && number <= 1000000 ? number : null
}
export const CONDITIONAL_PRICE_KEYS = ['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType']
