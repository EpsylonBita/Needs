'use client';

import { useState } from 'react';

import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface AdvancedSearchFormProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: AdvancedSearchFilters) => void;
}

export interface AdvancedSearchFilters {
  category: string;
  subcategory: string;
  smartTags: string[];
  radius: number;
}

const categories = [
  { id: 'items', name: 'Items', subcategories: ['Buy', 'Sell', 'Free'] },
  { id: 'services', name: 'Services', subcategories: ['I want', 'I will', 'I can'] }
];

const commonTags = [
  'Electronics', 'Furniture', 'Books', 'Clothing',
  'Programming', 'Design', 'Marketing', 'Teaching',
  'Music', 'Art', 'Sports', 'Food'
];

export function AdvancedSearchForm({ isOpen, onClose, onApply }: AdvancedSearchFormProps) {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [radius, setRadius] = useState([10]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleApply = () => {
    onApply({
      category: selectedCategory,
      subcategory: selectedSubcategory,
      smartTags: selectedTags,
      radius: radius[0]
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-full left-1/2 -translate-x-1/2 w-full max-w-2xl mt-2 z-50">
      <div className="bg-gradient-to-b from-blue-50 to-white rounded-xl shadow-lg border border-blue-100 p-6">
        <div className="space-y-6">
          {/* Categories */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Category</Label>
            <div className="grid grid-cols-2 gap-2">
              {categories.map(cat => (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setSelectedSubcategory('');
                  }}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Subcategories */}
          {selectedCategory && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Subcategory</Label>
              <div className="grid grid-cols-3 gap-2">
                {categories
                  .find(cat => cat.id === selectedCategory)
                  ?.subcategories.map(sub => (
                    <Button
                      key={sub}
                      variant={selectedSubcategory === sub ? "default" : "outline"}
                      className="w-full justify-start"
                      onClick={() => setSelectedSubcategory(sub)}
                    >
                      {sub}
                    </Button>
                  ))}
              </div>
            </div>
          )}

          {/* Smart Tags */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Smart Tags</Label>
            <div className="flex flex-wrap gap-2">
              {commonTags.map(tag => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer hover:bg-blue-100 hover:text-blue-900 transition-colors"
                  onClick={() => handleTagToggle(tag)}
                >
                  {selectedTags.includes(tag) && (
                    <X className="h-3 w-3 mr-1" />
                  )}
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Radius Slider */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-medium text-gray-700">Search Radius</Label>
              <span className="text-sm text-gray-500">{radius[0]} km</span>
            </div>
            <Slider
              value={radius}
              onValueChange={setRadius}
              max={50}
              min={1}
              step={1}
              className="w-full"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button 
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleApply}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
} 
