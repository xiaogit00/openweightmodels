import { sendMagicLinkEmail } from './mail';
import { isSigninAllowed } from './signin-allowlist';

type MagicLink = { email: string; url: string };

/**
 * Deliver a magic link only to allowlisted addresses.
 *
 * Returns whether mail was actually sent. The caller deliberately ignores that:
 * a suppressed request must look exactly like a delivered one, so the endpoint
 * cannot be used to probe the allowlist or discover which accounts exist.
 */
export async function deliverMagicLink(
  message: MagicLink,
  send: (message: MagicLink) => Promise<void> = sendMagicLinkEmail,
): Promise<boolean> {
  if (!isSigninAllowed(message.email)) {
    console.info('[auth] magic link suppressed: address is not allowlisted');
    return false;
  }
  await send(message);
  return true;
}
