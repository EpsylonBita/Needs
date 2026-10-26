import { afterEach, describe, expect, it, vi } from 'vitest';
import { WitService } from '@/lib/services/wit-service';

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

  it.each(['LG OLED 55 inch', 'iPhone 16 for sale', 'For sale 300', 'TV for $300', 'Was 500€, now 300€', '100-200€', 'From 300€', '20€/hour', '1.200€', 'Serial 123456789012'])('does not guess a price from %s', async text => {
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

  it('retains conservative amount handling for currencies, rates and ranges in expanded tags', async () => {
    for (const amount of ['120€ or $150', '120€/day', '100–120€', 'περίπου 120€', 'Was 150€, now 120€']) {
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
});
