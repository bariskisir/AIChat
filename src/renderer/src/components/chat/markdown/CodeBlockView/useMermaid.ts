/** Lazily loads and configures the Mermaid engine for diagram previews. */

import { useEffect, useState } from 'react'
import { useTheme } from '@renderer/context/ThemeProvider'

/** The Mermaid API surface used by diagram previews. */
export interface MermaidEngine {
  initialize: (config: Record<string, unknown>) => void
  parse: (text: string) => Promise<unknown>
  render: (id: string, text: string, container?: HTMLElement) => Promise<{ svg: string }>
}

/** Memoized process-wide handle to the dynamically imported Mermaid module. */
let mermaidEnginePromise: Promise<MermaidEngine> | null = null

/** Imports Mermaid once and rethrows so the next attempt can retry. */
const fetchMermaidEngine = (): Promise<MermaidEngine> => {
  if (!mermaidEnginePromise) {
    mermaidEnginePromise = import('mermaid')
      .then((module) => (module.default ?? module) as unknown as MermaidEngine)
      .catch((error) => {
        mermaidEnginePromise = null
        throw error
      })
  }
  return mermaidEnginePromise
}

/** Maps the resolved app theme to a Mermaid theme name. */
const resolveMermaidTheme = (theme: 'dark' | 'light'): 'dark' | 'default' =>
  theme === 'dark' ? 'dark' : 'default'

/** Provides a theme-aware Mermaid engine for live diagram previews. */
export const useMermaid = (): {
  mermaid: MermaidEngine | null
  isLoading: boolean
  error: string | null
  forceRenderKey: number
} => {
  const { theme } = useTheme()
  const [engine, setEngine] = useState<MermaidEngine | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forceRenderKey, setForceRenderKey] = useState(0)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        setIsLoading(true)
        const loaded = await fetchMermaidEngine()
        if (!active) return

        loaded.initialize({
          startOnLoad: false,
          theme: resolveMermaidTheme(theme),
        })

        setEngine(loaded)
        setForceRenderKey((prev) => prev + 1)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Mermaid engine could not be started')
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [theme])

  return { mermaid: engine, isLoading, error, forceRenderKey }
}
