import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { BlocoDeNotas } from './components/BlocoDeNotas';
import './index.css';
import { AuthProvider } from './lib/auth';
import { abrirCalendarioAoClicar } from './lib/calendario';

abrirCalendarioAoClicar();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          {/* Fora das rotas de propósito: o bloco de notas é da pessoa, e não
              da tela. Aqui ele sobrevive à troca de módulo e à navegação — o
              que estava escrito continua escrito — e aparece em tudo que se
              abre depois de entrar. Ver o `BlocoDeNotas`. */}
          <BlocoDeNotas />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
