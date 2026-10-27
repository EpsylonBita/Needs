import { getListingPriceUnit, listingRequiresAgreedTotal } from '@/lib/listings/price-display'
import type { ComparableListing, PriceGuidance, PriceRange, PricingSubject } from './types'

export type ProductIdentity = {
  query: string
  model: string
  tokens: string[]
  variantTokens: string[]
  condition: 'new' | 'like_new' | 'used' | 'for_parts' | 'unknown'
}

const MIN_SELLERS = 5
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const words = (value: string) => normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
const demonstration = (value: string) => /\b(?:test|testing|demo|demonstration|fixture|sample|dummy)\b|δοκιμαστικ|επιδειξης/u.test(words(value))
function accessory(value: string): boolean {
  // Bare tools explicitly exclude batteries/chargers; this is not a charger listing.
  const text = words(value).replace(/(?:\bwithout\b|\bno\b|χωρις)\s+(?:μπαταρι\p{L}*|φορτιστ\p{L}*|batter(?:y|ies)|charger)(?:\s+(?:και|and|or)\s+(?:μπαταρι\p{L}*|φορτιστ\p{L}*|batter(?:y|ies)|charger)){0,2}/gu, '')
  const targets = [...PRODUCT_BRANDS, 'iphone', 'galaxy', 'pixel', 'macbook', 'playstation', 'xbox'].join('|')
  const compatibleTarget = new RegExp(`(?:^|\\s)(?:for|για)\\s+(?:${targets})(?:\\s|$)`, 'u')
  return compatibleTarget.test(normalizeProductBrand(text))
    || /\b(?:accessor(?:y|ies)|case|cover|charger|cable|protector|replacement|battery|bundle|kit|pack|compatible|replica)\b|\bset of\b|θηκ[ηε]|φορτιστ|καλωδι|ανταλλακτικο|προστατευτικ|απομιμησ|πακετο|(?:^|\s)σετ(?:$|\s)/u.test(text)
}

/** Shared brand spelling for listing identity and merchant Product.brand evidence. */
export function normalizeProductBrand(value: string): string {
  return words(brandAliases(value))
}
function brandAliases(value: string): string {
  return normalize(value).replace(/\btp[ -]?link\b/g, 'tplink').replace(/\bd[ -]?link\b/g, 'dlink')
    .replace(/\bde[ -]?walt\b/g, 'dewalt').replace(/\bwestern[ -]?digital\b/g, 'westerndigital')
}

const PRODUCT_BRANDS = [
  'samsung', 'sony', 'lg', 'xiaomi', 'huawei', 'lenovo', 'dell', 'asus', 'acer', 'hp', 'msi',
  'canon', 'nikon', 'fujifilm', 'panasonic', 'olympus', 'om', 'gopro', 'dji', 'sigma', 'tamron',
  'bosch', 'siemens', 'miele', 'philips', 'tefal', 'delonghi', 'kenwood', 'braun', 'rowenta', 'dyson', 'karcher',
  'makita', 'dewalt', 'einhell', 'metabo', 'hikoki', 'ryobi', 'stanley', 'blackdecker',
  'yamaha', 'roland', 'korg', 'casio', 'fender', 'ibanez', 'cort', 'epiphone', 'behringer', 'presonus',
  'trek', 'bose', 'sennheiser', 'jbl', 'marshall', 'akg', 'shure', 'rode', 'edifier',
  'logitech', 'razer', 'steelseries', 'corsair', 'hyperx', 'benq', 'aoc', 'epson', 'brother',
  'kingston', 'crucial', 'sandisk', 'westerndigital', 'seagate', 'transcend', 'adata', 'tplink', 'dlink', 'ubiquiti', 'netgear',
]

function conditionOf(value: string): ProductIdentity['condition'] {
  let text = words(value)
  if (/\b(?:not|never|isnt|isn t)\b.{0,18}\b(?:new|used|working)\b|δεν.{0,20}(?:καινουργ|χρησιμοποι|λειτουργ)|refurbished|reconditioned|ανακατασκευασ/u.test(text)) return 'unknown'
  const conditions = new Set<ProductIdentity['condition']>()
  if (/\b(?:like new|as new)\b|σαν καινουργ|σαν καινουρι/u.test(text)) {
    conditions.add('like_new')
    text = text.replace(/\b(?:like new|as new)\b|σαν καινουργ\p{L}*|σαν καινουρι\p{L}*/gu, '')
  }
  if (/\b(?:new|unused|sealed|unopened)\b|καινουργ|καινουρι|αχρησιμοποιητ|σφραγισμεν/u.test(text)) conditions.add('new')
  if (/\b(?:used|second hand|preowned|pre owned)\b|μεταχειρισμεν|χρησιμοποιημεν/u.test(text)) conditions.add('used')
  if (/\b(?:for parts|broken|damaged|non working)\b|για ανταλλακτικα|χαλασμεν/u.test(text)) conditions.add('for_parts')
  // Like-new and damaged describe more specific used conditions, not new stock.
  if (conditions.has('used') && (conditions.has('like_new') || conditions.has('for_parts'))) conditions.delete('used')
  return conditions.size === 1 ? [...conditions][0] : 'unknown'
}

function productText(value: string): string {
  return brandAliases(value)
    // Keep model suffixes such as HD9252/70. They identify a different SKU from /90.
    .replace(/\s*\/\s*/g, '/')
    .replace(/\b(?:pcie|pci-e|usb|bluetooth)\s*\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/(\d+(?:[.,]\d+)?)\s*(gb|tb|mb|ιντσες|inch(?:es)?)\b/gu, (_, size: string, unit: string) => `${size.replace(/[.,]/g, 'p')}${unit.startsWith('inch') || unit === 'ιντσες' ? 'inch' : unit}`)
    .replace(/\b([a-z]{1,5})-(?=\d)/g, '$1')
    .replace(/(\d+(?:p\d+)?(?:gb|tb|mb))\/(?=\d)/g, '$1 ')
    .replace(/\b(canon\s+(?:eos\s+)?r\d+)\s+c\b/g, '$1c')
    .replace(/\b(g502)\s+x\b/g, '$1x')
    .replace(/\b(iphone|pixel|galaxy)(?=\d|s\d|a\d)/g, '$1 ')
    .replace(/(\d)(pro|max|ultra|plus|mini|fe|se)\b/g, '$1 $2')
    .replace(/\+/g, ' plus ')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim().replace(/\s+/g, ' ')
}

function modelOf(text: string): string | null {
  const models = new Set<string>()
  for (const match of text.matchAll(/\biphone\s+(\d{1,2})\b/g)) models.add(`iphone ${match[1]}`)
  for (const match of text.matchAll(/\b(?:samsung(?: galaxy)?|galaxy)\s+(s\d{1,2}|a\d{2}|note\s*\d{1,2})\b/g)) models.add(`samsung ${match[1].replace(/\s/g, '')}`)
  for (const match of text.matchAll(/\bpixel\s+(\d{1,2}a?)\b/g)) models.add(`pixel ${match[1]}`)
  for (const match of text.matchAll(/\bmacbook\s+(air|pro)\s+(m\d{1,2})\b/g)) models.add(`macbook ${match[1]} ${match[2]}`)
  if (/\b(?:playstation\s*5|ps5)\b/.test(text)) models.add('playstation 5')
  for (const match of text.matchAll(/\bxbox\s+series\s+([xs])\b/g)) models.add(`xbox series ${match[1]}`)
  for (const match of text.matchAll(/\blogitech\s+mx\s+(master|anywhere)\s+(\d+s?)\b/g)) models.add(`logitech mx ${match[1]} ${match[2]}`)
  for (const match of text.matchAll(/\btplink\s+archer\s+(a[xce]?\d+[a-z]?)\b/g)) models.add(`tplink archer ${match[1]}`)
  // Unknown brands and generic product names intentionally have no estimate.
  const tokens = text.split(' ')
  const presentBrands = PRODUCT_BRANDS.filter(brand => tokens.includes(brand))
  const codes = tokens.filter(token => token.length <= 35 && /^(?=[a-z\d/]*[a-z])(?=[a-z\d/]*\d)[a-z\d]+(?:\/[a-z\d]+)?$/.test(token)
    && !/^(?:\d+p?\d*(?:gb|tb|mb|inch|dpi|hz|khz|mhz|ghz|w|kw|v|mah|ah|mm|cm|kg|mp|mbps|gbps|rpm|keys?)|[45]g|wifi\d|g?ddr\d|sata\d)$/.test(token)
    && !(presentBrands.includes('tplink') && /^a[xce]\d{4,5}$/.test(token)))
  const unique = [...new Set(codes)]
  if (models.size) {
    if (models.size !== 1) return null
    const model = [...models][0]
    const modelTokens = model.split(' ')
    const familyBrands: Record<string, string> = { iphone: 'apple', macbook: 'apple', pixel: 'google', playstation: 'sony', xbox: 'microsoft' }
    const familyBrand = familyBrands[modelTokens[0]] ?? modelTokens[0]
    const modelCodes = new Set([...modelTokens, ...(model === 'playstation 5' ? ['ps5'] : [])])
    // A known family must not hide a second branded product in the same listing.
    if (presentBrands.some(brand => brand !== familyBrand)
      || (presentBrands.length > 0 && unique.some(code => !modelCodes.has(code)))) return null
    return model
  }
  if (presentBrands.length !== 1) return null
  return unique.length === 1 ? `${presentBrands[0]} ${unique[0]}` : null
}

function variantsOf(text: string): string[] {
  const tokens = text.split(' ')
  const variants = tokens.filter(token => /^(?:\d+(?:p\d+)?(?:gb|tb|mb|inch)|20\d{2}|pro|max|ultra|plus|mini|fe|se|lite|edge|slim|digital|disc|4g|5g|lte|wifi|cellular|midnight|starlight|natural|desert)$/.test(token))
  const colors: [string, RegExp][] = [
    ['black', /\bblack\b|μαυρ[οηα]/u], ['white', /\bwhite\b|λευκ[οηα]|ασπρ[οηα]/u], ['blue', /\bblue\b|(?:^|\s)μπλε(?:$|\s)/u],
    ['green', /\bgreen\b|πρασιν[οηα]/u], ['red', /\bred\b|κοκκιν[οηα]/u], ['purple', /\bpurple\b|μωβ|μοβ/u],
    ['pink', /\bpink\b|ροζ/u], ['silver', /\bsilver\b|ασημι/u], ['gold', /\bgold\b|χρυσ[οη]/u],
    ['gray', /\b(?:gray|grey)\b|γκρι/u], ['yellow', /\byellow\b|κιτριν[οηα]/u], ['orange', /\borange\b|πορτοκαλι/u],
    ['titanium', /\btitanium\b|τιτανι/u], ['space', /\bspace\s+(?:gray|grey|black)\b/u],
  ]
  for (const [color, pattern] of colors) if (pattern.test(text)) variants.push(color)
  for (const color of ['mint', 'navy', 'graphite', 'lavender', 'cream', 'beige', 'teal']) if (tokens.includes(color)) variants.push(color)
  if (/\bm\s*2\b/.test(text)) for (const size of ['2230', '2242', '2260', '2280', '22110']) if (tokens.includes(size)) variants.push(`m2-${size}`)
  if (/\bg502x?\b/.test(text)) for (const edition of ['hero', 'lightspeed']) if (tokens.includes(edition)) variants.push(edition)
  if (/\b(?:korg|roland|yamaha|casio)\b/.test(text)) {
    for (const match of text.matchAll(/\b(?:pa\d+x\s+)?(61|76|88)\s*(?:keys?|πληκτρα)\b|\bpa\d+x\s+(61|76|88)\b/g)) variants.push(`keys${match[1] ?? match[2]}`)
  }
  if (/\blogitech\s+mx\b/.test(text)) {
    if (/\bfor mac\b/.test(text)) variants.push('mac-edition')
    if (/\bbusiness\b/.test(text)) variants.push('business-edition')
  }
  const roman: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }
  for (const match of text.matchAll(/\b(?:mark|mk)\s*(\d{1,2}|viii|vii|vi|iv|iii|ii|ix|i|v|x)\b/g)) variants.push(`mark${roman[match[1]] || match[1]}`)
  // Camera retailers often shorten "Mark II" to just "II".
  for (const match of text.matchAll(/\b(ii|iii|iv|v|vi|vii|viii|ix)\b/g)) variants.push(`mark${roman[match[1]]}`)
  if (/\bdual\s*sim\b/.test(text)) variants.push('dual-sim')
  if (/\bsingle\s*sim\b/.test(text)) variants.push('single-sim')
  if (/\be\s*sim\b/.test(text)) variants.push('esim')
  return [...new Set(variants)].sort()
}

export function getProductIdentity(subject: PricingSubject): ProductIdentity | null {
  if (subject.mainCategory !== 'Items' || subject.subCategory !== 'Sell') return null
  const source = `${subject.title} ${subject.description}`
  if (demonstration(source) || accessory(source)) return null
  const text = productText(source)
  const model = modelOf(text)
  if (!model) return null
  const variantTokens = variantsOf(text)
  const tokens = model.split(' ')
  return { model, tokens, variantTokens, query: [...tokens, ...variantTokens].join(' '), condition: conditionOf(source) }
}

/** Retail new-condition evidence is checked by the provider, independently of listing condition. */
export function matchesProduct(identity: ProductIdentity, title: string): boolean {
  const candidate = getProductIdentity({ title, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })
  return !!candidate && candidate.model === identity.model && candidate.variantTokens.join('|') === identity.variantTokens.join('|')
}

function percentile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
}

function withoutOutliers(prices: number[]): number[] {
  const sorted = prices.filter(price => Number.isFinite(price) && price > 0).sort((a, b) => a - b)
  if (sorted.length < 4) return sorted
  const q1 = percentile(sorted, 0.25), q3 = percentile(sorted, 0.75)
  const fence = (q3 - q1) * 1.5
  return sorted.filter(price => price >= q1 - fence && price <= q3 + fence)
}

export function priceRange(prices: number[]): PriceRange | null {
  return rangeOfSorted(withoutOutliers(prices))
}

function rangeOfSorted(sorted: number[]): PriceRange | null {
  if (!sorted.length) return null
  const cents = (value: number) => Math.round(value * 100) / 100
  return { low: cents(sorted[0]), high: cents(sorted[sorted.length - 1]), median: cents(percentile(sorted, 0.5)) }
}

const amount = '(?:\\d+(?:[.,]\\d{1,2})?)'
const currency = '(?:€|eur(?:os?)?|ευρω)'
const priceExpression = () => new RegExp(`(?:${currency}\\s*${amount}|${amount}\\s*${currency})(?![\\p{L}\\p{N}])`, 'gu')
const hourPhrase = /(?:\/\s*|(?:^|[^\p{L}\p{N}])(?:per|ανα|την?)\s+)(?:hour(?:s)?|hr|h|ωρα)(?=$|[^\p{L}\p{N}])/gu
const dayPhrase = /(?:\/\s*|(?:^|[^\p{L}\p{N}])(?:per|ανα|την?)\s+)(?:day(?:s)?|ημερα|μερα)(?=$|[^\p{L}\p{N}])/gu
const monthPhrase = /(?:\/\s*|(?:^|[^\p{L}\p{N}])(?:per|ανα|τον?)\s+)(?:month(?:s)?|μηνα)(?=$|[^\p{L}\p{N}])/gu
const fixedPhrase = /\b(?:fixed price|fixed total|flat fee|per job|for the job)\b|σταθερη τιμη|συνολικη τιμη|κατ αποκοπη/gu

function serviceIdentity(subject: PricingSubject): { title: string; scope: string; unit: PriceGuidance['unit'] } | null {
  if (subject.mainCategory !== 'Services' || !['I will', 'I can'].includes(subject.subCategory) || !validPoint(subject.coordinates)) return null
  const source = normalize(subject.description)
  if (demonstration(`${subject.title} ${source}`)) return null
  const units = new Set<PriceGuidance['unit']>()
  const extracted = getListingPriceUnit(subject.description)
  if (extracted) units.add(extracted)
  if ([...source.matchAll(hourPhrase)].length) units.add('hour')
  if ([...source.matchAll(dayPhrase)].length) units.add('day')
  if ([...source.matchAll(monthPhrase)].length) units.add('month')
  if ([...source.matchAll(fixedPhrase)].length) units.add('job')
  if (units.size !== 1 || (listingRequiresAgreedTotal(subject.description) && !extracted && units.has('job'))) return null
  // Multiple charges can hide travel/material fees; do not erase them into a false match.
  const prices = [...source.matchAll(priceExpression())]
  if (prices.length > 1 || /[$£]|\b(?:usd|gbp)\b/u.test(source)) return null
  const scope = words(source.replace(priceExpression(), '').replace(hourPhrase, '').replace(dayPhrase, '').replace(monthPhrase, '').replace(fixedPhrase, '').replace(/\bprice\s*:?|τιμη\s*:/gu, ''))
  if (scope.split(' ').length < 3 || scope.length < 15 || words(subject.title).length < 5) return null
  return { title: words(subject.title), scope, unit: [...units][0] }
}

function validPoint(point: PricingSubject['coordinates']): point is [number, number] {
  return !!point && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
}

function withinArea(first: [number, number], second: [number, number]): boolean {
  const rad = Math.PI / 180
  const latitude = (second[1] - first[1]) * rad, longitude = (second[0] - first[0]) * rad
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(first[1] * rad) * Math.cos(second[1] * rad) * Math.sin(longitude / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <= 25
}

export function buildGuidance(subject: PricingSubject, candidates: ComparableListing[]): PriceGuidance {
  const neutral = (reason: PriceGuidance['reason'], unit: PriceGuidance['unit'] = subject.mainCategory === 'Items' ? 'item' : 'job', sampleSize = 0): PriceGuidance => ({
    status: 'insufficient_data', range: null, sampleSize, basis: null, unit, retailRange: null, reason,
  })
  if (subject.subCategory === 'Buy' || subject.subCategory === 'I want' || subject.subCategory === 'Free' || demonstration(`${subject.title} ${subject.description}`)) return neutral('unsupported')
  const product = subject.mainCategory === 'Items' ? getProductIdentity(subject) : null
  const service = subject.mainCategory === 'Services' ? serviceIdentity(subject) : null
  if (subject.mainCategory === 'Items' ? !product || product.condition === 'unknown' : !service) return neutral('missing_details', service?.unit)
  const unit = service?.unit ?? 'item'
  const seen = new Set<string>(), sellers = new Map<string, number[]>()
  for (const candidate of candidates) {
    if (!candidate.id || seen.has(candidate.id) || !candidate.sellerId || !Number.isFinite(candidate.price) || candidate.price <= 0 || demonstration(`${candidate.title} ${candidate.description}`)) continue
    seen.add(candidate.id)
    if (candidate.mainCategory !== subject.mainCategory || ['Buy', 'I want', 'Free'].includes(candidate.subCategory)) continue
    if (product) {
      const identity = getProductIdentity(candidate)
      if (!identity || identity.condition !== product.condition || identity.model !== product.model || identity.variantTokens.join('|') !== product.variantTokens.join('|')) continue
    } else if (service) {
      const identity = serviceIdentity(candidate)
      if (!identity || identity.title !== service.title || identity.scope !== service.scope || identity.unit !== service.unit
        || !validPoint(candidate.coordinates) || !withinArea(subject.coordinates!, candidate.coordinates)) continue
    }
    const prices = sellers.get(candidate.sellerId) ?? []
    prices.push(candidate.price)
    sellers.set(candidate.sellerId, prices)
  }
  // One seller gets one vote, regardless of how many matching listings they publish.
  const prices = withoutOutliers([...sellers.values()].map(values => percentile([...values].sort((a, b) => a - b), 0.5)))
  if (prices.length < MIN_SELLERS) return neutral('not_enough_comparables', unit, prices.length)
  return { status: 'ready', range: rangeOfSorted(prices), sampleSize: prices.length, basis: 'needs_asking', unit, retailRange: null }
}
