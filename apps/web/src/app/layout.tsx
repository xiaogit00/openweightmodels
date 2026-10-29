import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Geist, Space_Grotesk, Space_Mono } from 'next/font/google';
import { SiteFooter } from '@/components/site-footer';
import { THEME_COOKIE, themeFromCookie } from '@/lib/theme';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-geist',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-space',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400'],
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
