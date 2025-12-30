'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useSearchState } from "@/hooks/use-search-state";

export default function SearchFilters() {
  const {
    category,
    subcategory,
    tags,
    distance,
    reset
  } = useSearchState();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Category</Label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2"
          value={category.value}
          onChange={(e) => category.set(e.target.value)}
          aria-label="Category"
        >
          <option value="">All Categories</option>
          <option value="Items">Items</option>
          <option value="Services">Services</option>
        </select>
      </div>

      {category.value && (
        <div className="space-y-2">
          <Label>Subcategory</Label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2"
            value={subcategory.value}
            onChange={(e) => subcategory.set(e.target.value)}
            aria-label="Subcategory"
          >
            <option value="">All Subcategories</option>
            {category.value === 'Items' ? (
              <>
                <option value="Sell">Sell</option>
                <option value="Want">Want</option>
              </>
            ) : (
              <>
                <option value="I Will">I Will</option>
                <option value="I Need">I Need</option>
              </>
            )}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Distance (km)</Label>
        <Slider
          value={[distance.value]}
          onValueChange={(value) => distance.set(value[0])}
          min={1}
          max={100}
          step={1}
        />
        <span className="text-sm text-muted-foreground">{distance.value}km</span>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <Input
          placeholder="Enter tags separated by commas"
          value={tags.value.join(', ')}
          onChange={(e) => tags.set(e.target.value.split(',').map(tag => tag.trim()))}
        />
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => reset()}
      >
        Reset Filters
      </Button>
    </div>
  );
} 
