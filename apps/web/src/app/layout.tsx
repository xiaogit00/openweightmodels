import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const space = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-space',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OpenWeightModels',
  description: 'Community comparisons of open-weight model outputs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${space.variable}`}>
      <body>{children}</body>
    </html>
  );
}
