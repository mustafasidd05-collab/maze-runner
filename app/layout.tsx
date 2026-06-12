// app/layout.tsx
import "tailwindcss";
import type { ReactNode } from "react";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        
        {/* Animated Background */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-black" />

          <div className="absolute top-0 left-0 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl animate-pulse" />

          <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl animate-pulse" />

          <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/10 blur-3xl animate-pulse" />
        </div>

        {/* Game Container */}
        <div className="relative min-h-screen flex items-center justify-center p-4">
          {children}
        </div>
      </body>
    </html>
  );
}