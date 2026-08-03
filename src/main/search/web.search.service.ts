/** Google/Bing web search with hidden windows and Readability extraction. */

import readabilitySource from '@mozilla/readability/Readability.js?raw'
import turndownSource from 'turndown/lib/turndown.browser.umd.js?raw'
import type { Citation, WebSearchMode } from '@shared/index'
import { clampSurrogateBoundary } from '@shared/index'
import type LoggerService from '../logging/logger.service'
import SearchWindowService from './hidden.window.service'

export interface WebSearchResult {
  citations: Citation[]
  context: string
}

interface SearchLink {
  title: string
  url: string
}

interface SearchContent {
  title: string
  url: string
  content: string
}

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const MAX_QUERIES = 3
const MAX_RESULTS_PER_QUERY = 5
const MAX_CITATIONS = 5
const MAX_SNIPPET_CHARS = 260
const MAX_CONTENT_CHARS = 8_000
const CONTENT_TIMEOUT_MS = 30_000
/** Keeps the base64 data URL under Chromium's 2 MB URL limit (1.4 MB HTML → ~1.87 MB encoded). */
const MAX_PAGE_BYTES = 1_400_000
const EXTRACTION_CONCURRENCY = 4

/** Creates the standard cancellation error used by the web-search pipeline. */
const abortError = (): DOMException => new DOMException('Search stopped.', 'AbortError')

/** Generates a unique identifier for one hidden search-window request. */
const randomUid = (): string => `web-search-${Math.random().toString(36).slice(2)}`

/** Extracts a hostname from an organic result URL, falling back to the raw link. */
const hostnameFor = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Builds the engine URLs used by the local Google and Bing providers. */
const buildSearchUrl = (engine: Exclude<WebSearchMode, 'off'>, query: string): string => {
  const encoded = encodeURIComponent(query)
  return engine === 'google'
    ? 'https://www.google.com/search?q=%s'.replace('%s', encoded)
    : 'https://cn.bing.com/search?q=%s&ensearch=1'.replace('%s', encoded)
}

/** Applies the app-language restriction to local engine queries. */
const applyLanguageFilter = (query: string, language: string): string =>
  `${query} lang:${language.split('-')[0] || 'en'}`

/** Extracts Google organic results with the LocalGoogleProvider selectors. */
const GOOGLE_EXTRACTION_SCRIPT = `(() => {
  const results = [];
  try {
    document.querySelectorAll('#search .MjjYud').forEach((item) => {
      const title = item.querySelector('h3');
      const link = item.querySelector('a');
      if (title && link) results.push({ title: title.textContent || '', url: link.href });
    });
  } catch (error) {}
  return results;
})()`

/** Extracts Bing organic results with the LocalBingProvider selectors and URL decode. */
const BING_EXTRACTION_SCRIPT = `(() => {
  const results = [];
  try {
    document.querySelectorAll('#b_results h2').forEach((item) => {
      const node = item.querySelector('a');
      if (!node) return;
      const url = decodeBingUrl(node.href || '');
      results.push({ title: node.textContent || '', url });
    });
  } catch (error) {}
  return results;
  function decodeBingUrl(bingUrl) {
    try {
      const url = new URL(bingUrl);
      const encodedUrl = url.searchParams.get('u');
      if (!encodedUrl) return bingUrl;
      const decodedUrl = atob(encodedUrl.substring(2));
      if (decodedUrl.startsWith('http')) return decodedUrl;
      return bingUrl;
    } catch (error) {
      return bingUrl;
    }
  }
})()`

/** Runs Readability plus Turndown extraction inside a rendered page. */
const CONTENT_EXTRACTION_SCRIPT = `(() => {
  ${readabilitySource}
  ${turndownSource}
  try {
    const article = new Readability(document.cloneNode(true)).parse();
    const markdown = new TurndownService().turndown(article?.content || '');
    return { title: article?.title || '', content: markdown || '' };
  } catch (error) {
    return { title: '', content: '' };
  }
})()`

/** Performs local engine searches with hidden-window fetching. */
export default class WebSearchService {
  private readonly searchWindow: SearchWindowService

  /** Creates a search service that logs engine failures and renders pages in hidden windows. */
  public constructor(private readonly logger: LoggerService) {
    this.searchWindow = new SearchWindowService(logger)
  }

  /** Runs up to three queries in parallel and returns citations and model context. */
  public async search(
    engine: Exclude<WebSearchMode, 'off'>,
    queries: string[],
    language: string,
    signal: AbortSignal,
    onProgress?: (query: string, count: number, done: boolean) => void,
  ): Promise<WebSearchResult> {
    const settled = await Promise.allSettled(
      queries.slice(0, MAX_QUERIES).map(async (query) => {
        if (signal.aborted) throw abortError()
        onProgress?.(query, 0, false)
        const links = await this.searchEngine(engine, query, language, signal)
        if (signal.aborted) throw abortError()
        const contents = await this.fetchPageContents(links, signal)
        return contents
      }),
    )
    const results: SearchContent[] = []
    for (let index = 0; index < settled.length; index += 1) {
      const query = queries[index] ?? ''
      const outcome = settled[index]
      if (!outcome) continue
      if (outcome.status === 'rejected') {
        if (signal.aborted) throw outcome.reason
        this.logger.warn('WebSearch', `${engine} search failed for a query.`, outcome.reason)
        onProgress?.(query, -1, true)
        continue
      }
      onProgress?.(query, outcome.value.length, true)
      results.push(...outcome.value)
    }

    const citations: Citation[] = []
    const contexts: string[] = []
    let index = 0
    for (const result of results) {
      if (citations.length >= MAX_CITATIONS) break
      if (!result.content) continue
      index += 1
      const citation: Citation = {
        index,
        title: result.title || hostnameFor(result.url),
        url: result.url,
        snippet: result.content.slice(0, clampSurrogateBoundary(result.content, MAX_SNIPPET_CHARS)),
      }
      citations.push(citation)
      const contentCut = clampSurrogateBoundary(result.content, MAX_CONTENT_CHARS)
      contexts.push(
        `[${citation.index}] ${citation.title}\nURL: ${citation.url}\n${result.content.slice(0, contentCut)}`,
      )
    }
    return { citations, context: contexts.join('\n\n') }
  }

  /** Loads one engine results page in a hidden window and extracts organic links. */
  private async searchEngine(
    engine: Exclude<WebSearchMode, 'off'>,
    query: string,
    language: string,
    signal: AbortSignal,
  ): Promise<SearchLink[]> {
    const uid = randomUid()
    const cleanedQuery = query.split('\r\n')[1] ?? query
    const queryWithLanguage = language ? applyLanguageFilter(cleanedQuery, language) : cleanedQuery
    const url = buildSearchUrl(engine, queryWithLanguage)
    try {
      await this.searchWindow.open(uid, url, signal)
      if (signal.aborted) throw abortError()
      const items = await this.searchWindow.evaluate<SearchLink[]>(
        uid,
        engine === 'google' ? GOOGLE_EXTRACTION_SCRIPT : BING_EXTRACTION_SCRIPT,
      )
      return items.filter((item) => /^https?:\/\//i.test(item.url)).slice(0, MAX_RESULTS_PER_QUERY)
    } finally {
      this.searchWindow.close(uid)
    }
  }

  /** Downloads result pages with bounded concurrency and extracts their main content. */
  private async fetchPageContents(
    links: SearchLink[],
    signal: AbortSignal,
  ): Promise<SearchContent[]> {
    const results: Array<SearchContent | null> = new Array(links.length)
    let next = 0
    /** Claims pending links and extracts them until the shared queue is empty. */
    const worker = async (): Promise<void> => {
      while (next < links.length) {
        const current = next
        next += 1
        const link = links[current]
        if (link) results[current] = await this.fetchPageContent(link.url, signal)
      }
    }
    await Promise.allSettled(
      Array.from({ length: Math.min(EXTRACTION_CONCURRENCY, links.length) }, worker),
    )
    return results.filter((result): result is SearchContent => result !== null)
  }

  /** Fetches one page with the Chrome agent and extracts markdown with Readability and Turndown. */
  private async fetchPageContent(url: string, signal: AbortSignal): Promise<SearchContent | null> {
    try {
      if (signal.aborted) throw abortError()
      const response = await fetch(url, {
        headers: {
          'User-Agent': CHROME_USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.any([signal, AbortSignal.timeout(CONTENT_TIMEOUT_MS)]),
      })
      if (!response.ok) return null
      const html = await this.readBoundedText(response, MAX_PAGE_BYTES)
      if (!html) return null
      return await this.extractWithReadability(html, url, signal)
    } catch (error) {
      if (signal.aborted) throw error
      return null
    }
  }

  /** Renders one page in a hidden window and returns Readability markdown. */
  private async extractWithReadability(
    html: string,
    url: string,
    signal: AbortSignal,
  ): Promise<SearchContent | null> {
    const uid = randomUid()
    const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`
    try {
      await this.searchWindow.open(uid, dataUrl, signal)
      if (signal.aborted) throw abortError()
      const article = await this.searchWindow.evaluate<SearchContent>(
        uid,
        CONTENT_EXTRACTION_SCRIPT,
      )
      return article.content ? { title: article.title || url, url, content: article.content } : null
    } catch (error) {
      if (signal.aborted) throw error
      this.logger.warn('WebSearch', 'Page content extraction failed.', error)
      return null
    } finally {
      this.searchWindow.close(uid)
    }
  }

  /** Reads at most maxBytes of the response body to keep one result page bounded. */
  private async readBoundedText(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let received = 0
    let text = ''
    while (received < maxBytes) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      text += decoder.decode(chunk.value, { stream: true })
    }
    if (received >= maxBytes) await reader.cancel()
    return `${text}${decoder.decode()}`.slice(0, maxBytes)
  }
}
