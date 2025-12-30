"use client";

import React, { useState } from "react";

import Link from "next/link";

export function HamburgerMenu(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  function toggleMenu(): void {
    setIsOpen(prev => !prev);
  }

  return (
    <div className="relative inline-block">
      <button onClick={toggleMenu} aria-label="Toggle Menu" type="button">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lucide lucide-menu w-6 h-6 cursor-pointer text-blue-500 hover:scale-110 hover:drop-shadow-lg transition-transform duration-300"
        >
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-40 bg-white border rounded-lg shadow-lg z-10">
          <ul>
            <li>
              <Link href="/items" className="block px-4 py-2 hover:bg-gray-100">
                Items
              </Link>
            </li>
            <li>
              <Link href="/services" className="block px-4 py-2 hover:bg-gray-100">
                Services
              </Link>
            </li>
            <li>
              <Link href="/about" className="block px-4 py-2 hover:bg-gray-100">
                About
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
} 
