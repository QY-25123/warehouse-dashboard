/**
 * Notion MCP OAuth 2.0 PKCE flow utilities.
 *
 * Flow:
 *  1. generateAndSavePKCE()   — generate verifier + challenge, store in sessionStorage
 *  2. registerClient()        — DCR with Notion to get a per-session client_id
 *  3. buildAuthUrl()          — construct the authorization redirect URL
 *  4. exchangeCode()          — swap authorization code for tokens on the callback page
 */

const NOTION_REGISTER_URL = 'https://mcp.notion.com/register';
const NOTION_AUTH_URL     = 'https://mcp.notion.com/authorize';
const NOTION_TOKEN_URL    = 'https://mcp.notion.com/token';
const NOTION_RESOURCE     = 'https://mcp.notion.com/mcp';

const SS_VERIFIER   = 'notion_code_verifier';
const SS_CLIENT_ID  = 'notion_client_id';
const SS_STATE      = 'notion_oauth_state';

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const hash    = await crypto.subtle.digest('SHA-256', encoded);
  return base64url(hash);
}

// ── Dynamic Client Registration ───────────────────────────────────────────────

export async function registerClient(redirectUri: string): Promise<string> {
  const res = await fetch(NOTION_REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name:               'Warehouse Dashboard',
      client_uri:                window.location.origin,
      redirect_uris:             [redirectUri],
      grant_types:               ['authorization_code', 'refresh_token'],
      response_types:            ['code'],
      token_endpoint_auth_method: 'none',
      scope:                     'default',
    }),
  });
  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const data = await res.json();
  return data.client_id as string;
}

// ── Session-storage helpers ───────────────────────────────────────────────────

export function saveOAuthSession(verifier: string, clientId: string, state: string) {
  sessionStorage.setItem(SS_VERIFIER,  verifier);
  sessionStorage.setItem(SS_CLIENT_ID, clientId);
  sessionStorage.setItem(SS_STATE,     state);
}

export function loadOAuthSession(): { verifier: string; clientId: string; state: string } | null {
  const verifier  = sessionStorage.getItem(SS_VERIFIER);
  const clientId  = sessionStorage.getItem(SS_CLIENT_ID);
  const state     = sessionStorage.getItem(SS_STATE);
  if (!verifier || !clientId || !state) return null;
  return { verifier, clientId, state };
}

export function clearOAuthSession() {
  sessionStorage.removeItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_CLIENT_ID);
  sessionStorage.removeItem(SS_STATE);
}

// ── Authorization URL ─────────────────────────────────────────────────────────

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             clientId,
    redirect_uri:          redirectUri,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    state,
    resource:              NOTION_RESOURCE,
    scope:                 'default',
  });
  return `${NOTION_AUTH_URL}?${params}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface NotionTokenResponse {
  access_token:   string;
  refresh_token:  string;
  token_type:     string;
  expires_in:     number;
  workspace_id:   string;
  workspace_name: string;
  bot_id:         string;
}

export async function exchangeCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<NotionTokenResponse> {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    client_id:     clientId,
    code_verifier: codeVerifier,
    resource:      NOTION_RESOURCE,
  });

  const res = await fetch(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error_description ?? `Token exchange failed: ${res.status}`);
  }
  return res.json() as Promise<NotionTokenResponse>;
}

// ── Main entry point (call from Connect button) ───────────────────────────────

export async function startNotionOAuth() {
  const redirectUri = `${window.location.origin}/notion/callback`;
  const verifier    = generateCodeVerifier();
  const challenge   = await generateCodeChallenge(verifier);
  const state       = base64url(crypto.getRandomValues(new Uint8Array(16)));

  const clientId = await registerClient(redirectUri);
  saveOAuthSession(verifier, clientId, state);
  window.location.href = buildAuthUrl(clientId, redirectUri, challenge, state);
}
