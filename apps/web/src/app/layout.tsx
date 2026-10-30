import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import { SiteFooter } from '@/components/site-footer';
import { THEME_COOKIE, themeFromCookie } from '@/lib/theme';
import './globals.css';

// Self-hosted: next/font/google fetches at build time and both bundlers fail
// intermittently when Google returns an extensionless font URL. See fonts/README.md.
const geist = localFont({
  src: './fonts/geist.woff2',
  weight: '100 900',
  variable: '--font-geist',
  display: 'swap',
});

const spaceGrotesk = localFont({
  src: './fonts/space-grotesk-500.woff2',
  weight: '500',
  variable: '--font-space',
  display: 'swap',
});

const spaceMono = localFont({
  src: './fonts/space-mono-400.woff2',
  weight: '400',
  variable: '--font-space-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OpenWeightModels',
  description: 'Community comparisons of open-weight and frontier model outputs.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookiesStore = await cookies();
  const theme = themeFromCookie(cookiesStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      className={`${geist.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
