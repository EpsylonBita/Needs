'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

import { ChevronDown } from 'lucide-react';

import { useI18n } from '@/contexts/i18n-context';
import { cn } from '@/lib/utils';

import { Button } from './button';

interface AnimatedSearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onSearch?: (value: string) => void;
  onAdvancedSearch?: () => void;
}

const AnimatedSearchInput = forwardRef<HTMLInputElement, AnimatedSearchInputProps>(
  ({ className, onSearch, onAdvancedSearch, ...props }, ref) => {
    const { t } = useI18n();
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && onSearch) {
        onSearch((e.target as HTMLInputElement).value);
      }
    };

    return (
      <div className={cn('ui-input-container relative w-[300px]', className)}>
        <input
          ref={ref}
          className="ui-input w-full px-10 py-3 text-base border-none border-b-2 border-gray-200 outline-none bg-transparent transition-colors"
          type="text"
          onKeyDown={handleKeyDown}
          placeholder={t('search.animatedPlaceholder','Search for anything near to you')}
          {...props}
        />
        <div className="ui-input-underline absolute bottom-0 left-0 h-0.5 w-full bg-blue-500 scale-x-0 transition-transform duration-500" />
        <div className="ui-input-highlight absolute bottom-0 left-0 h-full w-0 bg-transparent transition-[width] duration-300" />
        <div className="ui-input-icon absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            className="w-5 h-5"
          >
            <path
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeWidth="2"
              stroke="currentColor"
              d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z"
            />
          </svg>
        </div>
        {onAdvancedSearch && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-500 hover:bg-transparent"
            onClick={onAdvancedSearch}
          >
            <ChevronDown className="h-5 w-5" />
          </Button>
        )}
      </div>
    );
  }
);

AnimatedSearchInput.displayName = 'AnimatedSearchInput';

export { AnimatedSearchInput };
