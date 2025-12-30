"use client"

import * as React from "react"

import { Moon, Sun } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ThemeToggleProps extends React.HTMLAttributes<HTMLButtonElement> {
  /** Optionally show text label alongside icon */
  showLabel?: boolean;
  /** Variant of the button */
  variant?: "default" | "outline" | "ghost";
  /** Size of the button */
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * ThemeToggle Component
 * 
 * A button that toggles between light and dark themes
 * with smooth transitions and accessibility features.
 */
export function ThemeToggle({
  className,
  showLabel = false,
  variant = "outline",
  size = "icon",
  ...props
}: ThemeToggleProps) {
  const { setTheme, isDarkMode } = useTheme()
  const [isMounted, setIsMounted] = React.useState(false)

  // Wait for component to mount to avoid hydration mismatch
  React.useEffect(() => {
    setIsMounted(true)
  }, [])

  if (!isMounted) {
    return <Button 
      variant={variant} 
      size={size} 
      className={cn("invisible", className)}
      {...props} 
    >
      <Sun className="h-5 w-5" />
    </Button>
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => setTheme(isDarkMode ? "light" : "dark")}
      aria-label={`Switch to ${isDarkMode ? "light" : "dark"} theme`}
      {...props}
    >
      {isDarkMode ? (
        <Sun className="h-5 w-5 transition-all" />
      ) : (
        <Moon className="h-5 w-5 transition-all" />
      )}
      {showLabel && (
        <span className="ml-2">{isDarkMode ? "Light" : "Dark"} Mode</span>
      )}
    </Button>
  )
} 
