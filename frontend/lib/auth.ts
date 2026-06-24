const COOKIE_NAME = 'sb-access-token';

export function setTokenCookie(token: string) {
  const maxAge = 3600;
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  document.cookie =
    `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; SameSite=Strict` +
    (secure ? '; Secure' : '');
}

export function clearTokenCookie() {
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict`;
}
