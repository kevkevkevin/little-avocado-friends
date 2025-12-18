// frontend/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Providers from './providers'; // <--- Import this

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Solana Community Clicker',
  description: 'A massive multiplayer experiment',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Wrap everything inside Providers */}
        <Providers>
            {children}
        </Providers>
      </body>
    </html>
  );
}