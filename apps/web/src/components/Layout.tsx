import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCelular } from '../lib/celular';
import { modulosDoUsuario, type Modulo } from '../lib/modulos';
import { useTema } from '../lib/tema';
import { LayoutCelular } from './LayoutCelular';
import { IconeGrade, IconeLua, IconeSol } from './icones';

/**
 * A casca de um módulo — e a escolha de qual delas usar.
 *
 * São duas, e não uma que se dobra: no computador a navegação é uma barra
 * lateral sempre aberta, no celular é uma barra no rodapé com o resto do menu
 * numa folha que sobe (ver o `LayoutCelular`). Elas não são a mesma coisa
 * espremida — a lateral escondida atrás de um botão flutuante era o que havia
 * antes, e cobrava dois toques e um `pt-20` em toda página do sistema para
 * chegar a qualquer lugar.
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
 * Ela continua escura no tema escuro, e por isso usa branco com transparência
 * em vez da escala `tinta`: essa escala vira do avesso lá, e o que aqui é
 * texto legível sobre fundo escuro viraria escuro sobre escuro.
 *
 * Aqui ela está **sempre** aberta: este componente só é montado acima da
 * divisa do celular, e a gaveta que existia para as telas estreitas virou a
 * barra de baixo do `LayoutCelular`.
 */
function LayoutComputador({ modulo }: { modulo: Modulo }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const { escuro, trocar } = useTema();

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-tinta-50">
      <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col bg-barra">
        <div className="px-6 pb-6 pt-7">
          {/* A logo tem fundo transparente e vive bem sobre a tinta escura —
              o azul dela é claro o bastante para se ler aqui. */}
          <img
            src="/logo-ilnet.png"
            alt="ilnet"
            width={120}
            height={74}
            className="h-auto w-[104px]"
          />
          <div className="mt-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
            {modulo.nome}
          </div>
        </div>

        <NavLink
          to="/modulos"
          className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-2 text-[12px] font-medium text-white/70 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
        >
          <IconeGrade className="text-white/40" />
          Trocar de módulo
        </NavLink>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {modulo.menu
            .filter((item) => !item.somenteAdmin || usuario?.role === 'ADMIN')
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-150 ${
                    isActive
                      ? 'bg-white/[0.07] text-white'
                      : 'text-white/70 hover:bg-white/[0.04] hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition-all duration-200 ${
                        isActive ? 'opacity-100' : 'scale-y-0 opacity-0'
                      }`}
                    />
                    <item.icone
                      className={
                        isActive
                          ? 'text-brand-400'
                          : 'text-white/40 group-hover:text-white/70'
                      }
                    />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
        </nav>

        <div className="m-3 rounded-xl bg-white/[0.04] p-3.5">
          {/* O caminho é o deste módulo, e não o da folha: quem não abre a
              folha caía num módulo trancado ao clicar no próprio nome. */}
          <NavLink
            to={`${modulo.base}/minha-conta`}
            className="flex items-center gap-2.5 rounded-lg transition hover:opacity-80"
            title="Minha conta"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-xs font-semibold text-brand-300">
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-medium text-white">
                {usuario?.nome}
              </div>
              <div className="truncate text-[11px] text-white/45">
                {usuario?.email}
              </div>
            </div>
          </NavLink>
          <div className="mt-3 flex gap-2">
            <button
              onClick={sair}
              className="flex-1 rounded-lg border border-white/10 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
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
              className="rounded-lg border border-white/10 px-2.5 text-white/70 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            >
              {escuro ? <IconeSol /> : <IconeLua />}
              <span className="sr-only">
                {escuro ? 'Tema claro' : 'Tema escuro'}
              </span>
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
