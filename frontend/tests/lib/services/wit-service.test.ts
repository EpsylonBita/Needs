import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractListingPrice, hasListingPriceRate, WitService } from '@/lib/services/wit-service';

const parser = new WitService('');
afterEach(() => vi.unstubAllGlobals());

describe('local listing text extraction', () => {
  it.each([
    ['LG TV', 'LG TV'], ['Samsung TV', 'Samsung TV'],
    ['I need a developer', 'Developer'], ['Ζητάω τηλεόραση LG', 'LG τηλεόραση'],
  ])('does not invent specifications or a price for %s', async (text, title) => {
    const result = await parser.analyzeText(text);
    expect(result.title).toBe(title);
    expect(result.description).toBe(text);
    expect(result.price).toBeUndefined();
    expect(result.smartTags.join(' ')).not.toMatch(/60|oled/i);
  });

  it.each([
    ['Ζητάω τηλεόραση LG', 'Items', 'Buy'],
    ['Ψάχνω ποδήλατο', 'Items', 'Buy'],
    ['Πουλάω Samsung TV 55 inch για 300€', 'Items', 'Sell'],
    ['Χαρίζω έναν καναπέ', 'Items', 'Free'],
    ['Δωρεάν καρέκλα', 'Items', 'Free'],
    ['Ζητάω υδραυλικό', 'Services', 'I want'],
    ['Θέλω developer για το λογότυπό μου', 'Services', 'I want'],
    ['Προσφέρω μαθήματα αγγλικών', 'Services', 'I will'],
    ['Μπορώ να επισκευάσω υπολογιστές', 'Services', 'I can'],
    ['Θα καθαρίσω το σπίτι σας', 'Services', 'I will'],
    ['Looking for an iPhone', 'Items', 'Buy'],
    ['Selling an LG TV', 'Items', 'Sell'],
    ['Giving away a chair', 'Items', 'Free'],
    ['I want a free chair', 'Items', 'Buy'],
    ['I need a developer for a logo', 'Services', 'I want'],
    ['I offer plumbing services', 'Services', 'I will'],
    ['I can repair computers', 'Services', 'I can'],
    ['I will clean your house', 'Services', 'I will'],
    ['Offering free tutoring', 'Services', 'I will'],
    ['Selling a TV with free delivery', 'Items', 'Sell'],
    ['I want a laptop for design', 'Items', 'Buy'],
  ])('maps the explicit intent in %s', async (text, category, subcategory) => {
    expect(await parser.analyzeText(text)).toMatchObject({ category, subcategory });
  });

  it.each(['LG TV', 'developer', 'Προσφέρω τηλεόραση', 'TV with free delivery', 'I buy and sell phones', 'Δεν πουλάω τηλεόραση', 'I am not selling this TV', 'Something interesting'])('leaves ambiguous or negated intent for the user: %s', async text => {
    expect((await parser.analyzeText(text)).subcategory).toBeUndefined();
  });

  it.each([
    ['Selling a TV for 300€', '300€'],
    ['Πουλάω τραπέζι για 35,50 ευρώ', '35.5€'],
    ['Price: EUR 50.25', '50.25€'],
    ['LG OLED 55 inch, €1200', '1200€'],
  ])('extracts a single explicit EUR amount from %s', async (text, price) => {
    expect((await parser.analyzeText(text)).price).toBe(price);
  });

  it.each(['LG OLED 55 inch', 'iPhone 16 for sale', 'For sale 300', 'TV for $300', '100-200€', 'From 300€', '20€/week', '1.200€', 'Serial 123456789012'])('does not guess a price from %s', async text => {
    const result = await parser.analyzeText(text);
    expect(result.price).toBeUndefined();
    expect(result.smartTags.some(tag => /[€$£]/u.test(tag))).toBe(false);
  });

  it('keeps explicit model/size text without adding related models', async () => {
    const text = 'Selling LG OLED C3 55 inch for 500€';
    const result = await parser.analyzeText(text);
    expect(result.title).toBe('LG OLED C3 55 inch');
    expect(result.smartTags).toContain('lg');
    expect(result.smartTags).toContain('oled');
    expect(result.smartTags).not.toContain('qned');
    expect(result.title).not.toContain('60');
  });

  it('does not mistake substrings or serial numbers for facts', async () => {
    const result = await parser.analyzeText('Appleton renewed tabletop serial 123456789012');
    expect(result.smartTags).not.toContain('apple');
    expect(result.smartTags).not.toContain('table');
    expect(result.condition).not.toBe('new');
    expect(result.contactNumber).toBeUndefined();
  });

  it('extracts only a unique explicit contact number and labeled location', async () => {
    expect(await parser.analyzeText('Phone: +30 691 234 5678\nLocation: Athens')).toMatchObject({ contactNumber: '+306912345678', location: 'Athens' });
    expect((await parser.analyzeText('Call 6912345678 or 6998765432')).contactNumber).toBeUndefined();
  });

  it('does not require a token or make network requests', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await new WitService('').analyzeText('Ζητάω υδραυλικό');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['Πωλώ μεταχειρισμένο ποδήλατο σε καλή κατάσταση, 120€.', 'Μεταχειρισμένο ποδήλατο'],
    ['Πουλάω ένα μεταχειρισμένο ποδήλατο για 120€', 'Μεταχειρισμένο ποδήλατο'],
    ['Selling a used bicycle in good condition for 120€', 'Used bicycle'],
    ['Selling a brand new iPhone 16 for 500€', 'Brand new iPhone 16'],
    ['Πωλώ μεταχειρισμένη τηλεόραση Samsung 55 inch σε καλή κατάσταση για 300€', 'Samsung μεταχειρισμένη 55 inch'],
    ['Selling a used Trek Marlin 7 bicycle with new tyres for 120€', 'Trek used Marlin 7'],
    ['Πωλώ ποδήλατο μάρκας Trek, είναι μεταχειρισμένο, τιμή 120€', 'Trek μεταχειρισμένο'],
    ['Πωλώ μεταχειρισμένο ποδήλατο Trek σε καλή κατάσταση για 120€', 'Trek μεταχειρισμένο'],
    ['Selling a used bicycle. Phone: +30 6912345678', 'Used bicycle'],
  ])('builds a concise subject title from %s', async (text, title) => {
    expect((await parser.analyzeText(text)).title).toBe(title);
  });

  it('adds only the stated brand, condition, object, category and parsed price to tags', async () => {
    const result = await parser.analyzeText('Πωλώ μεταχειρισμένο ποδήλατο Trek Marlin 7 σε καλή κατάσταση, 120€');
    expect(result).toMatchObject({ title: 'Trek μεταχειρισμένο Marlin 7', brand: 'Trek', condition: 'used', price: '120€', tags: ['Items'] });
    expect(result.smartTags).toEqual(expect.arrayContaining(['ποδηλατο', 'trek', 'μεταχειρισμένο', '120€']));
    for (const absent of ['new', 'giant', 'mountain bike']) expect(result.smartTags).not.toContain(absent);
  });

  it('uses the subject condition rather than the condition of included accessories', async () => {
    const result = await parser.analyzeText('Selling a used Trek Marlin 7 bicycle with new tyres for 120€');
    expect(result).toMatchObject({ title: 'Trek used Marlin 7', condition: 'used' });
    expect(result.smartTags).toContain('used');
    expect(result.smartTags).not.toContain('new');
    expect((await parser.analyzeText('Selling a used bicycle\nCondition: new')).condition).toBeUndefined();
  });

  it('recognizes a short explicitly labeled unknown brand without guessing brands from arbitrary words', async () => {
    const result = await parser.analyzeText('Πωλώ μεταχειρισμένο ποδήλατο για 120€\nΜάρκα: CustomCycle');
    expect(result.brand).toBe('CustomCycle');
    expect(result.title).toBe('CustomCycle μεταχειρισμένο');
    expect(result.smartTags).toContain('customcycle');
    expect((await parser.analyzeText('Selling a used Fjord bicycle')).brand).toBeUndefined();
    expect((await parser.analyzeText('Selling a giant sofa')).brand).toBeUndefined();
  });

  it('does not treat contact details, URLs, addresses or serial numbers as brands or tags', async () => {
    const result = await parser.analyzeText('Selling a used bicycle for 120€\nEmail: samsung@παράδειγμα.gr\nPhone: +30 6912345678\nLocation: Apple Valley\nWebsite: sony.example\nSerial: 987654321012');
    expect(result.title).toBe('Used bicycle');
    expect(result.brand).toBeUndefined();
    expect(result.smartTags).toEqual(expect.arrayContaining(['bicycle', 'used', '120€']));
    expect(result.smartTags.join(' ')).not.toMatch(/samsung|apple|sony|6912345678|987654321012|example|valley/iu);
    expect(result.location).toBe('Apple Valley');
  });

  it.each(['Selling a used Samsung TV, not new', 'Δεν πουλάω καινούργιο ποδήλατο Trek'])('does not promote negated details into tags or condition for %s', async text => {
    const result = await parser.analyzeText(text);
    expect(result.brand).toBeUndefined();
    expect(result.condition).toBeUndefined();
    expect(result.tags).toEqual([]);
    expect(result.smartTags).toEqual([]);
  });

  it.each(['Brand: +30 6912345678', 'Brand: someone@example.com', 'Brand: https://example.com', 'Brand: This is a paragraph about an unknown product'])('rejects unsafe or non-brand labeled text: %s', async brandLine => {
    const result = await parser.analyzeText(`Selling a used bicycle for 120€\n${brandLine}`);
    expect(result.brand).toBeUndefined();
  });

  it('retains conservative amount handling for currencies, unsupported rates and ranges in expanded tags', async () => {
    for (const amount of ['120€ or $150', '120€/week', '100–120€', 'περίπου 120€', 'Was 150€, now 120€ or 90€']) {
      const result = await parser.analyzeText(`Selling a used bicycle for ${amount}`);
      expect(result.price).toBeUndefined();
      expect(result.smartTags).toContain('used');
      expect(result.smartTags.some(tag => tag.includes('€'))).toBe(false);
    }
  });

  it.each(['Ideal', 'Orient', 'Fidusa'])('recognizes an explicitly named Greek bicycle brand: %s', async brand => {
    const result = await parser.analyzeText(`Πωλώ μεταχειρισμένο ποδήλατο ${brand} σε καλή κατάσταση, 120€`);
    expect(result.brand).toBe(brand);
    expect(result.title).toBe(`${brand} μεταχειρισμένο`);
    expect(result.smartTags).toContain(brand.toLowerCase());
  });

  it('does not turn the adjective ideal into a brand', async () => {
    expect((await parser.analyzeText('Selling a used bicycle, ideal for commuting')).brand).toBeUndefined();
  });

  it('recognizes the exact discounted-phone screenshot without changing the description', async () => {
    const text = 'πωλειται κινητο smasung s25 ultra ελαχειστα χρησιμοποιημενοαπο 220 στα 130';
    const result = await parser.analyzeText(text);
    expect(result).toMatchObject({ description: text, title: 'Samsung μεταχειρισμένο s25 ultra', brand: 'Samsung', condition: 'used', category: 'Items', subcategory: 'Sell', price: '130€' });
    expect(result.priceUnit).toBeUndefined();
    expect(result.smartTags).toEqual(expect.arrayContaining(['samsung', 'μεταχειρισμένο', '130€']));
    expect(result.title).not.toMatch(/220|130|smasung|ελαχειστα/iu);
    expect(result.smartTags).not.toContain('220€');
  });

  it('recognizes the exact home-care screenshot and keeps the hourly meaning', async () => {
    const text = 'μπορω να αναλαβω ηλικιωμενους κατοικον με 10 ευρω την ωρα';
    const result = await parser.analyzeText(text);
    expect(result).toMatchObject({ description: text, title: 'Φροντίδα ηλικιωμένων κατ’ οίκον', category: 'Services', subcategory: 'I can', price: '10€', priceUnit: 'hour' });
    expect(result.smartTags).toEqual(expect.arrayContaining(['φροντίδα ηλικιωμένων', 'κατ’ οίκον', '10€']));
  });

  it.each([
    ['Πωλείται Samsung S25 Ultra, από 220€ στα 130€', '130€'],
    ['Πωλώ κινητό από 220 στα 130 ευρώ', '130€'],
    ['Was 500€, now 300€', '300€'],
    ['Selling a bicycle, was 150 now 120', '120€'],
    ['Πωλείται καρέκλα από 20,50 στα 15,25', '15.25€'],
  ])('extracts only the final amount of an explicit discount: %s', async (text, price) => {
    expect(await parser.analyzeText(text)).toMatchObject({ price });
  });

  it.each([
    ['20€/hour', '20€', 'hour'], ['I offer tutoring for 12.50 euros per hour', '12.5€', 'hour'],
    ['Προσφέρω φροντίδα ηλικιωμένων με 10 ευρώ την ώρα', '10€', 'hour'],
    ['Προσφέρω καθαρισμό με 30€ την ημέρα', '30€', 'day'], ['120€/day', '120€', 'day'],
    ['Φροντίδα ηλικιωμένων 900 ευρώ το μήνα', '900€', 'month'], ['900 EUR/month', '900€', 'month'],
  ])('returns the explicit EUR rate and its unit: %s', async (text, price, priceUnit) => {
    expect(await parser.analyzeText(text)).toMatchObject({ price, priceUnit });
  });

  it.each([
    ['Αναλαμβάνω φροντίδα ηλικιωμένων κατ οίκον', 'I will'],
    ['Μπορώ να αναλάβω ηλικιωμένους κατ’ οίκον', 'I can'],
    ['Ζητάω φροντίδα ηλικιωμένων στο σπίτι', 'I want'],
    ['Χρειάζομαι κάποιον να αναλάβει ηλικιωμένους', 'I want'],
    ['Προσφέρω κατ οίκον φροντίδα ηλικιωμένων', 'I will'],
  ])('classifies explicit elderly-care intent: %s', async (text, subcategory) => {
    expect(await parser.analyzeText(text)).toMatchObject({ category: 'Services', subcategory });
  });

  it.each([
    'Samsung S25 Ultra 220 130', 'Πωλείται κινητό 130', 'Phone: +30 6912345678',
    'Samsung S25 από 130 στα 220', 'Selling a phone from 100 to 200€',
    'Πωλείται κινητό από 220 στα 130, καρέκλα 50€', 'Was 500€, now 300€, or 250€',
    'TV was 500 now 300 and bicycle was 200 now 100', 'Πωλώ κινητό από 6998765432 στα 6912345678',
    'Πωλείται κινητό από 1.200 στα 900', '20€ την εβδομάδα', '10–20€ την ώρα',
    '20€/hour or 100€/day', '20$ per hour', '20€ per minute',
    '10€ έως 20', '10€–20', 'από 10€ την ώρα', '10€ ανά εβδομάδα', '10€/hour/day',
    'Πωλείται κινητό από 220€ στα 130–150', 'Was 220€ now 130 or 150', 'περίπου από 220€ στα 130',
  ])('keeps ambiguous prices, ranges, contacts and unsupported units unset: %s', async text => {
    const result = await parser.analyzeText(text);
    expect(result.price).toBeUndefined();
    expect(result.priceUnit).toBeUndefined();
  });

  it('does not expand a controlled typo alias inside unrelated words or conflicting brands', async () => {
    expect((await parser.analyzeText('Selling a used Smasungton phone')).brand).toBeUndefined();
    expect((await parser.analyzeText('Selling a used smasung or Sony phone')).brand).toBeUndefined();
    expect((await parser.analyzeText('Selling a used samsong phone')).brand).toBeUndefined();
  });

  it('keeps negated and mixed care intents ambiguous', async () => {
    for (const text of ['Δεν μπορώ να αναλάβω ηλικιωμένους', 'Ζητάω και προσφέρω φροντίδα ηλικιωμένων']) {
      expect((await parser.analyzeText(text)).subcategory).toBeUndefined();
    }
    expect((await parser.analyzeText('Πωλώ βιβλίο για φροντίδα ηλικιωμένων')).subcategory).not.toBe('I will');
    expect(await parser.analyzeText('Πωλείται κινητό για ηλικιωμένους')).toMatchObject({ category: 'Items', subcategory: 'Sell' });
  });

  it('keeps rate detection independent of ambiguous amounts for payment guards', () => {
    expect(extractListingPrice('10€/ώρα ή 20€/ημέρα')).toEqual({});
    expect(hasListingPriceRate('10€/ώρα ή 20€/ημέρα')).toBe(true);
    expect(extractListingPrice('10€/week')).toEqual({});
    expect(hasListingPriceRate('10€/week')).toBe(true);
    expect(hasListingPriceRate('Προσφέρω φροντίδα 10€ για 2 ώρες')).toBe(false);
    expect(extractListingPrice('Προσφέρω φροντίδα 10€ για 2 ώρες')).toEqual({ price: '10€' });
    expect(extractListingPrice(' ')).toEqual({});
  });

  it.each(['από 20€ στα 10 την ώρα', 'was €20 now 10 per hour'])('keeps the payment guard consistent when only the old discount amount has a currency: %s', text => {
    expect(extractListingPrice(text)).toEqual({ price: '10€', priceUnit: 'hour' });
    expect(hasListingPriceRate(text)).toBe(true);
  });

  it.each(['από 20€ στα 10 την εβδομάδα', 'was €20 now 10 per week', 'was 20 now 10 per hour'])('blocks unsupported or currency-ambiguous discount rates from fixed-total checkout: %s', text => {
    expect(extractListingPrice(text)).toEqual({});
    expect(hasListingPriceRate(text)).toBe(true);
  });

  it('preserves original spacing, accents and typos while recognizing condition inflections', async () => {
    const text = '  Πωλείται  τηλεόραση smasung  ελάχιστα  χρησιμοποιημένη, 120€  ';
    const result = await parser.analyzeText(text);
    expect(result.description).toBe(text);
    expect(result).toMatchObject({ brand: 'Samsung', condition: 'used', title: 'Samsung μεταχειρισμένη', price: '120€' });
  });

  it('recognizes home care with double spaces without rewriting the source', async () => {
    const text = 'μπορω να αναλαβω  ηλικιωμενους κατ  οικον με 10 ευρω την ωρα';
    expect(await parser.analyzeText(text)).toMatchObject({ description: text, title: 'Φροντίδα ηλικιωμένων κατ’ οίκον', category: 'Services', subcategory: 'I can', price: '10€', priceUnit: 'hour' });
  });

  it('does not mistake Greek prose articles after a price for rate units', () => {
    const text = 'Πωλώ κινητό για 130 ευρώ το κινητό είναι σε καλή κατάσταση';
    expect(extractListingPrice(text)).toEqual({ price: '130€' });
    expect(hasListingPriceRate(text)).toBe(false);
    expect(extractListingPrice('Πωλώ καρέκλα 20€ την αγόρασα πρόσφατα')).toEqual({ price: '20€' });
    expect(hasListingPriceRate('20€ την εβδομάδα')).toBe(true);
  });

  it('adds English care tags only for a positive service description', async () => {
    const result = await parser.analyzeText('I can care for elderly people at home for 10€/hour');
    expect(result).toMatchObject({ category: 'Services', subcategory: 'I can', title: 'Elderly care at home' });
    expect(result.smartTags).toEqual(expect.arrayContaining(['elderly care', 'at home']));
    expect((await parser.analyzeText('Δεν μπορώ να αναλάβω ηλικιωμένους κατοικον')).smartTags).toEqual([]);
    expect((await parser.analyzeText('Πωλείται κινητό για ηλικιωμένους στο σπίτι')).smartTags).not.toContain('φροντίδα ηλικιωμένων');
  });
});
