import type { Metadata, Viewport } from "next"
import "./globals.css"
import { MobileGestureGuard } from "./providers/mobile-gesture-guard"
import { QueryProvider } from "./providers/query-provider"

export const metadata: Metadata = {
  title: "SweetyCall",
  description: "Онлайн-мессенджер для общения и видеозвонков",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <MobileGestureGuard />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
