"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/contexts/i18n-context";
import { CATEGORY_STRUCTURE } from "@/lib/constants/categories";
import { cn } from "@/lib/utils";

interface CategoryTagsPickerProps {
  selectedCategory: string;
  selectedSubcategory: string;
  selectedTags: string[];
  analysis: { tags: string[]; smartTags: string[] };
  isLoadingTags: boolean;
  onCategorySelect: (category: string) => void;
  onSubcategorySelect: (subcategory: string) => void;
  onToggleTag: (tag: string) => void;
  onAddTag?: (tag: string) => void;
  children?: ReactNode;
  categoryError?: string;
  subcategoryError?: string;
}

export function CategoryTagsPicker({ selectedCategory, selectedSubcategory, selectedTags, analysis, isLoadingTags, onCategorySelect, onSubcategorySelect, onToggleTag, onAddTag, children, categoryError, subcategoryError }: CategoryTagsPickerProps) {
  const { locale } = useI18n();
  const id = useId();
  const [tagDraft, setTagDraft] = useState("");
  const greek = locale === 'el';
  const copy = greek ? {
    category: 'Κατηγορία', direction: 'Είδος αγγελίας', chooseCategory: 'Επίλεξε κατηγορία', chooseDirection: 'Επίλεξε είδος αγγελίας',
    tags: 'Smart tags', help: 'Προστίθενται αυτόματα από την περιγραφή. Πάτησε μια ετικέτα για να την αφαιρέσεις ή να την προσθέσεις ξανά.',
    empty: 'Γράψε λίγες λέξεις στην περιγραφή και οι σχετικές ετικέτες θα εμφανιστούν εδώ.', loading: 'Ενημέρωση ετικετών…',
    custom: 'Δική σου ετικέτα', edit: 'Προσθήκη ετικέτας', placeholder: 'π.χ. ξύλινο', add: 'Προσθήκη', limit: 'Έως 20 ετικέτες, με έως 50 χαρακτήρες η καθεμία.', selected: 'επιλεγμένες',
  } : {
    category: 'Category', direction: 'Listing type', chooseCategory: 'Choose a category', chooseDirection: 'Choose a listing type',
    tags: 'Smart tags', help: 'Added automatically from your description. Tap a tag to remove it or add it again.',
    empty: 'Write a few words in your description and relevant tags will appear here.', loading: 'Updating tags…',
    custom: 'Your own tag', edit: 'Edit tags', placeholder: 'e.g. wooden', add: 'Add tag', limit: 'Up to 20 tags, with up to 50 characters each.', selected: 'selected',
  };
  const names: Record<string, string> = greek ? {
    Items: 'Αντικείμενα', Services: 'Υπηρεσίες', Buy: 'Ζητάω αντικείμενο', Sell: 'Πουλάω αντικείμενο', Free: 'Χαρίζω αντικείμενο',
    'I want': 'Ζητάω υπηρεσία', 'I will': 'Προσφέρω υπηρεσία', 'I can': 'Μπορώ να βοηθήσω',
  } : {
    Items: 'Items', Services: 'Services', Buy: 'I am looking for an item', Sell: 'I am selling an item', Free: 'I am giving an item away',
    'I want': 'I need a service', 'I will': 'I offer a service', 'I can': 'I can help',
  };
  const category = Object.hasOwn(CATEGORY_STRUCTURE, selectedCategory)
    ? CATEGORY_STRUCTURE[selectedCategory as keyof typeof CATEGORY_STRUCTURE] : null;
  const tags = [...new Set([...selectedTags, ...analysis.tags, ...analysis.smartTags])];
  const cleanDraft = tagDraft.trim();
  const canAdd = !!onAddTag && cleanDraft.length > 0 && cleanDraft.length <= 50 && selectedTags.length < 20
    && !selectedTags.some(tag => tag.toLocaleLowerCase() === cleanDraft.toLocaleLowerCase());
  const selectClass = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

  function addTag() {
    if (!canAdd || !onAddTag) return;
    onAddTag(cleanDraft);
    setTagDraft('');
  }

  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-category`}>{copy.category}</Label>
        <select id={`${id}-category`} value={category ? selectedCategory : ''} onChange={event => onCategorySelect(event.target.value)}
          aria-invalid={!!categoryError} aria-describedby={categoryError ? `${id}-category-error` : undefined} className={selectClass}>
          <option value="">{copy.chooseCategory}</option>
          {Object.keys(CATEGORY_STRUCTURE).map(value => <option key={value} value={value}>{names[value]}</option>)}
        </select>
        {categoryError && <p id={`${id}-category-error`} role="alert" className="text-sm text-destructive">{categoryError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-direction`}>{copy.direction}</Label>
        <select id={`${id}-direction`} value={category?.subcategories.includes(selectedSubcategory) ? selectedSubcategory : ''} disabled={!category}
          onChange={event => onSubcategorySelect(event.target.value)} aria-invalid={!!subcategoryError}
          aria-describedby={subcategoryError ? `${id}-direction-error` : undefined} className={selectClass}>
          <option value="">{copy.chooseDirection}</option>
          {category?.subcategories.map(value => <option key={value} value={value}>{names[value]}</option>)}
        </select>
        {subcategoryError && <p id={`${id}-direction-error`} role="alert" className="text-sm text-destructive">{subcategoryError}</p>}
      </div>
    </div>

    {children}

    <section aria-labelledby={`${id}-tags-heading`} aria-describedby={`${id}-tags-help`} className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-tags-heading`} className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-primary" aria-hidden="true" />{copy.tags}</h3>
        <span className="text-xs text-muted-foreground" aria-live="polite">{selectedTags.length}/20 {copy.selected}</span>
      </div>
      <p id={`${id}-tags-help`} className="mt-1.5 text-xs leading-5 text-muted-foreground">{copy.help}</p>
      {isLoadingTags && <p role="status" className="mt-3 text-sm text-muted-foreground">{copy.loading}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map(tag => {
          const selected = selectedTags.includes(tag);
          return <button key={tag} type="button" aria-pressed={selected} disabled={!selected && (selectedTags.length >= 20 || tag.length > 50)}
            onClick={() => onToggleTag(tag)} className={cn('inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              selected ? 'border-primary/25 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border bg-background text-muted-foreground hover:bg-accent')}>
            <span className="break-words">{tag}</span>{selected ? <Check size={14} className="shrink-0" aria-hidden="true" /> : <Plus size={14} className="shrink-0" aria-hidden="true" />}
          </button>;
        })}
        {!tags.length && !isLoadingTags && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
      </div>
      {onAddTag && <details className="mt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus size={15} aria-hidden="true" />{copy.edit}</summary>
        <div className="space-y-2 pb-1 pt-1">
        <Label htmlFor={`${id}-new-tag`}>{copy.custom}</Label>
        <div className="flex gap-2">
          <Input id={`${id}-new-tag`} value={tagDraft} maxLength={50} placeholder={copy.placeholder} aria-describedby={`${id}-tag-limit`}
            onChange={event => setTagDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); addTag(); }
            }} className="h-11 min-w-0 rounded-xl bg-background text-base shadow-none" />
          <Button type="button" variant="outline" onClick={addTag} disabled={!canAdd} className="h-11 shrink-0 rounded-xl">{copy.add}</Button>
        </div>
        <p id={`${id}-tag-limit`} className="text-xs text-muted-foreground">{copy.limit}</p>
        </div>
      </details>}
    </section>
  </div>;
}
