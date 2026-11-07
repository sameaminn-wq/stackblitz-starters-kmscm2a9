import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  // إضافة metadataBase لحل التحذير وضمان عمل الروابط النسبية للصور
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'AI Inventory Intelligence | نظام الجرد الذكي',
  description: 'نظام ذكي لمساعدة المتاجر والمخازن على جرد المنتجات وتحليل المخزون من الصور.',
  openGraph: {
    title: 'AI Inventory Intelligence | نظام الجرد الذكي',
    description: 'نظام ذكي لمساعدة المتاجر والمخازن على جرد المنتجات وتحليل المخزون من الصور.',
    images: [
      {
        url: '/static/og_default.png', // استخدام مسار نسبي أفضل
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/static/og_default.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className={inter.className}>{children}</body>
    </html>
  );
}