/** Hidden search windows sharing the default session with the Safari agent. */

import { BrowserWindow } from 'electron'
import type LoggerService from '../logging/logger.service'

/** Safari user agent used to avoid search-engine bot detection. */
const SEARCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'

/** Waits up to 10 seconds for the search page to finish loading. */
const LOAD_TIMEOUT_MS = 10_000

/** Lets rendered JavaScript settle briefly before extracting the page. */
const RENDER_SETTLE_MS = 500

/** Creates the standard cancellation error used by hidden search windows. */
const abortError = (): DOMException => new DOMException('Search stopped.', 'AbortError')

/** Owns one hidden window per search request. */
export default class SearchWindowService {
  private readonly windows = new Map<string, BrowserWindow>()

  /** Creates a search-window service that records load failures through the application logger. */
  public constructor(private readonly logger: LoggerService) {}

  /** Loads a page and resolves once the rendered content has settled or the load timed out. */
  public async open(uid: string, url: string, signal?: AbortSignal): Promise<void> {
    const window = this.ensureWindow(uid)
    if (signal?.aborted) throw abortError()
    /** Closes the request's hidden window when its abort signal fires. */
    const onAbort = (): void => {
      this.close(uid)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await this.loadUrl(window, url)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Runs one extraction script inside the loaded page and returns its JSON result. */
  public async evaluate<T>(uid: string, script: string): Promise<T> {
    const window = this.windows.get(uid)
    if (!window || window.isDestroyed()) throw new Error('Search window is not available.')
    return (await window.webContents.executeJavaScript(script, true)) as T
  }

  /** Closes the hidden window reserved for one search request. */
  public close(uid: string): void {
    const window = this.windows.get(uid)
    if (!window) return
    this.windows.delete(uid)
    if (!window.isDestroyed()) window.close()
  }

  /** Destroys every hidden search window during application shutdown. */
  public dispose(): void {
    for (const uid of [...this.windows.keys()]) this.close(uid)
  }

  /** Returns the existing window for a uid or creates a hidden one on the default session. */
  private ensureWindow(uid: string): BrowserWindow {
    const existing = this.windows.get(uid)
    if (existing && !existing.isDestroyed()) return existing
    const window = new BrowserWindow({
      width: 1280,
      height: 768,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: false,
      },
    })
    window.webContents.setUserAgent(SEARCH_USER_AGENT)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.on('closed', () => {
      if (this.windows.get(uid) === window) this.windows.delete(uid)
    })
    this.windows.set(uid, window)
    return window
  }

  /** Loads one URL: settle 500 ms after load, resolve after 10 s regardless. */
  private async loadUrl(window: BrowserWindow, url: string): Promise<void> {
    const webContents = window.webContents
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let settleTimer: ReturnType<typeof setTimeout> | null = null
      /** Resolves the load once and removes every temporary listener and timer. */
      const finish = (): void => {
        if (settled) return
        settled = true
        if (settleTimer) clearTimeout(settleTimer)
        clearTimeout(timeout)
        webContents.removeListener('did-finish-load', onFinished)
        webContents.removeListener('did-fail-load', onFailed)
        resolve()
      }
      /** Delays extraction briefly after the main frame finishes rendering. */
      const onFinished = (): void => {
        if (settled) return
        settleTimer = setTimeout(finish, RENDER_SETTLE_MS)
      }
      /** Rejects failed main-frame loads while ignoring subresource failures. */
      const onFailed = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        _validatedUrl: string,
        isMainFrame: boolean,
      ): void => {
        if (!isMainFrame || settled) return
        if (errorCode === -3) {
          settled = true
          if (settleTimer) clearTimeout(settleTimer)
          clearTimeout(timeout)
          webContents.removeListener('did-finish-load', onFinished)
          webContents.removeListener('did-fail-load', onFailed)
          reject(abortError())
          return
        }
        this.logger.warn('SearchWindow', 'Search page failed to load.', {
          errorCode,
          errorDescription,
        })
        settled = true
        if (settleTimer) clearTimeout(settleTimer)
        clearTimeout(timeout)
        webContents.removeListener('did-finish-load', onFinished)
        webContents.removeListener('did-fail-load', onFailed)
        reject(new Error(`Search page could not be loaded (${errorCode}).`))
      }
      const timeout = setTimeout(finish, LOAD_TIMEOUT_MS)
      webContents.once('did-finish-load', onFinished)
      webContents.once('did-fail-load', onFailed)
      window.loadURL(url).catch((error: unknown) => {
        if (settled) return
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('ERR_ABORTED')) return
        this.logger.warn('SearchWindow', 'Search page navigation failed.', error)
      })
    })
  }
}
