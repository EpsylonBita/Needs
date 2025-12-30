"use client"

import * as React from "react"

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from "next-themes"

/**
 * ThemeProvider Component
 * 
 * Wraps the application in the NextThemes provider for dark mode support.
 * Uses localStorage to persist theme preference and supports system theme.
 */
export function ThemeProvider({ 
  children,
  attribute = "class",
  defaultTheme = "system",
  enableSystem = true,
  disableTransitionOnChange = false,
  storageKey = "theme-mode",
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  // Fix: Add state to prevent hydration mismatch
  const [mounted, setMounted] = React.useState(false)
  
  // Fix: Only apply theme after component is mounted on the client
  React.useEffect(() => {
    setMounted(true)
  }, [])
  
  // Fix: Use suppressHydrationWarning to avoid hydration warnings related to theme
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
      storageKey={storageKey}
      {...props}
    >
      {mounted ? children : 
        // Return a minimal version that matches the structure but avoids hydration issues
        <div suppressHydrationWarning style={{ visibility: 'hidden' }}>
          {children}
        </div>
      }
    </NextThemesProvider>
  )
}

/**
 * Custom hook for theme state management
 * 
 * Extends the next-themes useTheme hook with additional utilities.
 */
export function useTheme() {
  const { resolvedTheme, theme, setTheme, themes, systemTheme } = useNextTheme()
  // Fix: Add mounted state to avoid hydration issues when using this hook
  const [mounted, setMounted] = React.useState(false)
  
  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Check if current theme is dark
  const isDarkMode = React.useMemo(() => {
    if (!mounted) return false // Fix: Default value for SSR
    return theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark')
  }, [theme, resolvedTheme, mounted])

  // Toggle between light and dark
  const toggleTheme = React.useCallback(() => {
    if (!mounted) return // Fix: Don't run on server
    if (theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark')) {
      setTheme('light')
    } else {
      setTheme('dark')
    }
  }, [theme, resolvedTheme, setTheme, mounted])

  return {
    theme: mounted ? theme : undefined,
    setTheme,
    resolvedTheme: mounted ? resolvedTheme : undefined,
    themes,
    systemTheme: mounted ? systemTheme : undefined,
    isDarkMode,
    toggleTheme,
    mounted, // Export mounted state for consumers to know when it's safe to use theme values
  }
}
