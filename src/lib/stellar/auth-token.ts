'use client'

/**
 * Token de sesión SEYF (emitido tras SEP-10), compartido por toda la app.
 *
 * Vive en un módulo singleton para que `store.ts` lo use sin recibirlo por
 * parámetro en cada llamada, y se respalda en sessionStorage para sobrevivir
 * a una recarga sin volver a pedirle la firma al usuario.
 */

const STORAGE_KEY = 'seyf_auth_token'

type TokenState = { token: string; account: string; expiresAt: number }

let current: TokenState | null = null
/** Minteo en curso: las peticiones que lleguen mientras tanto lo esperan. */
let inflight: Promise<string | null> | null = null

function readStorage(): TokenState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TokenState
    if (!parsed?.token || typeof parsed.expiresAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function isFresh(state: TokenState | null): state is TokenState {
  // Margen de 60 s para no usar un token que expira a mitad de la petición.
  return Boolean(state && state.expiresAt - 60_000 > Date.now())
}

export function setSeyfAuthToken(token: string, account: string, expiresInSec: number): void {
  current = { token, account, expiresAt: Date.now() + expiresInSec * 1000 }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* sessionStorage puede fallar en modo privado — el token igual vive en memoria */
  }
}

export function clearSeyfAuthToken(): void {
  current = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

/** Token válido en memoria o sessionStorage; `null` si no hay o ya expiró. */
export function peekSeyfAuthToken(): string | null {
  if (isFresh(current)) return current.token
  const stored = readStorage()
  if (isFresh(stored)) {
    current = stored
    return stored.token
  }
  return null
}

/** Cuenta Stellar del token vigente, si lo hay. */
export function seyfAuthAccount(): string | null {
  if (isFresh(current)) return current.account
  const stored = readStorage()
  return isFresh(stored) ? stored.account : null
}

export function setSeyfAuthInflight(p: Promise<string | null> | null): void {
  inflight = p
}

/**
 * Cuenta Stellar de la sesión, esperando el minteo si está en curso.
 * Es la clave con la que se guardan los datos del usuario: el servidor solo
 * acepta filas de la cuenta que firmó, así que cliente y servidor tienen que
 * estar de acuerdo en quién es.
 */
export async function awaitSeyfAuthAccount(): Promise<string | null> {
  const existing = seyfAuthAccount()
  if (existing) return existing
  if (inflight) {
    await inflight.catch(() => null)
    return seyfAuthAccount()
  }
  return null
}

/**
 * Header `Authorization` para las rutas autenticadas. Si hay un minteo en
 * curso lo espera, para que la primera carga de la app no dispare 401s.
 */
export async function seyfAuthHeaders(): Promise<Record<string, string>> {
  const existing = peekSeyfAuthToken()
  if (existing) return { Authorization: `Bearer ${existing}` }

  if (inflight) {
    const token = await inflight.catch(() => null)
    if (token) return { Authorization: `Bearer ${token}` }
  }
  return {}
}
