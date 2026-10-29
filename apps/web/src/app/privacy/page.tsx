import Link from 'next/link';
import { LegalShell } from '@/components/legal';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Privacy Policy — OpenWeightModels',
  description: 'What OpenWeightModels collects, why, and how long it keeps it.',
};

const UPDATED = '22 October 2026';

export default async function PrivacyPage() {
  const user = await getCurrentUser();

  return (
    <LegalShell
      title="Privacy Policy"
      updated={UPDATED}
      handle={user?.handle ?? null}
      signedIn={user !== null}
    >
      <section>
        <p>
          This policy describes the data OpenWeightModels actually collects in the
          product today, where it goes, and how long it stays. It is written for the
          current build, not for an aspirational future one. The operator is{' '}
          <strong>[legal entity name]</strong>, contactable at{' '}
          <strong>[contact email]</strong>.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Why</th>
              <th>Who can see it</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Email address</td>
              <td>To send a single-use sign-in link and to contact you about your account</td>
              <td>You and the operator only. Never shown publicly.</td>
            </tr>
            <tr>
              <td>
                Handle, account id, member-since date, role (member or Admin), suspension
                status
              </td>
              <td>Public identity and access control</td>
              <td>Handle is public on everything you publish. The rest is internal.</td>
            </tr>
            <tr>
              <td>
                Sign-in session: a session token, its expiry, IP address and browser user
                agent; a hashed magic-link token with its expiry
              </td>
              <td>Keep you signed in, prevent link reuse, and secure the service</td>
              <td>The operator only.</td>
            </tr>
            <tr>
              <td>
                Comparison content: title, Prompt, Categories, Effort, the Base output you
                upload, and generated Challenger Responses with model, token count,
                latency and provider-reported cost
              </td>
              <td>To generate and display the Comparison</td>
              <td>
                Published Comparisons are public. Drafts, Jobs and unpublished work are
                visible only to you (and silently hidden from everyone else).
              </td>
            </tr>
            <tr>
              <td>
                Discussion and Annotations: comments, annotation kind, the highlighted
                quote and range, thread messages, votes
              </td>
              <td>To display the conversation and rank by activity</td>
              <td>
                Public on a published Comparison; vote totals are public but individual
                votes are not shown.
              </td>
            </tr>
            <tr>
              <td>Notifications and their read state</td>
              <td>Tell you when a Job is ready</td>
              <td>You only.</td>
            </tr>
            <tr>
              <td>Reports you file, and moderation records</td>
              <td>Review harmful content and keep actions attributable</td>
              <td>Admins only; never published.</td>
            </tr>
            <tr>
              <td>Public activity ticker lines, such as &ldquo;@handle published …&rdquo;</td>
              <td>Live Board activity and catch-up after a reconnect</td>
              <td>Public.</td>
            </tr>
          </tbody>
        </table>
        <p>
          We do not use analytics, advertising trackers or third-party cookies. Server
          logs may record requests and errors; they are used for security and debugging
          and are kept by the hosting platform&rsquo;s log service.
        </p>
      </section>

      <section>
        <h2>Who processes it</h2>
        <ul>
          <li>
            <strong>Email delivery.</strong> Amazon SES sends sign-in links in the
            documented production setup. Local development uses a local Mailpit inbox and
            sends nothing externally.
          </li>
          <li>
            <strong>Model providers.</strong> When a Challenger Response is generated, the
            Comparison&rsquo;s Prompt and the fixed generation parameters are sent to the
            configured OpenAI-compatible provider (OpenRouter is the first adapter). The
            Base output you uploaded is <strong>not</strong> sent to the provider.
          </li>
          <li>
            <strong>Hosting.</strong> The documented production target is AWS: web and
            worker containers, a relational database, a Redis queue and logs in
            CloudWatch. Locally, data stays on the operator&rsquo;s machine.
          </li>
        </ul>
        <p>We do not sell personal data.</p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Email and handle</td>
              <td>Until you delete your account; both are erased and released then.</td>
            </tr>
            <tr>
              <td>
                Anonymised account row (id, role, join date, deleted_at; no email,
                handle, name or avatar)
              </td>
              <td>
                Retained after deletion solely to attribute published Comparisons to
                &ldquo;[deleted]&rdquo; and keep them readable.
              </td>
            </tr>
            <tr>
              <td>Magic-link token</td>
              <td>15 minutes, single use; reused or expired tokens are rejected.</td>
            </tr>
            <tr>
              <td>Session</td>
              <td>Up to 7 days, or until you sign out or delete the account.</td>
            </tr>
            <tr>
              <td>Unpublished Comparisons (Drafts, generating and ready work)</td>
              <td>
                Until you delete the Comparison or your account. Deleting the account
                removes them, their uploaded Base outputs and their generated Responses.
              </td>
            </tr>
            <tr>
              <td>Published Comparisons and generated Responses</td>
              <td>
                While the Comparison exists. Deleting your account keeps published
                Comparisons on the Board under an anonymous attribution. If you need a
                published Comparison removed after deleting your account, write to{' '}
                <strong>[contact email]</strong>.
              </td>
            </tr>
            <tr>
              <td>Discussion comments, Annotations and thread messages</td>
              <td>
                While the Comparison exists. Deleting a Discussion comment leaves a
                tombstone with an empty body so replies keep their place. Deleting an
                Annotation removes its highlight and thread. Deleting your account
                applies the same rules to everything you wrote.
              </td>
            </tr>
            <tr>
              <td>Votes, notifications and reports you filed</td>
              <td>Until you delete your account.</td>
            </tr>
            <tr>
              <td>Public activity ticker lines</td>
              <td>
                Kept for the live Board and catch-up after a reconnect. Lines for content or an
                account that is removed are deleted. There is no scheduled pruning job
                yet; the retained window is the database&rsquo;s full history.
              </td>
            </tr>
            <tr>
              <td>Moderation and Admin audit records</td>
              <td>
                Retained after an account is deleted for accountability. They record the
                action, target and reason, never an email address.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>
            <strong>Export.</strong> <Link href="/account">Account</Link> has a download that
            returns your profile, Comparisons, comments, Annotations, votes and
            notifications as JSON. Other people&rsquo;s emails and words are excluded.
          </li>
          <li>
            <strong>Delete.</strong> Account deletion erases your email, handle, sessions,
            votes and notifications and deletes unpublished work. Published Comparisons
            stay under <strong>[deleted]</strong>; your Discussion comments become
            tombstones so replies stay readable, and your Annotations are removed with
            their threads. Your handle and email are released for reuse. The action is
            immediate and cannot be undone.
          </li>
          <li>
            <strong>Corrections and questions.</strong> Write to{' '}
            <strong>[contact email]</strong>. Depending on where you live, you may also
            have rights to access, correct, restrict or object to processing, and to
            complain to a data protection authority.
          </li>
        </ul>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Sessions are cookie-based and HTTP-only. Sign-in links are single use and stored
          only as a hash. Email addresses are never rendered on public pages, raw HTML in
          uploads is escaped, and provider API keys live in environment variables or a
          secrets manager rather than the database.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          Material changes to this policy will be announced on the service before they
          take effect, with an updated date at the top. See also the{' '}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>
    </LegalShell>
  );
}
