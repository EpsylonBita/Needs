import { useState, useEffect } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

interface LocationAdProps {
  title: string;
  description: string;
  price: string;
  position: {
    top: string;
    left: string;
  };
  delay: number;
}

export function LocationAd({ title, description, price, position, delay }: LocationAdProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Initial appearance
    const initialTimer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    // Random visibility changes
    const intervalTimer = setInterval(() => {
      // 30% chance to toggle visibility
      if (Math.random() < 0.3) {
        setIsVisible(prev => !prev);
      }
    }, Math.random() * 5000 + 3000); // Random interval between 3-8 seconds

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [delay]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -12 }}
          transition={{ type: 'spring', stiffness: 240, damping: 20 }}
          className="absolute z-20"
          style={{ top: position.top, left: position.left }}
        >
          <div className="relative group">
            {/* Connection Line - Now pointing downward */}
            <div className="absolute w-[2px] h-16 bg-white/30 top-full left-1/2 transform -translate-x-1/2" />
            <div className="absolute w-2 h-2 bg-white rounded-full top-[calc(100%+64px)] left-1/2 transform -translate-x-1/2" />
            
            {/* Ad Card */}
            <div className="bg-white/10 backdrop-blur-md rounded-3xl p-4 w-64 border border-white/30 shadow-2xl hover:bg-white/20 transition-all duration-300 ring-1 ring-white/20">
              <button
                onClick={() => setIsVisible(false)}
                className="absolute -top-2 -right-2 p-1 bg-black/50 rounded-full hover:bg-black/70 transition-colors"
                aria-label="Close advertisement"
              >
                <X className="w-4 h-4 text-white" />
              </button>
              
              <h3 className="text-white font-medium mb-1">{title}</h3>
              <p className="text-white/80 text-sm mb-2">{description}</p>
              <div className="flex justify-end items-center">
                <span className="text-blue-400 font-semibold">{price}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
