"use client";

import { Check, Plus, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  categoryError?: string;
  subcategoryError?: string;
}

export function CategoryTagsPicker({ selectedCategory, selectedSubcategory, selectedTags, analysis, isLoadingTags, onCategorySelect, onSubcategorySelect, onToggleTag, categoryError, subcategoryError }: CategoryTagsPickerProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {t('search.category','Category')}
        </Label>
        <Select value={selectedCategory} onValueChange={onCategorySelect}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('ad.category.placeholder','Select category...')} />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(CATEGORY_STRUCTURE).map((category) => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categoryError && <p className="text-sm text-red-500">{categoryError}</p>}
      </div>

      {selectedCategory && (
        <div className="space-y-2">
          <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
            {t('search.subcategory','Subcategory')}
          </Label>
          <Select value={selectedSubcategory} onValueChange={onSubcategorySelect}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('ad.subcategory.placeholder','Select subcategory...')} />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_STRUCTURE[selectedCategory as keyof typeof CATEGORY_STRUCTURE].subcategories.map((subcategory) => (
                <SelectItem key={subcategory} value={subcategory}>{subcategory}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {subcategoryError && <p className="text-sm text-red-500">{subcategoryError}</p>}
        </div>
      )}

      {selectedCategory && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
              Main Category Tags {analysis.tags.length > 0 && `(${analysis.tags.length} from AI)`}
            </Label>
          </div>
          <div className="min-h-[2.5rem] p-4 space-y-2 bg-white dark:bg-gray-950 rounded-md ring-1 ring-blue-200/50 dark:ring-blue-900/30">
            {isLoadingTags ? (
              <div className="flex items-center justify-center text-sm text-gray-500">
                {/* Loader icon intentionally omitted to avoid extra imports */}
                {t('ad.loadingCategories','Loading categories...')}
              </div>
            ) : analysis.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {analysis.tags.map((tag) => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => onToggleTag(tag)}
                      className={cn(
                        "group px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                        isSelected ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                      )}
                    >
                      {tag}
                      {isSelected ? (
                        <Check className="inline-block w-4 h-4 ml-1 transition-transform group-hover:scale-110" />
                      ) : (
                        <Plus className="inline-block w-4 h-4 ml-1 opacity-0 transition-all group-hover:opacity-100" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center">
                {t('ad.tags.mainEmpty','Use the "Quick Create with AI" option to generate main category tags')}
              </p>
            )}
          </div>
        </div>
      )}

      {selectedCategory && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
              {t('ad.tags.smart','Smart Tags')} {analysis.smartTags.length > 0 && `(${analysis.smartTags.length} ${t('ad.tags.fromAi','from AI')})`}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30">
                  {t('ad.tags.edit','Edit Tags')}
                  <ChevronsUpDown className="ml-2 h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="end">
                <Command>
                  <CommandInput placeholder={t('ad.tags.search','Search tags...')} />
                  <CommandList>
                    <CommandEmpty>{t('ad.tags.none','No tags found.')}</CommandEmpty>
                    {Object.entries(CATEGORY_STRUCTURE[selectedCategory as keyof typeof CATEGORY_STRUCTURE].tags).map(([group, tags]) => (
                      <CommandGroup key={group} heading={group}>
                        {(tags as string[]).map((tag) => {
                          const isSelected = selectedTags.includes(tag);
                          return (
                            <CommandItem key={tag} onSelect={() => onToggleTag(tag)} className="flex items-center">
                              <div className={cn("mr-2 h-4 w-4 rounded-sm border border-gray-200 flex items-center justify-center", isSelected ? "bg-blue-500 border-blue-500 text-white" : "opacity-50")}>
                                {isSelected && <Check className="h-3 w-3" />}
                              </div>
                              {tag}
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </div>
  )
}
