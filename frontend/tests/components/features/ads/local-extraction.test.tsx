import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateAdDialog } from '@/components/features/ads/create-ad-dialog';
import { CategoryTagsPicker } from '@/components/features/ads/category-tags-picker';

const boundary = vi.hoisted(() => ({ create: vi.fn(), fetch: vi.fn(), upload: vi.fn(), user: { id: 'auth-account', phoneNumber: '' } }));
vi.mock('@/hooks/use-map', () => ({ useMap: () => ({ map: null, initializeMap: vi.fn(), updateMarker: vi.fn() }) }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: boundary.user }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/lib/services/listing-service', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/services/listing-service')>(), createListing: boundary.create, deleteListing: vi.fn() }));
vi.mock('@/lib/services/storage-service', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/services/storage-service')>(), uploadListingImages: boundary.upload }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }));
vi.mock('@/components/ui/dialog', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return { Dialog: Container, DialogContent: Container, DialogDescription: Container, DialogHeader: Container, DialogTitle: Container };
});
vi.mock('next/image', () => ({ default: ({ fill: _fill, unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => React.createElement('img', props) }));

beforeEach(() => {
  vi.clearAllMocks();
  boundary.user = { id: 'auth-account', phoneNumber: '' };
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token');
  boundary.create.mockResolvedValue({ id: 'created-listing' });
  boundary.fetch.mockResolvedValue({ ok: true, json: async () => ({ features: [{ center: [13.4, 52.5] }] }) });
  vi.stubGlobal('fetch', boundary.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function openDetails() {
  render(<CreateAdDialog open onOpenChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
}
async function describeListing(text: string) {
  fireEvent.change(screen.getByLabelText('What would you like to list?'), { target: { value: text } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled());
}
function png(name = 'desk.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], name, { type: 'image/png' });
}

describe('reviewing an automatically extracted listing draft', () => {
  it('keeps tag changes separate from publishing', () => {
    const publish = vi.fn((event: React.FormEvent) => event.preventDefault());
    const toggle = vi.fn();
    render(<form onSubmit={publish}><CategoryTagsPicker selectedCategory="Items" selectedSubcategory="Sell" selectedTags={[]} analysis={{ tags: ['Electronics'], smartTags: ['lg'] }} isLoadingTags={false} onCategorySelect={vi.fn()} onSubcategorySelect={vi.fn()} onToggleTag={toggle} /></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Electronics' }));
    expect(toggle).toHaveBeenCalledWith('Electronics');
    expect(screen.getByRole('button', { name: 'lg' })).toHaveAttribute('type', 'button');
    expect(publish).not.toHaveBeenCalled();
  });

  it('prefills the account phone and restores it when an extracted phone is removed', async () => {
    boundary.user.phoneNumber = '+306991234567';
    openDetails();
    await describeListing('Selling a used bicycle for 120€');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('+306991234567');
    await describeListing('Selling a used bicycle for 120€. Phone: +306981234567');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('+306981234567');
    await describeListing('Selling a used bicycle for 120€');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('+306991234567');
  });

  it('preserves a deliberately cleared phone across analysis and profile refresh', async () => {
    boundary.user.phoneNumber = '+306991234567';
    const view = render(<CreateAdDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
    await describeListing('Selling a used bicycle for 120€');
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '' } });
    boundary.user = { id: 'auth-account', phoneNumber: '+306981234567' };
    view.rerender(<CreateAdDialog open onOpenChange={vi.fn()} />);
    await describeListing('Selling a used bicycle for 100€');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('');
  });

  it('fills a late-loading profile phone without erasing a manual replacement', async () => {
    const view = render(<CreateAdDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
    await describeListing('Selling a used bicycle for 120€');
    boundary.user = { id: 'auth-account', phoneNumber: '+306991234567' };
    view.rerender(<CreateAdDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Phone (optional)')).toHaveValue('+306991234567'));
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '+306981234567' } });
    await describeListing('Selling a used bicycle for 100€');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('+306981234567');
  });

  it('keeps the price tag in sync with manual corrections and removes invalid prices', async () => {
    openDetails();
    await describeListing('Selling a used Samsung TV for 300€');
    expect(screen.getByRole('button', { name: '300€' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '300€' }));
    fireEvent.click(screen.getByRole('button', { name: '300€' }));
    fireEvent.change(screen.getByLabelText('Price (€)'), { target: { value: '250,50' } });
    expect(await screen.findByRole('button', { name: '250.5€' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '300€' })).not.toBeInTheDocument();
    await describeListing('Selling a used Samsung TV for 400€');
    expect(screen.getByRole('button', { name: '250.5€' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '400€' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Price (€)'), { target: { value: 'invalid' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: '250.5€' })).not.toBeInTheDocument());
  });

  it('starts with optional photos and preserves details on a round trip', async () => {
    render(<CreateAdDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Show what you want to list')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'What would you like to list?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish listing' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
    await describeListing('Selling a Samsung TV for 300€');
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    expect(screen.getByText('Show what you want to list')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
    expect(screen.getByLabelText('What would you like to list?')).toHaveValue('Selling a Samsung TV for 300€');
    expect(screen.getByLabelText('Price (€)')).toHaveValue('300€');
    expect(boundary.create).not.toHaveBeenCalled();
  });

  it('skips optional photos without submitting or showing errors on the untouched details form', async () => {
    render(<CreateAdDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip photos' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish listing' })).toBeEnabled());
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('What would you like to list?')).toHaveFocus();
    expect(boundary.create).not.toHaveBeenCalled();
  });

  it('fills from one description without an extraction button and leaves unknown price or direction empty', async () => {
    openDetails();
    await describeListing('LG TV');
    expect(screen.queryByRole('button', { name: /Extract details/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/with AI|from AI|Wit.ai/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('LG TV');
    expect(screen.getByLabelText('Price (€)')).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('Items');
    expect(screen.getByLabelText('Listing type')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'lg' })).toHaveAttribute('aria-pressed', 'true');
    expect(boundary.create).not.toHaveBeenCalled();
  });

  it('clears old inferred values when the description becomes ambiguous', async () => {
    openDetails();
    await describeListing('Selling a Samsung TV for 300€');
    expect(screen.getByLabelText('Price (€)')).toHaveValue('300€');
    expect(screen.getByLabelText('Listing type')).toHaveValue('Sell');
    await describeListing('Samsung TV');
    expect(screen.getByLabelText('Price (€)')).toHaveValue('');
    expect(screen.getByLabelText('Listing type')).toHaveValue('');
    await describeListing('Something interesting');
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(boundary.create).not.toHaveBeenCalled();
  });

  it('keeps manual corrections and tag exclusions while later descriptions update suggestions', async () => {
    openDetails();
    await describeListing('Selling a Samsung TV for 300€');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My edited title' } });
    fireEvent.change(screen.getByLabelText('Price (€)'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Listing type'), { target: { value: 'Buy' } });
    fireEvent.click(screen.getByRole('button', { name: 'samsung' }));
    fireEvent.click(screen.getByText('Edit tags'));
    expect(screen.getByLabelText('Your own tag')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Your own tag'), { target: { value: 'wall-mounted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await describeListing('Selling a new Samsung TV for 400€');
    expect(screen.getByLabelText('Title')).toHaveValue('My edited title');
    expect(screen.getByLabelText('Price (€)')).toHaveValue('250');
    expect(screen.getByLabelText('Listing type')).toHaveValue('Buy');
    expect(screen.getByRole('button', { name: 'samsung' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'wall-mounted' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish listing' }));
    await waitFor(() => expect(boundary.create).toHaveBeenCalled());
    const saved = boundary.create.mock.calls[0][0];
    expect(saved.tags).toEqual(expect.arrayContaining(['tv', 'wall-mounted']));
    expect(saved.tags).not.toContain('samsung');
  });

  it('preserves Greek request direction and allows publishing without a public phone number', async () => {
    openDetails();
    await describeListing('Ζητάω υδραυλικό');
    expect(screen.getByLabelText('Category')).toHaveValue('Services');
    expect(screen.getByLabelText('Listing type')).toHaveValue('I want');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ζητάω υδραυλικό αύριο' } });
    fireEvent.change(screen.getByLabelText('Price (€)'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Athens' } });
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('');
    expect(boundary.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Publish listing' }));
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ζητάω υδραυλικό αύριο', price: '75', main_category: 'Services', sub_category: 'I want', contact_number: '' })));
  });

  it('keeps the matching category when a manually chosen listing type precedes a different inferred category', async () => {
    openDetails();
    await describeListing('Selling a Samsung TV for 300€');
    fireEvent.change(screen.getByLabelText('Listing type'), { target: { value: 'Buy' } });
    await describeListing('I need a plumber to repair a leaking pipe');
    expect(screen.getByLabelText('Category')).toHaveValue('Items');
    expect(screen.getByLabelText('Listing type')).toHaveValue('Buy');
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish listing' }));
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ main_category: 'Items', sub_category: 'Buy' })));
  });

  it.each(['75', 'not-a-price'])('sets an inferred giveaway price to zero after the user entered %s', async price => {
    openDetails();
    await describeListing('Selling a wooden desk for 50€');
    fireEvent.change(screen.getByLabelText('Price (€)'), { target: { value: price } });
    await describeListing('Giving away a wooden desk in good condition');
    expect(screen.getByLabelText('Listing type')).toHaveValue('Free');
    expect(screen.getByLabelText('Price (€)')).toHaveValue('0');
    expect(screen.getByLabelText('Price (€)')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish listing' }));
    await waitFor(() => expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ sub_category: 'Free', price: '0' })));
  });

  it('rejects invalid image content and a selection exceeding six photos before publishing', async () => {
    render(<CreateAdDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Photos from device'), { target: { files: [new File(['not a png'], 'bad.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose valid JPG, PNG, WebP or GIF');
    expect(screen.queryByAltText('Listing photo 1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Photos from device'), { target: { files: Array.from({ length: 7 }, (_, i) => png(`${i}.png`)) } });
    expect(screen.getByRole('alert')).toHaveTextContent('You can add up to 6 photos');
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.upload).not.toHaveBeenCalled();
  });

  it('retains selected photo order across steps and uploads only after publishing', async () => {
    render(<CreateAdDialog open onOpenChange={vi.fn()} />);
    const photos = [png('first.png'), png('second.png')];
    fireEvent.change(screen.getByLabelText('Photos from device'), { target: { files: photos } });
    await screen.findByAltText('Listing photo 2');
    expect(boundary.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await describeListing('Selling a wooden desk for 50€');
    fireEvent.click(screen.getByRole('button', { name: 'Photos (2)' }));
    expect(screen.getByAltText('Listing photo 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish listing' }));
    await waitFor(() => expect(boundary.upload).toHaveBeenCalledWith('created-listing', photos));
  });
});
