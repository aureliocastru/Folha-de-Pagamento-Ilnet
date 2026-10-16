import { Suspense } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAvisosDoMenu } from '../lib/avisos';
import { useAuth } from '../lib/auth';
import { useCelular } from '../lib/celular';
import { itemDoMenuAparece, modulosDoUsuario, type Modulo } from '../lib/modulos';
import { useTema } from '../lib/tema';
import { LayoutCelular } from './LayoutCelular';
import { IconeGrade, IconeLua, IconeSol } from './icones';
import { Carregando, PontoDeAviso } from './ui';
import { TelaProtegida } from './TelaProtegida';

/**
 * A casca de um módulo — e a escolha de qual delas usar.
 *
 * São duas: no computador a navegação é uma barra lateral sempre aberta; no
 * celular é a mesma barra guardada numa gaveta que a logo abre (ver o
 * `LayoutCelular`). O conteúdo fica com a tela inteira nos dois casos — no
 * celular não há mais barra de baixo, e nenhuma página reserva alto nem
 * rodapé para a navegação.
 *
 * A divisa é a largura da janela, em `LARGURA_CELULAR`, e é a mesma em que a
 * barra lateral aparece. Ninguém escolhe nada: o aparelho já respondeu.
 */
export function Layout({ modulo }: { modulo: Modulo }) {
  const { usuario } = useAuth();
  const celular = useCelular();

  /*
   * Módulo que este login não abre não se mostra nem pelo endereço direto.
   *
   * Quem recusa de verdade é a API — cada rota dela confere a lista —, mas uma
   * tela que carrega para depois encher de "sem acesso" é pior que não abrir:
   * de volta à escolha de módulos, que é onde a pessoa consegue fazer algo.
   *
   * Fica aqui em cima, antes da escolha da casca: a conta é a mesma nas duas.
   */
  const abre = modulosDoUsuario(usuario).some((m) => m.id === modulo.id);
  if (usuario && !abre) return <Navigate to="/modulos" replace />;

  return celular ? (
    <LayoutCelular modulo={modulo} />
  ) : (
    <LayoutComputador modulo={modulo} />
  );
}

/**
 * A casca do computador. A barra lateral é tinta escura para o conteúdo — onde
 * moram os números — ficar sendo a única coisa clara e disputada da tela. Os
 * itens vêm do módulo: a casca é a mesma para todos.
 *
 * Enxuta de propósito: ícone de 16px, texto de 13px, item baixo. Era tudo um
 * número maior, e a barra disputava atenção com a tela (16/10/2026).
 *
 * Ela continua escura no tema escuro, e por isso usa branco com transparência
 * em vez da escala `tinta`: essa escala vira do avesso lá, e o que aqui é
 * texto legível sobre fundo escuro viraria escuro sobre escuro.
 *
 * Aqui ela está **sempre** aberta: este componente só é montado acima da
 * divisa do celular. Abaixo dela é a mesma barra, na gaveta do
 * `LayoutCelular`.
 */
function LayoutComputador({ modulo }: { modulo: Modulo }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const { escuro, trocar } = useTema();
  const avisos = useAvisosDoMenu(modulo);

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-fundo">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-white/[0.06] bg-barra">
        <div className="px-5 pb-5 pt-6">
          {/* A logo tem fundo transparente e vive bem sobre a tinta escura —
              o azul dela é claro o bastante para se ler aqui. */}
          <img
            src="/logo-ilnet.png"
            alt="ilnet"
            width={120}
            height={74}
            className="h-auto w-[84px]"
          />
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
            {modulo.nome}
          </div>
        </div>

        <NavLink
          to="/modulos"
          className="mx-3 mb-4 flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-white/60 ring-1 ring-inset ring-white/[0.07] transition hover:bg-white/[0.08] hover:text-white"
        >
          <IconeGrade className="h-3.5 w-3.5 text-white/40" />
          Trocar de módulo
        </NavLink>

        <nav className="flex-1 space-y-px overflow-y-auto px-3">
          {modulo.menu
            .filter((item) => itemDoMenuAparece(item, usuario))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium leading-5 transition-colors duration-150 ${
                    isActive
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition-all duration-200 ${
                        isActive ? 'opacity-100' : 'scale-y-0 opacity-0'
                      }`}
                    />
                    <item.icone
                      className={`h-4 w-4 shrink-0 ${
                        isActive
                          ? 'text-brand-400'
                          : 'text-white/35 group-hover:text-white/60'
                      }`}
                    />
                    {item.label}
                    {avisos[item.to] && (
                      <PontoDeAviso {...avisos[item.to]} className="ml-auto" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
        </nav>

        <div className="mt-2 border-t border-white/[0.06] p-3">
          {/* O caminho é o deste módulo, e não o da folha: quem não abre a
              folha caía num módulo trancado ao clicar no próprio nome. */}
          <NavLink
            to={`${modulo.base}/minha-conta`}
            className="-mx-1 flex items-center gap-2.5 rounded-lg px-1 py-1 transition hover:bg-white/[0.04]"
            title="Minha conta"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-[10px] font-semibold text-brand-300">
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12.5px] font-medium text-white">
                {usuario?.nome}
              </div>
              <div className="truncate text-[11px] text-white/40">
                {usuario?.email}
              </div>
            </div>
          </NavLink>
          <div className="mt-2.5 flex gap-1.5">
            <button
              onClick={sair}
              className="flex-1 rounded-md py-1 text-[11px] font-semibold uppercase tracking-wider text-white/60 ring-1 ring-inset ring-white/10 transition hover:bg-white/5 hover:text-white"
            >
              Sair
            </button>
            {/* A escolha fica gravada neste navegador. Quem não escolhe segue o
                sistema — é o que já está configurado no aparelho. */}
            <button
              onClick={() => trocar(escuro ? 'claro' : 'escuro')}
              aria-pressed={escuro}
              title={
                escuro
                  ? 'Voltar para o tema claro'
                  : 'Trocar para o tema escuro'
              }
              className="rounded-md px-2 text-white/60 ring-1 ring-inset ring-white/10 transition hover:bg-white/5 hover:text-white"
            >
              {escuro ? (
                <IconeSol className="h-3.5 w-3.5" />
              ) : (
                <IconeLua className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">
                {escuro ? 'Tema claro' : 'Tema escuro'}
              </span>
            </button>
          </div>
          <p className="mt-2 text-[10px] text-white/30">Versão de {__VERSAO__}</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1" data-modulo={modulo.id}>
        {/* A tela vem sob demanda (`telaSobDemanda`) e o erro dela fica nela: o
            menu fica de pé enquanto ela chega, e se ela quebrar. */}
        <TelaProtegida>
          <Suspense fallback={<Carregando />}>
            <Outlet />
          </Suspense>
        </TelaProtegida>
      </main>
    </div>
  );
}
