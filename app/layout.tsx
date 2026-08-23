import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../styles/tokens.css';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  // Section routes set their own short title ('Mockup', 'Library'…) and the
  // template gives them the product name.
  title: {
    default: 'motion-studio-open',
    template: '%s · motion-studio-open',
  },
  description: 'motion-studio-open — an open-source factory for quick videos and GIFs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            const saved = JSON.parse(localStorage.getItem('motion-ui-preferences') || '{}');
            document.documentElement.dataset.theme = saved.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
          } catch (_) {}
        ` }} />
        {/* Share Tech Mono — glyph set used by the 3D ASCII effect */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
      </head>
      <body className={inter.variable}>
        {children}
      </body>
    </html>
  );
}
