import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './styles.css';

export const metadata: Metadata = {
  title: "Fool's Gold Club",
  description: 'A private free-play sportsbook and casino using virtual, non-redeemable points.',
};

export const viewport: Viewport = {
  themeColor: '#080c0a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
