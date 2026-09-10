import axios from 'axios';

/**
 * O cliente do portal de pontos.
 *
 * É outro, e não o `api` do sistema, por dois motivos. O token é outro — o do
 * coordenador, que não abre o sistema. E o `api` do sistema, ao levar um 401,
 * apaga o login e manda para `/login`: aqui um 401 quer dizer "entre de novo
 * com o CPF e a senha", e quem está no portal não tem nada a fazer na tela de
 * login do sistema.
 */
const CHAVE = 'pontos.token';

export const tokenDoPortal = {
  ler: () => {
    try {
      return localStorage.getItem(CHAVE);
    } catch {
      return null;
    }
  },
  gravar: (t: string) => {
    try {
      localStorage.setItem(CHAVE, t);
    } catch {
      // Navegador que recusa armazenamento: o login vale só até recarregar.
    }
  },
  apagar: () => {
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      // idem
    }
  },
};

export const apiPontos = axios.create({
  baseURL: (import.meta.env.VITE_API_URL ?? '') + '/api',
});

apiPontos.interceptors.request.use((config) => {
  const token = tokenDoPortal.ler();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** "52998224725" → "529.982.247-25", enquanto se digita. */
export function mascararCpf(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}
