"use client";

import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./contexts/AuthContext";
import { Header } from "./components/Header";
import { ThemeProvider } from "./components/ThemeProvider";
import { MeetingProvider } from "./contexts/MeetingContext";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <AuthProvider>
            <MeetingProvider>
              <Header />
              <main className="container mx-auto px-4 py-8">{children}</main>
            </MeetingProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
