import { z } from 'zod';

// Kept for callers that validate stored Wit response payloads.
const witEntitySchema = z.object({
  confidence: z.number(),
  value: z.string(),
  type: z.string(),
});
const witResponseSchema = z.object({
  text: z.string(),
  intents: z.array(z.object({ name: z.string(), confidence: z.number() })),
  entities: z.record(z.string(), z.array(witEntitySchema)),
});
export type WitResponse = z.infer<typeof witResponseSchema>;
export function parseWitResponse(payload: unknown): WitResponse {
  return witResponseSchema.parse(payload);
}

export type ListingPriceUnit = 'hour' | 'day' | 'month';
export interface ParsedWitResponse {
  title?: string;
  description?: string;
  category?: 'Items' | 'Services';
  subcategory?: 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can';
  price?: string;
  priceUnit?: ListingPriceUnit;
  condition?: string;
  brand?: string;
  location?: string;
  tags: string[];
  smartTags: string[];
  contactNumber?: string;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Controlled corrections apply only to recognition; the stored description is untouched. */
function recognitionSource(text: string): string {
  return text.normalize('NFC')
    .replace(/[^\S\r\n]+/gu, ' ')
    .replace(/(^|[^\p{L}\p{N}])smasung(?=$|[^\p{L}\p{N}])/giu, '$1Samsung')
    .replace(/(^|[^\p{L}\p{N}])ελαχειστα(?=$|[^\p{L}\p{N}])/giu, '$1ελάχιστα')
    .replace(/(^|[^\p{L}\p{N}])(χρησιμοποιημ[εέ]ν(?:ο|η|α|ος|ους|ες))(?=απ[όο]\s+\d)/giu, '$1$2 ');
}

// Unicode boundaries are necessary for Greek words; \b only covers Latin letters.
function mentions(text: string, phrase: string): boolean {
  const escaped = normalize(phrase).replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}])' + escaped + '(?=$|[^\\p{L}\\p{N}])', 'u').test(text);
}
function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some(phrase => mentions(text, phrase));
}

const ITEM_TERMS = [
  'tv', 'television', 'phone', 'phones', 'iphone', 'laptop', 'computer', 'computers', 'tablet', 'camera',
  'chair', 'table', 'desk', 'sofa', 'bed', 'bike', 'bicycle', 'car', 'shoes', 'jacket', 'book', 'guitar',
  'τηλεόραση', 'τηλεόρασης', 'τηλεοράσεις', 'κινητό', 'υπολογιστή', 'υπολογιστές', 'ποδήλατο',
  'καρέκλα', 'τραπέζι', 'καναπέ', 'καναπές', 'κρεβάτι', 'αυτοκίνητο', 'βιβλίο',
] as const;
const SERVICE_TERMS = [
  'service', 'services', 'developer', 'programmer', 'designer', 'plumber', 'plumbing', 'electrician',
  'gardener', 'tutor', 'tutoring', 'lessons', 'teacher', 'consultant', 'consulting', 'photography', 'cleaning',
  'logo design', 'web development', 'cleaning service',
  'υπηρεσία', 'υπηρεσίες', 'υδραυλικό', 'υδραυλικός', 'ηλεκτρολόγο', 'ηλεκτρολόγος',
  'προγραμματιστή', 'προγραμματιστής', 'μαθήματα', 'καθηγητή', 'καθηγητής', 'καθαρισμό', 'καθαρισμός',
] as const;
const SERVICE_ACTIONS = [
  'repair', 'clean', 'teach', 'design', 'build a website', 'επισκευάσω', 'επισκευάζω',
  'καθαρίσω', 'καθαρίζω', 'διδάξω', 'διδάσκω', 'σχεδιάσω', 'φτιάξω ιστοσελίδα',
] as const;

function isElderlyCare(input: string): boolean {
  return hasAny(input, ['ηλικιωμένους', 'ηλικιωμένων', 'ηλικιωμένο', 'ηλικιωμένη', 'ηλικιωμένοι', 'ηλικιωμένες', 'elderly', 'seniors'])
    && hasAny(input, ['φροντίδα', 'φροντίζω', 'φροντίσω', 'φροντιστή', 'φροντίστρια', 'αναλάβω', 'αναλάβει', 'αναλαμβάνω', 'care', 'caregiver']);
}
function isHomeCare(input: string): boolean {
  return hasAny(input, ['κατοικον', 'κατ οίκον', 'κατ’ οίκον', "κατ' οίκον", 'στο σπίτι', 'at home', 'home care']);
}
const SMART_TAG_TERMS = [
  ...ITEM_TERMS, ...SERVICE_TERMS,
  'lg', 'samsung', 'sony', 'apple', 'xiaomi', 'huawei', 'lenovo', 'dell', 'asus', 'macbook',
  'oled', 'qled', 'qned', 'galaxy', 'playstation', 'xbox', 'nintendo', 'logo', 'website',
] as const;

const BRANDS = [
  'LG', 'Samsung', 'Sony', 'Apple', 'Xiaomi', 'Huawei', 'Lenovo', 'Dell', 'Asus', 'Acer', 'HP',
  'Trek', 'Giant', 'Scott', 'Specialized', 'Cube', 'Cannondale', 'Bianchi', 'Merida', 'KTM', 'Ideal', 'Orient', 'Fidusa',
  'IKEA', 'Bosch', 'Siemens', 'Miele', 'Whirlpool', 'Philips', 'DeWalt', 'Makita',
  'Toyota', 'Honda', 'BMW', 'Mercedes', 'Volkswagen', 'Ford', 'Nissan',
  'Nike', 'Adidas', 'Puma', 'Reebok', 'Canon', 'Nikon', 'Fujifilm', 'Panasonic', 'Nintendo',
] as const;

const CONDITIONS = [
  ['new', ['brand new', 'new', 'unopened', 'καινούργιο', 'καινούργια', 'καινούρια', 'καινούριο', 'αχρησιμοποίητο', 'αχρησιμοποίητη']],
  ['used', ['second hand', 'second-hand', 'used', 'μεταχειρισμένο', 'μεταχειρισμένη', 'μεταχειρισμένα', 'μεταχειρισμένες', 'μεταχειρισμένος', 'μεταχειρισμένους',
    'ελάχιστα χρησιμοποιημένο', 'ελάχιστα χρησιμοποιημένη', 'ελάχιστα χρησιμοποιημένα', 'ελάχιστα χρησιμοποιημένος',
    'λίγο χρησιμοποιημένο', 'λίγο χρησιμοποιημένη', 'χρησιμοποιημένο', 'χρησιμοποιημένη', 'χρησιμοποιημένα', 'χρησιμοποιημένος', 'χρησιμοποιημένες']],
  ['refurbished', ['refurbished', 'reconditioned', 'ανακατασκευασμένο', 'ανακατασκευασμένη']],
  ['damaged', ['damaged', 'broken', 'χαλασμένο', 'χαλασμένη']],
] as const;

function escapeRegex(text: string): string { return text.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'); }

/** Source spans let us keep the user's spelling and model numbers in display titles. */
function firstMention(text: string, phrase: string): { index: number; text: string } | undefined {
  const match = new RegExp('(^|[^\\p{L}\\p{N}])(' + escapeRegex(normalize(phrase)) + ')(?=$|[^\\p{L}\\p{N}])', 'u').exec(normalize(text));
  if (!match) return;
  const index = match.index + match[1].length;
  return { index, text: text.slice(index, index + match[2].length) };
}

function extractBrand(text: string): string | undefined {
  const labeled = [...text.matchAll(/(?:^|\n|[,;])\s*(?:brand|μάρκα|μαρκα)\s*:\s*([^\n,;]+)/giu)]
    .map(match => match[1].trim());
  // Only accept short letter-led brand names, never contact details or a prose paragraph.
  const validLabel = labeled.length === 1 && /^[\p{L}][\p{L}\p{N}&' -]{0,39}$/u.test(labeled[0])
    && labeled[0].split(/\s+/u).length <= 3 ? labeled[0] : undefined;
  if (labeled.length > 1) return;
  const brands = BRANDS.filter(brand => {
    const mention = firstMention(text, brand);
    // Common words are not brand evidence unless written as a name or labeled below.
    return mention && (!['Giant', 'Cube', 'Apple', 'Ideal', 'Orient'].includes(brand) || mention.text === brand || normalize(validLabel ?? '') === normalize(brand));
  });
  if (validLabel) {
    const canonical = BRANDS.find(brand => normalize(brand) === normalize(validLabel));
    if (brands.some(brand => normalize(brand) !== normalize(validLabel))) return;
    return canonical ?? validLabel;
  }
  return brands.length === 1 ? brands[0] : undefined;
}

function conciseTitle(text: string, brand?: string, conditionPhrase?: string, conditionLabel = conditionPhrase): string | undefined {
  let title = text.trim().split(/\r?\n/u)[0];
  const leadingIntent = /^(?:(?:i am |i'm )?selling|for sale|sell|giving away|give away|looking to buy|looking for|i want|i need|i offer|offering|i provide|providing|i can|i will|ζηταω|ζητω|αναζητω|ψαχνω|χρειαζομαι|θελω|αγοραζω|πωλω|πουλω|πουλαω|πωλειται|πωλουνται|χαριζω|χαριζεται|προσφερω|παρεχω|αναλαμβανω|μπορω να|θα)(?=\s|[:;,])\s*[:;,]?\s*/u;
  const lead = leadingIntent.exec(normalize(title));
  if (lead) title = title.slice(lead[0].length);
  // A title describes the subject. Transaction terms, addresses, contacts, prices and
  // additional prose remain intact in the description instead of becoming title text.
  const stops = [
    /[,;\n]|\.(?=\s|$)/u,
    /(?:^|\s)(?:for|with|in|at|was|now|phone|tel|call|location|price|για|με|σε|στην|στο|απο|τηλεφωνο|τηλ|καλεστε|περιοχη|τοποθεσια|τιμη)\s*[:\s]/u,
    /(?:^|\s)(?:brand|μαρκα)\s*:/u,
    /(?:€|eur(?:os?)?|ευρω|[$£])\s*\d|\d[\d.,]*(?:\s*[-–]\s*\d[\d.,]*)?\s*(?:€|eur(?:os?)?|ευρω|[$£])/u,
    /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.\w+|\+?\d[\d ()-]{8,}\d/u,
  ];
  const positions = stops.map(pattern => pattern.exec(normalize(title))?.index).filter((index): index is number => index !== undefined);
  if (positions.length) title = title.slice(0, Math.min(...positions));
  if (brand) {
    const match = firstMention(title, brand);
    if (match) title = title.slice(0, match.index) + title.slice(match.index + match.text.length);
    title = title.replace(/(?:μάρκας|μαρκας|brand)\s*:?/giu, '');
  }
  if (conditionPhrase) {
    const match = firstMention(title, conditionPhrase);
    if (match) title = title.slice(0, match.index) + title.slice(match.index + match.text.length);
  }
  const article = /^(?:a|an|the|my|this|ενα|εναν|μια|μιαν|το|την|τη|τον|τις|τα|τους)\s+/u.exec(normalize(title.trim()));
  title = title.trim();
  if (article) title = title.slice(article[0].length);
  if (brand && conditionPhrase) {
    // Brand + condition already identifies the listing. Retain stated model/size
    // details, but don't repeat the generic object name or filler adjectives.
    const generic = [...ITEM_TERMS, 'item', 'product', 'αντικείμενο', 'προϊόν', 'wooden', 'red', 'blue', 'black', 'white', 'large', 'small', 'κόκκινο', 'μαύρο', 'λευκό', 'ξύλινο', 'μεγάλο', 'μικρό'];
    for (const phrase of generic.sort((a, b) => b.length - a.length)) {
      let mention = firstMention(title, phrase);
      while (mention) {
        title = title.slice(0, mention.index) + ' ' + title.slice(mention.index + mention.text.length);
        mention = firstMention(title, phrase);
      }
    }
    title = title.replace(/\s+/gu, ' ').trim();
    if (!/\d/u.test(title) && !hasAny(normalize(title), ['oled', 'qled', 'qned', 'galaxy', 'macbook', 'playstation', 'xbox'])) title = '';
  }
  title = [brand, conditionLabel?.toLocaleLowerCase(), title].filter(Boolean).join(' ').replace(/\s+/gu, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/gu, '');
  if (!title) return;
  if (title.length > 100) title = title.slice(0, 100).replace(/\s+\S*$/u, '');
  // Preserve intentional casing such as iPhone and model codes.
  const firstWord = title.split(' ')[0];
  return firstWord === firstWord.toLocaleLowerCase() ? title[0].toLocaleUpperCase() + title.slice(1) : title;
}

function extractIntent(input: string, price?: string): Pick<ParsedWitResponse, 'category' | 'subcategory'> {
  const request = hasAny(input, ['buy', 'buying', 'i want', 'i need', 'looking for', 'looking to buy',
    'seeking', 'wanted', 'ζητάω', 'ζητώ', 'αναζητώ', 'ψάχνω', 'χρειάζομαι', 'θέλω', 'αγοράζω']);
  const sell = hasAny(input, ['sell', 'selling', 'for sale', 'πωλώ', 'πουλώ', 'πουλάω', 'πωλείται', 'πωλούνται']);
  const offer = hasAny(input, ['i offer', 'offering', 'i provide', 'providing', 'προσφέρω', 'παρέχω', 'αναλαμβάνω']);
  const can = hasAny(input, ['i can', 'μπορώ']);
  const will = hasAny(input, ['i will', 'θα']);
  const giveaway = hasAny(input, ['giving away', 'give away', 'free to collect', 'χαρίζω', 'χαρίζεται']);
  const free = /^(?:free|δωρεαν)(?=\s|[!:.])/u.test(input)
    || /(?:^|\s)(?:for free|δωρεαν)\s*[.!]?$/u.test(input);

  const serviceAction = ['i can', 'i will', 'i offer to', 'i need someone to', 'looking for someone to',
    'μπορώ να', 'θα', 'αναλαμβάνω να', 'θέλω να μου', 'χρειάζομαι κάποιον να']
    .some(prefix => SERVICE_ACTIONS.some(action => mentions(input, prefix + ' ' + action)));
  const service = hasAny(input, SERVICE_TERMS) || (!sell && (serviceAction || isElderlyCare(input)));
  const item = hasAny(input, ITEM_TERMS) || sell || giveaway;
  const category = service ? 'Services' : item ? 'Items' : undefined;
  if (!category) return {};
  // Mixed or negated statements cannot safely establish a transaction direction.
  if (hasAny(input, ['not', "don't", 'do not', 'δεν', 'μην'])
    || (request && (sell || offer || can || giveaway))) return { category };

  if (category === 'Services') {
    if (sell || giveaway || (can && will) || (request && will)) return { category };
    if (request) return { category, subcategory: 'I want' };
    if (can) return { category, subcategory: 'I can' };
    if (will || offer) return { category, subcategory: 'I will' };
  } else {
    if ((sell && (giveaway || free)) || (can && !sell)) return { category };
    if (request) return { category, subcategory: 'Buy' };
    if (giveaway || free) return { category, subcategory: 'Free' };
    if (sell || (offer && price)) return { category, subcategory: 'Sell' };
  }
  return { category };
}

const EURO = '(?:€|eur(?:os?)?|ευρω)';
const AMOUNT = '\\d+(?:[.,]\\d+)?';
function euroMatches(input: string) {
  return [...input.matchAll(new RegExp(`${EURO}\\s*(\\d[\\d.,]*)|(\\d[\\d.,]*)\\s*${EURO}`, 'gu'))];
}
function discountMatches(input: string) {
  return [...input.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?<kind>απο|was)\\s+(?:${EURO}\\s*)?(?<old>${AMOUNT})\\s*(?:${EURO})?\\s*[,;]?\\s+(?<join>στα|now)\\s+(?:${EURO}\\s*)?(?<final>${AMOUNT})(?:\\s*${EURO})?(?![\\p{L}\\p{N}]|[.,]\\d)`, 'gu'))];
}
function rangeSuffix(after: string): boolean {
  return /^\s*(?:[-–—]|(?:to|εως|μεχρι|or|η)(?=\s|$))\s*\d/u.test(after);
}
function numericAmount(amount: string): number | undefined {
  // Grouping separators and >2 decimal places stay unset for manual review.
  if (!/^\d+(?:[.,]\d{1,2})?$/u.test(amount)) return;
  const value = Number(amount.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 && value <= 9999999999.99 ? value : undefined;
}
function rateSuffix(after: string): { hasRate: boolean; unit?: ListingPriceUnit } {
  const prefix = /^\s*(?:\/\s*|per\s+|ανα\s+|τη(?:ν)?\s+|το(?:ν)?\s+)/u.exec(after);
  if (!prefix) return { hasRate: false };
  const rest = after.slice(prefix[0].length);
  // Greek articles can start ordinary prose ("130 ευρώ το κινητό είναι...").
  // Treat them as rate markers only before a known time/count basis.
  if (/^\s*(?:τη(?:ν)?|το(?:ν)?)\s/u.test(prefix[0])
    && !/^(?:hours?|hrs?|h|ωρα|ωρες|days?|d|ημερα|μερα|months?|mo|μηνα|μηνες|εβδομαδα|βδομαδα|λεπτο|δευτερολεπτο|ετος|χρονο|κιλο|τετραγωνικο|τεμαχιο|ατομο)(?=$|[^\p{L}\p{N}])/u.test(rest)) return { hasRate: false };
  const units: [ListingPriceUnit, RegExp][] = [
    ['hour', /^(?:hours?|hrs?|h|ωρα|ωρες)(?=$|[^\p{L}\p{N}])/u],
    ['day', /^(?:days?|d|ημερα|μερα)(?=$|[^\p{L}\p{N}])/u],
    ['month', /^(?:months?|mo|μηνα)(?=$|[^\p{L}\p{N}])/u],
  ];
  for (const [unit, pattern] of units) {
    const match = pattern.exec(rest);
    if (match && !/^\s*(?:\/|per\s|ανα\s)/u.test(rest.slice(match[0].length))) return { hasRate: true, unit };
  }
  return { hasRate: true };
}

/** Payment guards must detect rate wording even when several amounts make extraction ambiguous. */
export function hasListingPriceRate(text: string): boolean {
  const input = normalize(recognitionSource(text));
  return [...euroMatches(input), ...discountMatches(input)]
    .some(match => rateSuffix(input.slice((match.index ?? 0) + match[0].length)).hasRate);
}

/** A numeric EUR price plus its explicit basis. Never silently turn a rate into a total. */
export function extractListingPrice(text: string): Pick<ParsedWitResponse, 'price' | 'priceUnit'> {
  const input = normalize(recognitionSource(text));
  if (/[$£]/u.test(input) || hasAny(input, ['usd', 'gbp', 'dollars', 'pounds'])) return {};
  const matches = euroMatches(input);
  const discounts = discountMatches(input);
  if (discounts.length) {
    if (discounts.length !== 1) return {};
    const discount = discounts[0];
    const { kind, join, old, final } = discount.groups!;
    if ((kind === 'απο') !== (join === 'στα')) return {};
    const start = discount.index ?? 0;
    const end = start + discount[0].length;
    if (matches.some(match => (match.index ?? 0) < start || (match.index ?? 0) + match[0].length > end)) return {};
    if (/(?:about|roughly|περιπου|εως|μεχρι)\s*$/u.test(input.slice(0, start)) || rangeSuffix(input.slice(end))) return {};
    const oldValue = numericAmount(old), value = numericAmount(final);
    // Bare discount amounts must be short enough not to be contact/serial numbers.
    if (oldValue === undefined || value === undefined || value >= oldValue || (!matches.length && (oldValue >= 10000000 || value >= 10000000))) return {};
    const rate = rateSuffix(input.slice(end));
    if (rate.hasRate && (!rate.unit || !matches.length)) return {};
    return { price: `${value}€`, ...(rate.unit ? { priceUnit: rate.unit } : {}) };
  }
  if (matches.length !== 1) return {};
  const match = matches[0];
  const before = input.slice(0, match.index).trimEnd();
  const after = input.slice((match.index ?? 0) + match[0].length);
  if (/(?:\d[.,]?|[+\-–—])$/u.test(before) || /^[\p{L}\p{N}]/u.test(after)
    || /(?:from|up to|starting at|απο|εως|μεχρι|under|over|about|περιπου)\s*$/u.test(before)
    || /(?:from|between|απο|μεταξυ)\s+\d[\d.,]*\s+(?:to|and|εως|μεχρι|και|στα)\s*$/u.test(before)
    || rangeSuffix(after)) return {};
  const value = numericAmount(match[1] || match[2]);
  const rate = rateSuffix(after);
  if (value === undefined || (rate.hasRate && !rate.unit)) return {};
  return { price: `${value}€`, ...(rate.unit ? { priceUnit: rate.unit } : {}) };
}

function extractContact(text: string): string | undefined {
  const input = normalize(text);
  const numbers = [...input.matchAll(/(?:phone|tel(?:ephone)?|call|τηλεφωνο|τηλ|καλεστε)\s*:?\s*(\+?\d[\d ()-]{8,}\d)|(\+\d[\d ()-]{8,}\d)/gu)]
    .map(match => (match[1] || match[2]).replace(/[^\d+]/g, ''))
    .filter(number => /^\+?\d{10,15}$/.test(number));
  // Multiple numbers anywhere in the text are ambiguous, even when only one is labeled.
  const candidates = [...input.matchAll(/\+?\d[\d ()-]{8,}\d/gu)];
  return numbers.length === 1 && candidates.length === 1 ? numbers[0] : undefined;
}

/**
 * Compatibility name for a local, deterministic parser. No Wit API or token is used.
 * Missing/ambiguous facts stay unset; users review and edit the draft before publishing.
 */
export class WitService {
  constructor(_legacyAccessToken?: string) {}

  async analyzeText(text: string): Promise<ParsedWitResponse> {
    const result: ParsedWitResponse = { tags: [], smartTags: [], description: text };
    const source = recognitionSource(text);
    if (!source.trim()) return result;
    const facts = source
      .replace(/https?:\/\/\S+|www\.\S+|[^\s@]+@[^\s@]+\.[^\s@]+/giu, ' ')
      .replace(/(?:phone|tel(?:ephone)?|call|τηλέφωνο|τηλεφωνο|τηλ|καλέστε|καλεστε)\s*:?\s*\+?\d[\d ()-]{6,}/giu, ' ')
      .replace(/(?:^|\n)\s*(?:location|περιοχή|περιοχη|τοποθεσία|τοποθεσια|website|email|e-mail|url|ιστοσελίδα)\s*:[^\n]*/giu, ' ');
    const input = normalize(facts);
    let conditionPhrase: string | undefined;
    let conditionLabel: string | undefined;
    Object.assign(result, extractListingPrice(text));
    Object.assign(result, extractIntent(input, result.price));
    const elderlyCare = result.category === 'Services' && isElderlyCare(input);
    const homeCare = elderlyCare && isHomeCare(input);
    const greek = /[\u0370-\u03ff]/u.test(input);
    const careTag = greek ? 'φροντίδα ηλικιωμένων' : 'elderly care';
    const homeTag = greek ? 'κατ’ οίκον' : 'at home';
    if (!hasAny(input, ['not', "don't", 'no', 'never', 'δεν', 'μην'])) {
      const subject = conciseTitle(facts) ?? '';
      const conditionLabels = [...facts.matchAll(/(?:^|\n)\s*(?:condition|κατάσταση|κατασταση)\s*:\s*([^\n]+)/giu)].map(match => match[1]);
      const primaryConditionText = [subject, ...conditionLabels].join('\n');
      const primaryConditions = CONDITIONS.filter(([, words]) => hasAny(normalize(primaryConditionText), words));
      // "Used bicycle with new tyres" describes a used bicycle. Prefer the subject
      // and explicit condition fields over accessory details in later prose.
      const detected = primaryConditions.length ? primaryConditions : CONDITIONS.filter(([, words]) => hasAny(input, words));
      if (detected.length === 1) {
        result.condition = detected[0][0];
        conditionPhrase = detected[0][1].map(phrase => firstMention(primaryConditions.length ? primaryConditionText : facts, phrase)?.text).find(Boolean);
        const usedEnding = conditionPhrase && /χρησιμοποιημεν(ο|η|α|ος|ες|ους)$/u.exec(normalize(conditionPhrase))?.[1];
        conditionLabel = usedEnding ? ({ ο: 'μεταχειρισμένο', η: 'μεταχειρισμένη', α: 'μεταχειρισμένα', ος: 'μεταχειρισμένος', ες: 'μεταχειρισμένες', ους: 'μεταχειρισμένους' } as Record<string, string>)[usedEnding] : conditionPhrase;
      }
      result.brand = extractBrand(facts);
      const conditionTag = conditionLabel && /[\u0370-\u03ff]/u.test(conditionLabel) ? conditionLabel.toLocaleLowerCase() : result.condition;
      result.tags = result.category ? [result.category] : [];
      result.smartTags = [...new Set([
        ...SMART_TAG_TERMS.filter(term => mentions(input, term)).map(normalize),
        ...(result.brand ? [normalize(result.brand)] : []),
        ...(conditionTag ? [conditionTag] : []),
        ...(elderlyCare ? [careTag] : []),
        ...(homeCare ? [homeTag] : []),
        ...(result.price ? [result.price] : []),
      ])];
    }
    result.title = conciseTitle(source, result.brand, conditionPhrase, conditionLabel);
    if (elderlyCare) {
      result.title = greek ? `Φροντίδα ηλικιωμένων${homeCare ? ' κατ’ οίκον' : ''}` : `Elderly care${homeCare ? ' at home' : ''}`;
    }
    result.contactNumber = extractContact(text);
    const locations = [...text.matchAll(/(?:^|\n)\s*(?:location|περιοχή|τοποθεσία)\s*:\s*([^\n]+)/giu)];
    if (locations.length === 1) result.location = locations[0][1].trim();
    return result;
  }
}

export const witService = new WitService();
