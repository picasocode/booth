'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 select-none">
      <span
        className={`font-display font-bold tracking-tight text-foreground ${small ? 'text-lg' : 'text-xl'}`}
      >
        Booth
      </span>
      <span aria-hidden className="relative flex h-2 w-2 self-center">
        <span className="booth-pulse absolute inline-flex h-full w-full rounded-full bg-live" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
      </span>
    </span>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}
