import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Cookies from 'js-cookie'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/contexts/i18n-context')
import { I18nProvider, useI18n } from '@/contexts/i18n-context'

function Probe() {
  const { locale, setLocale, t } = useI18n()
  return <><output>{locale}:{t('navbar.home', 'Home')}</output><button onClick={() => setLocale('el')}>Greek</button></>
}

let root: Root | undefined
let container: HTMLDivElement
const tree = (initialLocale = 'en') => <StrictMode><I18nProvider initialLocale={initialLocale}><Probe /></I18nProvider></StrictMode>
function serverMarkup(element: React.ReactElement) {
  const browserWindow = window
  vi.stubGlobal('window', undefined)
  try { return renderToString(element) } finally { vi.stubGlobal('window', browserWindow) }
}
async function hydrate(element: React.ReactElement) {
  const errors: unknown[] = []
  container = document.createElement('div')
  container.innerHTML = serverMarkup(element)
  document.body.appendChild(container)
  await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error) }) })
  return errors
}

beforeEach(() => {
  localStorage.clear()
  Cookies.remove('locale')
  document.documentElement.lang = 'en'
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Locale hydration', () => {
  it('hydrates server English before adopting a saved browser Greek preference without overwriting it', async () => {
    localStorage.setItem('locale', 'el')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errors = await hydrate(tree())
    expect(errors).toEqual([])
    expect(screen.getByText('el:Αρχική')).toBeTruthy()
    expect(writes).not.toHaveBeenCalledWith('locale', 'en')
    expect(localStorage.getItem('locale')).toBe('el')
    expect(Cookies.get('locale')).toBe('el')
  })

  it('renders and hydrates a Greek server cookie with matching translated text', async () => {
    Cookies.set('locale', 'el')
    expect(serverMarkup(tree('el'))).toContain('Αρχική')
    expect(await hydrate(tree('el'))).toEqual([])
    expect(document.documentElement.lang).toBe('el')
  })

  it('ignores unsupported stored values and retains the valid server preference', async () => {
    localStorage.setItem('locale', 'unsupported')
    Cookies.set('locale', 'el')
    expect(await hydrate(tree('el'))).toEqual([])
    expect(screen.getByText('el:Αρχική')).toBeTruthy()
    expect(localStorage.getItem('locale')).toBe('el')
  })

  it('falls back to English for unsupported locale values', async () => {
    localStorage.setItem('locale', 'unsupported')
    Cookies.set('locale', 'unsupported')
    expect(await hydrate(tree('unsupported'))).toEqual([])
    expect(screen.getByText('en:Home')).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
  })

  it('continues rendering when browser storage is blocked', async () => {
    Cookies.set('locale', 'el')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    expect(await hydrate(tree('el'))).toEqual([])
    expect(screen.getByText('el:Αρχική')).toBeTruthy()
  })

  it('updates translated text and persists a user-selected language', () => {
    render(tree())
    expect(screen.getByText('en:Home')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Greek' }))
    expect(screen.getByText('el:Αρχική')).toBeTruthy()
    expect(localStorage.getItem('locale')).toBe('el')
    expect(Cookies.get('locale')).toBe('el')
    expect(document.documentElement.lang).toBe('el')
  })
})
