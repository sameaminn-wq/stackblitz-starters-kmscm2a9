import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lamha.inventory',
  appName: 'Lamha AI Smart Inventory',
  webDir: 'out',
  bundledWebRuntime: false,
  // 🔽 هذا الجزء يجب أن يكون داخل الأقواس ليعمل بشكل صحيح
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*']
  }
};

export default config;