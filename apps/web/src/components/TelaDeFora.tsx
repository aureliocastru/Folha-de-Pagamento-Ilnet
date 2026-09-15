import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { caminhoDaConta } from '../lib/modulos';
import { IconeChave } from './icones';

/**
 * O cabeçalho escuro de fora dos módulos: a marca, e à direita quem está logado.
 *
 * É o da tela de módulos, e é também o de Usuários: gerenciar logins não é de
 * módulo nenhum — morava na Folha só por ter nascido lá, e quem cuida dos
 * acessos do almoxarifado tinha de entrar na folha de pagamento para achar.
 */
export function CabecalhoDeFora({ voltarParaModulos = false }: { voltarParaModulos?: boolean }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    /* pr generoso: o bloco de notas mora encostado nesta quina, e sem folga o
       "Sair" ficava debaixo dele. */
    <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-barra py-4 pl-4 pr-14 sm:gap-4 sm:py-5 sm:pl-10 sm:pr-20">
      <div className="flex items-center gap-3.5">
        <Link to="/modulos" title="Voltar para a escolha de módulos">
          <img src="/logo-ilnet.png" alt="ilnet" width={110} height={68} className="h-auto w-[92px]" />
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
          Finance
        </span>
        {voltarParaModulos && (
          <Link
            to="/modulos"
            className="ml-1 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium text-white/70 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
          >
            ‹ Módulos
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Só o administrador distribui acesso — para os outros o botão nem
            existe, e a API recusa do mesmo jeito. */}
        {usuario?.role === 'ADMIN' && !voltarParaModulos && (
          <Link
            to="/usuarios"
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
          >
            <IconeChave className="h-4 w-4 text-white/50" />
            Usuários
          </Link>
        )}
        <Link
          to={caminhoDaConta(usuario)}
          className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-white/5"
          title="Minha conta"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-xs font-semibold text-brand-300">
            {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden text-[13px] font-medium text-white sm:block">{usuario?.nome}</span>
        </Link>
        <button
          onClick={sair}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
        >
          Sair
        </button>
      </div>
    </header>
  );
}

/** Uma tela de fora dos módulos: o cabeçalho escuro, e o conteúdo no fundo claro. */
export function TelaDeFora({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-tinta-50">
      <CabecalhoDeFora voltarParaModulos />
      {children}
    </div>
  );
}
