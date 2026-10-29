import Link from 'next/link';
import { ArrowRight, DownloadSimple, ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { SiteHeader } from '@/components/site-header';
import { getCurrentUser } from '@/lib/auth';
import {
  AI_EXPORTER_CHROME_STORE_URL,
  CONVERSATION_LIMITS,
  SAMPLE_EXPORT_NAME,
  SAMPLE_EXPORT_PATH,
} from '@/lib/export-guidance';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'How to export a chat — OpenWeightModels',
  description:
    'Export a ChatGPT, Claude or DeepSeek conversation as markdown with AI Exporter, then upload it as a comparison.',
};

const EXAMPLE = `> From: https://chat.deepseek.com/a/chat/s/…

# you asked

message time: 2026-10-28 13:08:00

Which environment variable holds the key?

---

# deepseek response

message time: 2026-10-28 13:08:04

Use OPENROUTER_API_KEY for the key itself.

---

Powered by [AI Exporter](https://saveai.net)`;

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="grid h-5 w-5 flex-none place-items-center rounded-[2px] border border-accent-700 text-[10.5px] font-medium text-accent-200"
      >
        {number}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </li>
  );
}

export default async function ExportGuidePage() {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={user?.handle ?? null}
        signedIn={user !== null}
        variant="page"
        showNew={false}
      />

      <main className="mx-auto w-full max-w-[680px] px-5 py-12">
        <div className="flex flex-col gap-1.5">
          <span className="micro-label uppercase">Guide</span>
          <h1 className="m-0 font-heading text-[20px] font-medium leading-[1.2]">
            How to export a chat
          </h1>
          <p className="m-0 text-[11px] text-neutral-500">
            Turn a conversation into the markdown file this site compares.
          </p>
        </div>

        <div className="legal-prose mt-6 flex flex-col gap-6 text-[12.5px] leading-[1.65] text-neutral-300">
          <section>
            <p>
              A comparison starts from one of your own conversations with a model.
              The file comes from{' '}
              <a
                href={AI_EXPORTER_CHROME_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-[3px] font-medium text-accent-300 hover:text-accent-200"
              >
                AI Exporter
                <ArrowSquareOut size={11} aria-hidden />
              </a>
              , a free browser extension. It saves the alternating prompts and
              replies as markdown, which we read back as turns.
            </p>
          </section>

          <section>
            <h2>Export the conversation</h2>
            <ol className="!list-none !pl-0">
              <Step number={1} title="Install AI Exporter">
                Add the extension from the Chrome Web Store. It also works in Edge
                and other Chromium browsers.
              </Step>
              <Step number={2} title="Open the chat and export it">
                Go to the conversation you want to compare in ChatGPT, Claude,
                DeepSeek, Gemini or another supported chat. Click the AI Exporter
                button and choose <strong>Markdown</strong>.
              </Step>
              <Step number={3} title="Upload the .md file">
                On{' '}
                <Link href="/new" className="font-medium text-accent-300 hover:text-accent-200">
                  New comparison
                </Link>
                , drop the downloaded file into the base-output step. Check every
                turn in the confirmation before you schedule the comparison.
              </Step>
            </ol>
          </section>

          <section>
            <h2>What the file looks like</h2>
            <p>
              AI Exporter writes a source line, then alternating{' '}
              <code className="font-mono text-[11.5px]"># you asked</code> and{' '}
              <code className="font-mono text-[11.5px]"># &lt;model&gt; response</code>{' '}
              sections. The <code className="font-mono text-[11.5px]">message time:</code>{' '}
              lines, <code className="font-mono text-[11.5px]">---</code> separators
              and the exporter footer are decoration: we remove them before saving.
              The chat URL is never stored.
            </p>
            <pre className="code-block text-[11.5px]">{EXAMPLE}</pre>
          </section>

          <section>
            <h2>Limits</h2>
            <ul>
              <li>
                <strong>{CONVERSATION_LIMITS.turns} turns</strong> per comparison. A
                turn is one prompt and the reply it got.
              </li>
              <li>
                <strong>{CONVERSATION_LIMITS.megabytes} MB</strong> for the uploaded
                file.
              </li>
              <li>
                <strong>{CONVERSATION_LIMITS.characters} characters</strong> across all
                prompts and replies. The confirmation shows the estimate before
                anything is scheduled.
              </li>
            </ul>
            <p>
              A plain markdown file, or one with <code className="font-mono text-[11.5px]">prompt:</code>{' '}
              front-matter, still works as a one-turn comparison. Those formats have
              no turn boundaries, so the whole body becomes the Base output.
            </p>
          </section>

          <section>
            <h2>If the upload is refused</h2>
            <p>
              Every error names the problem and what to do next. These are the
              common ones:
            </p>
            <table>
              <thead>
                <tr>
                  <th>What you see</th>
                  <th>How to fix it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>“Turn 3 has no reply from Claude.”</td>
                  <td>
                    Make sure every prompt has a reply in the chat, re-export the
                    conversation and upload the new file. Every prompt needs a reply.
                  </td>
                </tr>
                <tr>
                  <td>“Turn 2 has an empty “# you asked” section.”</td>
                  <td>
                    Re-export the conversation and make sure every prompt is included
                    in its <code className="font-mono text-[11.5px]"># you asked</code>{' '}
                    section.
                  </td>
                </tr>
                <tr>
                  <td>“Turn 1 has a reply but no prompt.”</td>
                  <td>
                    Re-export the conversation so every reply follows a{' '}
                    <code className="font-mono text-[11.5px]"># you asked</code>{' '}
                    section.
                  </td>
                </tr>
                <tr>
                  <td>“This file has AI Exporter metadata but no “# you asked” sections.”</td>
                  <td>
                    Export the whole conversation again. The export must contain the
                    alternating <code className="font-mono text-[11.5px]"># you asked</code>{' '}
                    and response sections, not just the page header and footer.
                  </td>
                </tr>
                <tr>
                  <td>“No conversation turns were found.”</td>
                  <td>
                    Re-export the whole conversation, or upload a plain markdown file
                    as a one-turn comparison.
                  </td>
                </tr>
                <tr>
                  <td>“That looks like text pasted straight from a chat window.”</td>
                  <td>
                    Install AI Exporter, export the chat as markdown, and upload the
                    downloaded file instead of copying the text.
                  </td>
                </tr>
                <tr>
                  <td>“Use a .md, .markdown or .txt file.”</td>
                  <td>Export the chat as markdown and upload the downloaded file.</td>
                </tr>
                <tr>
                  <td>“That file does not look like text.” / “That file is not valid UTF-8.”</td>
                  <td>
                    Export the conversation as markdown instead of PDF, DOCX or an
                    image, then upload the .md file.
                  </td>
                </tr>
                <tr>
                  <td>“That file is empty.”</td>
                  <td>Export the conversation again and check the download finished.</td>
                </tr>
                <tr>
                  <td>“Files must be 500 KB or smaller.”</td>
                  <td>
                    Export just the turns you want to compare. Images and attachments
                    are not supported.
                  </td>
                </tr>
                <tr>
                  <td>“A conversation can hold at most 6 turns.”</td>
                  <td>
                    Choose the first {CONVERSATION_LIMITS.turns} turns of the
                    conversation and export those.
                  </td>
                </tr>
                <tr>
                  <td>“A conversation can hold at most 100,000 characters.”</td>
                  <td>
                    Shorten or remove the longest prompts and replies, then export
                    again.
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>Try it without your own chat</h2>
            <p>
              The sample is a complete export of a real DeepSeek conversation, with its
              private source URL redacted, so you can see the exact shape before
              uploading anything private.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={SAMPLE_EXPORT_PATH}
                download={SAMPLE_EXPORT_NAME}
                className="btn-secondary"
              >
                <DownloadSimple size={13} />
                Download a sample export
              </a>
              <Link href="/new" className="btn-primary h-8">
                Start a comparison
                <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
