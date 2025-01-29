import { Inter } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "./contexts/AuthContext"
import { Header } from "./components/Header"
import { ThemeProvider } from "./components/ThemeProvider"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "VideoConf App",
  description: "Modern video conferencing web application",
}

export default function RootLayout({ children }) {
  return (
    (<html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <AuthProvider>
            <Header />
            <main className="container mx-auto px-4 py-8">{children}</main>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>)
  );
}

