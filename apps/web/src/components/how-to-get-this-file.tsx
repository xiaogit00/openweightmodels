import Link from 'next/link';
import { ArrowUpRight, DownloadSimple, Info } from '@phosphor-icons/react/dist/ssr';
import {
  AI_EXPORTER_CHROME_STORE_URL,
  EXPORT_GUIDE_PATH,
  SAMPLE_EXPORT_NAME,
  SAMPLE_EXPORT_PATH,
} from '@/lib/export-guidance';

const STEPS = [
  {
    body: (
      <>
        Install{' '}
        <a
          href={AI_EXPORTER_CHROME_STORE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-[3px] font-medium text-accent-300 hover:text-accent-200"
        >
          AI Exporter from the Chrome Web Store
          <ArrowUpRight size={11} aria-hidden />
        </a>{' '}
        in Chrome, Edge or another Chromium browser.
      </>
    ),
  },
  {
    body: (
      <>
        Open the chat you want to compare, click the AI Exporter button and save the
        conversation as Markdown.
      </>
    ),
  },
  {
    body: (
      <>
        Upload the <code className="font-mono text-[12px]">.md</code> file here, then
        check every turn before scheduling.
      </>
    ),
  },
];

/**
 * The upload tab has to answer "where does this file come from?" before an
 * author can pick one. The three steps summarise the export guide so the form
 * does not make an author hunt for the extension.
 */
export function HowToGetThisFile() {
  return (
    <section
      aria-labelledby="how-to-get-this-file"
      className="flex flex-col gap-3.5 rounded-lg bg-surface px-[22px] py-5"
    >
      <div className="flex items-center gap-2">
        <Info size={16} className="flex-none text-neutral-300" aria-hidden />
        <h2
          id="how-to-get-this-file"
          className="m-0 font-body text-[14.5px] font-medium"
        >
          How to get this file
        </h2>
      </div>

      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {STEPS.map((step, index) => (
          <li
            key={index}
            className="flex gap-3 text-[14px] font-normal leading-[1.6] text-neutral-200"
          >
            <span
              aria-hidden
              className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-xs bg-neutral-800 text-[11.5px] font-medium text-neutral-300"
            >
              {index + 1}
            </span>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13.5px]">
        <a
          href={SAMPLE_EXPORT_PATH}
          download={SAMPLE_EXPORT_NAME}
          className="inline-flex items-center gap-1.5 font-medium text-accent-300 transition-colors hover:text-accent-200"
        >
          <DownloadSimple size={14} aria-hidden />
          Download a sample export
        </a>
        <Link
          href={EXPORT_GUIDE_PATH}
          className="inline-flex items-center gap-1.5 text-neutral-300 transition-colors hover:text-text"
        >
          Read the export guide
        </Link>
      </div>
    </section>
  );
}
