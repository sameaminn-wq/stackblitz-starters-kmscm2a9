/** @type {import('next').NextConfig} */
const nextConfig = {
    // استثناء مكتبة sharp لضمان توافق واستقرار الملفات الثنائية (Linux x64) على خوادم Vercel
    serverExternalPackages: ['sharp'],
  };
  
  module.exports = nextConfig;