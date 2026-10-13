import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './lib/i18n';
import { ApiProblem } from './lib/api';
import { AuthProvider } from './lib/auth';
import { startOutboxSync } from './lib/offline';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Never retry auth or validation errors; retry network blips twice.
      retry: (count, err) => !(err instanceof ApiProblem && err.status < 500) && count < 2,
    },
  },
});

registerSW({ immediate: true });
startOutboxSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
