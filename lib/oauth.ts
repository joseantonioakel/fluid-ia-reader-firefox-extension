import { browser } from '#imports';
import { t } from './i18n';

/**
 * OAuth PKCE de OpenRouter: el usuario autoriza y la extensión recibe una clave
 * de API sin que tenga que copiar ni pegar nada.
 */

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return base64UrlEncode(bytes.buffer);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

export async function runOpenRouterOAuth(): Promise<string> {
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = new URL('https://openrouter.ai/auth');
  authUrl.searchParams.set('callback_url', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const redirect = await browser.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });
  if (!redirect) throw new Error(t('oauthClosed'));

  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error(t('oauthNoCode'));

  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!response.ok) {
    throw new Error(t('oauthExchangeRejected', response.status, await response.text()));
  }

  const data = (await response.json()) as { key?: string };
  if (!data.key) throw new Error(t('oauthNoKey'));
  return data.key;
}
