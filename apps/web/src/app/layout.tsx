import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from './providers/query-provider';

export const metadata: Metadata = {
  title: 'Messenger MVP',
  description: 'Local messenger MVP client',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
