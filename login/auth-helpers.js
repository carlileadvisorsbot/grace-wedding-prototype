export function resolveSafeNext(requestedNext, currentHref) {
  if (requestedNext) {
    try {
      const requestedUrl = new URL(requestedNext, currentHref);
      if (requestedUrl.origin === new URL(currentHref).origin) return requestedUrl.href;
    } catch {
      // Fall through to the private app on malformed input.
    }
  }
  return new URL('../app/', currentHref).href;
}

export function getRecoveryRedirect(currentHref) {
  return new URL('./?reset=1', currentHref).href;
}

export function friendlyAuthError(error, fallback) {
  const message = String(error?.message || '');
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match. Try again or reset your password.';
  if (/already registered|already exists/i.test(message)) return 'An account already exists for that email. Log in or reset its password instead.';
  if (/invalid.*email|email.*invalid/i.test(message)) return 'Enter a valid email address.';
  if (/signup.*disabled|signups.*not allowed/i.test(message)) return 'New-account creation is temporarily unavailable.';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'Choose a password with at least 8 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a few minutes, then try again.';
  return fallback;
}

export function getSignUpErrorMessage(data, error) {
  if (error) {
    return friendlyAuthError(
      error,
      'We could not create that account. Use the exact pre-approved partner email and a password of at least 8 characters.',
    );
  }
  if (data?.user?.identities?.length === 0) {
    return 'An account already exists for that email. Log in or reset its password instead.';
  }
  return '';
}
