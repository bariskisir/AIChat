/** Defines desktop updater lifecycle state pushed from the main process. */

/** Describes one desktop update lifecycle transition. */
export interface UpdateStateEvent {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  version?: string | undefined
  percent?: number | undefined
  releaseNotes?: string | undefined
  message?: string | undefined
  pageUrl?: string | undefined
}
