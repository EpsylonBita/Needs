"use client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/i18n-context";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="ghost" className={className} aria-label="Language">
          {locale === "el" ? "EL" : "EN"}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="rounded-md border bg-white dark:bg-black p-1 shadow-md">
        <DropdownMenu.Item className="px-2 py-1 cursor-pointer" onSelect={() => setLocale("en")}>EN</DropdownMenu.Item>
        <DropdownMenu.Item className="px-2 py-1 cursor-pointer" onSelect={() => setLocale("el")}>EL</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
