import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageUploader } from '@/components/features/ads/image-uploader';

const language = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => language }));
vi.mock('next/image', () => ({ default: ({ fill: _fill, unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => React.createElement('img', props) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); language.locale = 'en'; });

describe('photo-first image picker', () => {
  it('offers a keyboard-operated rear-camera capture and a separate multi-photo gallery', async () => {
    const user = userEvent.setup();
    const publish = vi.fn((event: React.FormEvent) => event.preventDefault());
    const change = vi.fn();
    render(<form onSubmit={publish}><ImageUploader imagePreviews={[]} onRemove={vi.fn()} onChange={change} /></form>);
    const camera = screen.getByLabelText('Camera photo');
    const gallery = screen.getByLabelText('Photos from device');
    const openCamera = vi.spyOn(camera, 'click');
    const openGallery = vi.spyOn(gallery, 'click');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(openCamera).toHaveBeenCalledOnce();
    await user.tab();
    await user.keyboard(' ');
    expect(openGallery).toHaveBeenCalledOnce();
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(camera).not.toHaveAttribute('multiple');
    expect(gallery).toHaveAttribute('multiple');
    expect(gallery).not.toHaveAttribute('capture');
    expect(gallery).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
    const photo = new File(['image'], 'photo.png', { type: 'image/png' });
    fireEvent.change(gallery, { target: { files: [photo] } });
    expect(change).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByText(/drop/i)).not.toBeInTheDocument();
  });

  it('shows the cover and directly accessible remove controls for every photo', () => {
    const remove = vi.fn();
    render(<ImageUploader imagePreviews={['blob:first', 'blob:second']} onRemove={remove} onChange={vi.fn()} />);
    expect(screen.getByText('Cover photo')).toBeVisible();
    expect(screen.getByAltText('Listing photo 2')).toBeVisible();
    const removeButton = screen.getByRole('button', { name: 'Remove photo 2' });
    expect(removeButton).toBeVisible();
    fireEvent.click(removeButton);
    expect(remove).toHaveBeenCalledWith(1);
    expect(screen.getByRole('status')).toHaveTextContent('2 of 6 photos');
  });

  it('disables further selection at six photos but keeps removal available', () => {
    render(<ImageUploader imagePreviews={Array.from({ length: 6 }, (_, i) => `blob:${i}`)} onRemove={vi.fn()} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeDisabled();
    expect(screen.getByLabelText('Photos from device')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Remove one to add another');
  });

  it('disables all changes while the parent is busy', () => {
    render(<ImageUploader imagePreviews={['blob:first']} onRemove={vi.fn()} onChange={vi.fn()} disabled />);
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled());
    expect(screen.getByLabelText('Camera photo')).toBeDisabled();
    expect(screen.getByLabelText('Photos from device')).toBeDisabled();
  });

  it('uses Greek copy and unique input IDs across instances', () => {
    language.locale = 'el';
    render(<><ImageUploader imagePreviews={[]} onRemove={vi.fn()} onChange={vi.fn()} /><ImageUploader imagePreviews={[]} onRemove={vi.fn()} onChange={vi.fn()} /></>);
    expect(screen.getAllByRole('button', { name: 'Βγάλε φωτογραφία' })).toHaveLength(2);
    const inputs = screen.getAllByLabelText('Φωτογραφία από κάμερα');
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(screen.getAllByText(/έως 5 MB/)).toHaveLength(2);
  });
});
