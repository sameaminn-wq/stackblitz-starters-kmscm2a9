import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lamha.inventory',
  appName: 'Lamha AI Smart Inventory',
  webDir: 'out', // تأكد أن هذه القيمة out وليس public
  bundledWebRuntime: false
};

export default config;