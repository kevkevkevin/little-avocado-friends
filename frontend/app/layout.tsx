// frontend/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Providers from './providers'; // <--- Import this

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Little Avocado Friends',
  description: 'A massive multiplayer experiment, be an avocado! save planet earth thile enjoying fun games with friends!',icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🥑</text></svg>",
  },
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