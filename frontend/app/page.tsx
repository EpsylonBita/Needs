import React from 'react';

import { SearchHeroSection } from "@/components/features/search/search-hero-section";
import { HeroSection } from "@/components/layout/hero-section";

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <SearchHeroSection />
    </>
  );
}
