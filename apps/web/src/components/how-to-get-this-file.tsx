import Link from 'next/link';
import { DownloadSimple, ArrowSquareOut, Question } from '@phosphor-icons/react/dist/ssr';
import {
  AI_EXPORTER_CHROME_STORE_URL,
  EXPORT_GUIDE_PATH,
  SAMPLE_EXPORT_NAME,
  SAMPLE_EXPORT_PATH,
} from '@/lib/export-guidance';

/**
 * The upload tab has to answer "where does this file come from?" before an
 * author can pick one. The three steps summarise the export guide so the form
 * does not make an author hunt for the extension.
 */
export function HowToGetThisFile() {
  return (
    <section
      aria-labelledby="how-to-get-this-file"
      className="flex flex-col gap-2 rounded-[2px] border border-neutral-800 bg-surface p-3"
    >
      <div className="flex items-center gap-[6px]">
        <Question size={13} className="flex-none text-accent-300" />
        <h2
          id="how-to-get-this-file"
          className="m-0 font-heading text-[12px] font-medium"
        >
          How to get this file
        </h2>
      </div>

      <ol className="m-0 flex list-decimal flex-col gap-[4px] pl-4 text-[11.5px] font-normal leading-[1.5] text-neutral-300">
        <li>
          Install{' '}
          <a
            href={AI_EXPORTER_CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[3px] font-medium text-accent-300 hover:text-accent-200"
          >
            AI Exporter from the Chrome Web Store
            <ArrowSquareOut size={10} aria-hidden />
          </a>{' '}
          in Chrome, Edge or another Chromium browser.
        </li>
        <li>
          Open the chat you want to compare, click the AI Exporter button and save
          the conversation as Markdown.
        </li>
        <li>
          Upload the <code className="font-mono text-[11px]">.md</code> file here,
          then check every turn before scheduling.
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 pt-2 text-[11px] font-medium">
        <a
          href={SAMPLE_EXPORT_PATH}
          download={SAMPLE_EXPORT_NAME}
          className="inline-flex items-center gap-[4px] text-neutral-300 transition-colors hover:text-accent-200"
        >
          <DownloadSimple size={12} />
          Download a sample export
        </a>
        <Link
          href={EXPORT_GUIDE_PATH}
          className="inline-flex items-center gap-[4px] text-neutral-400 transition-colors hover:text-accent-200"
        >
          Read the export guide
        </Link>
      </div>
    </section>
  );
}
