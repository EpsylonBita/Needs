"use client";

import React, { useEffect, useState } from 'react';

import Image from "next/image";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useI18n } from "@/contexts/i18n-context";

import { CreateAdDialog } from "../ads/create-ad-dialog";
import { LocationAd } from "../ads/location-ad";

function usePhrases() {
  const { t } = useI18n();
  return [
    t("hero.phrase.buy", "Buy what you"),
    t("hero.phrase.sell", "Sell what you"),
    t("hero.phrase.help", "Help who you"),
    t("hero.phrase.find", "Find what you"),
  ];
}

/**
 * HeroSection Component
 *
 * A prominent section on the homepage, featuring animated phrases,
 * a background image, call-to-action buttons, and key statistics.
 */
export function HeroSection() {
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const { user } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const phrases = usePhrases();
  const { t } = useI18n();

  // Effect to cycle through phrases for animation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length);
    }, 3000);

    return () => clearInterval(interval); // Cleanup interval on component unmount
  }, [phrases.length]);


  return (
    <section className="relative w-full h-screen overflow-hidden pt-[72px]">
      {/* Background Image */}
      <div className="absolute inset-0 z-0 w-full h-full">
        <Image
          src="/athens.jpg"
          alt="Athens cityscape with Acropolis"
          fill
          priority={true}
          className="object-cover"
          sizes="(max-width: 768px) 100vw,
                 (max-width: 1200px) 100vw,
                 100vw"
          quality={100}
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABQODxIPDRQSEBIXFRQdHx0fHRsdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR3/2wBDAR0XFyAeIRshGxsdIR0hHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR3/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
        />
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      </div>
      
      {/* Location-based Ads */}
      <LocationAd
        title="Cozy Apartment near Acropolis"
        description="Perfect location with stunning views"
        price="€85/night"
        position={{ top: "35%", left: "3%" }}
        delay={1000}
      />
      <LocationAd
        title="Local Greek Restaurant"
        description="Traditional cuisine & atmosphere"
        price="55€"
        position={{ top: "30%", left: "80%" }}
        delay={2500}
      />
      <LocationAd
        title="Yoga Studio"
        description="Morning classes with city views"
        price="€15"
        position={{ top: "80%", left: "40%" }}
        delay={4000}
      />
      <LocationAd
        title="Art Gallery Space"
        description="Contemporary Greek artists"
        price="Free Entry"
        position={{ top: "55%", left: "70%" }}
        delay={5500}
      />
      
      {/* Hero Content */}
      <div className="container relative z-10 h-full flex items-center justify-center">
        <div className="flex flex-col items-center space-y-12 text-center">
          {/* Animated Phrase and Description */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            <div className="relative h-[160px] flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.span
                  key={currentPhraseIndex}
                  initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -20, filter: "blur(10px)" }}
                  transition={{
                    duration: 0.6,
                    ease: [0.43, 0.13, 0.23, 0.96]
                  }}
                  className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none inline-block mr-4 text-white"
                >
                  {phrases[currentPhraseIndex]}
                </motion.span>
              </AnimatePresence>
              <span className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none text-blue-400 inline-block animate-pulse-subtle glow-md">
                need
              </span>
            </div>
            <p className="mx-auto max-w-[800px] text-gray-200 text-xl md:text-2xl font-light">
              {t("hero.tagline")}
            </p>
          </motion.div>

          {/* Call-to-Action Button */}
          {user && (
            <>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="relative"
              >
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-blue-400 rounded-full blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                <Button 
                  size="default"
                  className="relative rounded-full w-16 h-16 bg-gradient-to-b from-blue-600 via-blue-500 to-blue-400 hover:from-blue-500 hover:via-blue-400 hover:to-blue-300 shadow-xl shadow-blue-500/25 hover:shadow-blue-500/50 hover:scale-110 transition-all duration-300 group"
                  onClick={() => setIsCreateDialogOpen(true)}
                  aria-label={t('ad.create.aria','Create new advertisement')}
                >
                  <Plus className="h-8 w-8 text-white group-hover:rotate-180 transition-transform duration-300" />
                  <span className="sr-only">{t('ad.create.aria','Create new advertisement')}</span>
                </Button>
              </motion.div>
              <CreateAdDialog 
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
              />
            </>
          )}

          {/* Statistics Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-8"
          >
            <div className="flex items-center justify-center space-x-4 text-sm text-white">
              <div className="flex items-center">
                <div className="h-2 w-2 rounded-full bg-green-400 mr-2" />
                <span>{t("stats.activeUsers")}</span>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 rounded-full bg-blue-400 mr-2" />
                <span>{t("stats.communities")}</span>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 rounded-full bg-purple-400 mr-2" />
                <span>{t("stats.support")}</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
