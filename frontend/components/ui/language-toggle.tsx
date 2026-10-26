"use client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/i18n-context";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="ghost" className={className} aria-label={t('modern.language', 'Choose language')}>
          {locale === "el" ? "EL" : "EN"}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="z-[70] min-w-36 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
        <DropdownMenu.Item lang="en" className="flex min-h-11 items-center rounded-lg px-3 text-sm outline-none data-highlighted:bg-accent" onSelect={() => setLocale("en")}>English</DropdownMenu.Item>
        <DropdownMenu.Item lang="el" className="flex min-h-11 items-center rounded-lg px-3 text-sm outline-none data-highlighted:bg-accent" onSelect={() => setLocale("el")}>Ελληνικά</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
