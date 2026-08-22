import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, clearToken, getToken, setToken } from './api';
import type { Usuario } from './types';

interface AuthState {
  usuario: Usuario | null;
  carregando: boolean;
  /**
   * Devolve quem entrou. É o que a tela de login usa para saber para onde
   * mandar a pessoa — o estado do contexto só chega no render seguinte, e
   * navegar antes dele levaria todo mundo para o mesmo lugar.
   */
  login: (email: string, senha: string) => Promise<Usuario>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setCarregando(false);
      return;
    }
    api
      .get<Usuario>('/auth/me')
      .then((res) => setUsuario(res.data))
      .catch(() => clearToken())
      .finally(() => setCarregando(false));
  }, []);

  async function login(email: string, senha: string) {
    const res = await api.post<{ accessToken: string; usuario: Usuario }>(
      '/auth/login',
      { email, senha },
    );
    setToken(res.data.accessToken);
    setUsuario(res.data.usuario);
    return res.data.usuario;
  }

  function logout() {
    clearToken();
    setUsuario(null);
  }

  const value = useMemo(
    () => ({ usuario, carregando, login, logout }),
    [usuario, carregando],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve estar dentro de AuthProvider');
  return ctx;
}
