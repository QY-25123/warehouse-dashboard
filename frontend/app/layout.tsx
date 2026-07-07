import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { Navigation } from '@/components/Navigation';
import { OnboardingTour } from '@/components/OnboardingTour';

export const metadata: Metadata = {
  title: 'Warehouse Dashboard',
  description: 'Real-time warehouse operations dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <AuthProvider>
          <Navigation />
          <OnboardingTour />
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
