import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/query-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "UCSC ITS Support AI",
  description:
    "Retrieval-augmented chatbot for the UCSC ITS Knowledge Base with grounded citations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable}`}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
