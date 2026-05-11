/** @type {import('next').NextConfig} */
const nextConfig = {
    // 1. التصدير الثابت: ضروري جداً ليعمل الـ APK بدون سيرفر
    output: 'export',
  
    // 2. الصور: تعطيل التحسين التلقائي لأنه يحتاج لسيرفر Node.js
    images: {
      unoptimized: true,
    },
  
    // 3. تجاوز الأخطاء: هذا هو الجزء الذي سألته عنه، يجب أن يكون هنا
    // لضمان استمرار البناء حتى لو وجد TypeScript أو ESLint مشاكل بسيطة
    typescript: {
      ignoreBuildErrors: true,
    },
    eslint: {
      ignoreDuringBuilds: true,
    },
  
    // 4. إجراءات أمنية: حماية التطبيق ومنع تسريب معلومات السيرفر
    poweredByHeader: false,
    reactStrictMode: true,
  };
  
  module.exports = nextConfig;