import axios from 'axios';

const TOKEN_KEY = 'folha.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Base do frontend: chama /api na mesma origem (proxy do Vite em dev,
// nginx em produção). Pode ser sobrescrito por VITE_API_URL.
const baseURL = (import.meta.env.VITE_API_URL ?? '') + '/api';

export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && getToken()) {
      clearToken();
      if (!location.pathname.startsWith('/login')) {
        location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

/** Extrai mensagem amigável de um erro da API. */
export function mensagemErro(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const m = data?.message;
    if (Array.isArray(m)) return m.join(', ');
    if (m) return m;
    // 504/502 é o nginx desistindo de esperar — o servidor pode ter seguido
    // adiante, e "Request failed with status code 504" não diz isso a ninguém.
    const status = error.response?.status;
    if (status === 504 || status === 502) {
      return (
        'O servidor demorou demais para responder (o IXC deve estar lento). O que foi ' +
        'pedido pode ter continuado lá — confira antes de tentar de novo.'
      );
    }
    return error.message;
  }
  return String(error);
}
