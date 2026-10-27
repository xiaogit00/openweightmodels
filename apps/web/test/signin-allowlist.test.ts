import { afterEach, describe, expect, it } from 'vitest';
import { isSigninAllowed, parseSigninAllowlist } from '../src/lib/signin-allowlist';

const original = process.env.SIGNIN_ALLOWED_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.SIGNIN_ALLOWED_EMAILS;
  else process.env.SIGNIN_ALLOWED_EMAILS = original;
});

function allowlist(value: string | undefined) {
  if (value === undefined) delete process.env.SIGNIN_ALLOWED_EMAILS;
  else process.env.SIGNIN_ALLOWED_EMAILS = value;
}

describe('sign-in allowlist', () => {
  it('allows every address when the variable is unset or blank', () => {
    allowlist(undefined);
    expect(isSigninAllowed('anyone@example.com')).toBe(true);
    allowlist('   ');
    expect(isSigninAllowed('anyone@example.com')).toBe(true);
  });

  it('allows an exact address, ignoring case and surrounding space', () => {
    allowlist(' Owner@Example.com , second@example.com ');
    expect(isSigninAllowed('owner@example.com')).toBe(true);
    expect(isSigninAllowed('  OWNER@example.COM ')).toBe(true);
    expect(isSigninAllowed('second@example.com')).toBe(true);
    expect(isSigninAllowed('someone@example.com')).toBe(false);
  });

  it('allows every address at an allowlisted domain', () => {
    allowlist('@example.com');
    expect(isSigninAllowed('one@example.com')).toBe(true);
    expect(isSigninAllowed('two@sub.example.com')).toBe(false);
    expect(isSigninAllowed('one@notexample.com')).toBe(false);
  });

  it('matches the domain of the address, not a substring', () => {
    allowlist('@example.com');
    expect(isSigninAllowed('attacker@example.com.evil.test')).toBe(false);
    expect(isSigninAllowed('attacker@badexample.com')).toBe(false);
  });

  it('fails closed when no entry is valid', () => {
    allowlist('not-an-address, @, ,');
    expect(parseSigninAllowlist('not-an-address, @')).toEqual({ emails: new Set(), domains: [] });
    expect(isSigninAllowed('owner@example.com')).toBe(false);
  });

  it('does not accept a malformed address as an entry', () => {
    allowlist('owner@, @example.com.');
    expect(isSigninAllowed('owner@example.com')).toBe(false);
  });
});
