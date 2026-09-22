import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAvisosDoMenu, type AvisoDoMenu } from '../lib/avisos';
import { itemDoMenuAparece, type ItemMenu, type Modulo } from '../lib/modulos';
import { useTema } from '../lib/tema';
import { IconeGrade, IconeLua, IconeSol } from './icones';
import { PontoDeAviso } from './ui';

/**
 * A casca de um módulo no celular.
 *
 * A do computador é uma barra lateral de 248px sempre aberta. Aqui ela é a
 * mesma barra, guardada numa gaveta que entra pela esquerda — pedido do dono
 * em 22/09/2026: a barra de baixo que havia antes comia uma faixa da tela em
 * toda página, e o módulo só mostra números.
 *
 * Quem a abre é a logo, no canto de sempre. Ela é um botão de verdade, e
 * parece um: moldura, três traços ao lado e o nome do módulo dentro — "o
 * botão tem de ficar claro". Fecha no toque fora, no Esc e ao trocar de tela.
 *
 * Trocar de módulo é o botão de grade no alto, ao lado do nome de quem
 * entrou. Um caminho só para cada coisa: a gaveta leva às telas deste módulo,
 * o botão de cima leva aos outros módulos.
 */
export function LayoutCelular({ modulo }: { modulo: Modulo }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const local = useLocation();
  const [aberta, setAberta] = useState(false);
  const { escuro, trocar } = useTema();
  const avisos = useAvisosDoMenu(modulo);

  const itens = modulo.menu.filter((item) => itemDoMenuAparece(item, usuario));
  /** O que há para ver lá dentro: é isto que acende o ponto na logo. */
  const avisoGuardado = itens.reduce(
    (total, item) => total + (avisos[item.to]?.quantos ?? 0),
    0,
  );

  /*
   * A gaveta fecha ao trocar de tela.
   *
   * O `NavLink` de dentro dela navega sem desmontar este componente — sem isto
   * a pessoa tocaria em "Impostos", a tela mudaria por baixo e a gaveta
   * continuaria aberta por cima dela, cobrindo o que ela acabou de pedir.
   */
  useEffect(() => setAberta(false), [local.pathname]);

  // Rolar a lista de contas por trás da gaveta aberta tira do lugar o que se
  // estava lendo. É o mesmo cuidado da `Janela`.
  useEffect(() => {
    if (!aberta) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberta]);

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-tinta-50">
      {/* pr-12: o bloco de notas fica grudado nesta quina, e sem a folga ele
          cairia em cima do nome do módulo. */}
      <header className="sticky top-0 z-20 border-b border-tinta-200 bg-papel/95 pl-3 pr-12 backdrop-blur">
        <div className="flex h-[52px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setAberta(true)}
            aria-expanded={aberta}
            aria-label={`Abrir o menu de ${modulo.nome}`}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-tinta-200 bg-tinta-100/60 py-1.5 pl-2 pr-2.5 text-left transition active:bg-tinta-100"
          >
            <span className="relative flex flex-col justify-center gap-[3px] px-0.5">
              <span className="h-[2px] w-4 rounded-full bg-tinta-500" />
              <span className="h-[2px] w-4 rounded-full bg-tinta-500" />
              <span className="h-[2px] w-4 rounded-full bg-tinta-500" />
              <PontoDeAviso
                quantos={avisoGuardado}
                oQue="aviso"
                className="absolute -right-2 -top-1.5"
              />
            </span>
            <img
              src="/logo-ilnet.png"
              alt="ilnet"
              width={92}
              height={57}
              className="h-auto w-[52px] shrink-0"
            />
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-tinta-500">
              {modulo.nome}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-2">
            {/* A saída para os outros módulos mora aqui, e só aqui: ao lado do
                nome de quem entrou, no alto, onde a mão já vai. Dentro da
                gaveta ela era um segundo caminho para o mesmo lugar. */}
            <NavLink
              to="/modulos"
              title="Trocar de módulo"
              aria-label="Trocar de módulo"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-tinta-200 bg-tinta-100/60 text-tinta-500 transition active:bg-tinta-100"
            >
              <IconeGrade />
            </NavLink>
            <NavLink
              to={`${modulo.base}/minha-conta`}
              title="Minha conta"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 font-display text-[11px] font-semibold text-brand-700 dark:text-brand-300"
            >
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </NavLink>
          </div>
        </div>
      </header>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>

      {aberta && (
        <GavetaDoModulo
          modulo={modulo}
          itens={itens}
          avisos={avisos}
          escuro={escuro}
          onTema={() => trocar(escuro ? 'claro' : 'escuro')}
          onSair={sair}
          onFechar={() => setAberta(false)}
        />
      )}
    </div>
  );
}

/**
 * O menu do módulo, inteiro, numa gaveta.
 *
 * Inteiro de propósito: a barra de baixo mostrava quatro itens e escondia o
 * resto atrás de "Mais", e o que estava escondido — a conferência dos
 * veículos, por exemplo — não acendia aviso nenhum à vista. Aqui tudo está na
 * mesma lista, e o ponto do que espera alguém aparece na própria linha.
 *
 * Os itens são linhas de 52px, do tamanho do dedo, e não uma grade de ícones:
 * ler o nome é mais rápido que reconhecer um desenho.
 */
function GavetaDoModulo({
  modulo,
  itens,
  avisos,
  escuro,
  onTema,
  onSair,
  onFechar,
}: {
  modulo: Modulo;
  itens: ItemMenu[];
  avisos: Record<string, AvisoDoMenu>;
  escuro: boolean;
  onTema: () => void;
  onSair: () => void;
  onFechar: () => void;
}) {
  const { usuario } = useAuth();

  // Esc fecha, como em toda janela desta casa.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Tocar fora fecha, ao contrário da `Janela`: não há trabalho nenhum
          guardado numa lista de links. */}
      <div onClick={onFechar} aria-hidden className="absolute inset-0 bg-barra/60 backdrop-blur-sm" />

      <div className="gaveta-entra rolagem-fina relative flex w-[86%] max-w-[320px] flex-col overflow-y-auto overflow-x-clip border-r border-white/10 bg-barra pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <div className="flex items-start justify-between gap-2 px-4 pb-4 pt-5">
          <div className="min-w-0">
            <img
              src="/logo-ilnet.png"
              alt="ilnet"
              width={120}
              height={74}
              className="h-auto w-[92px]"
            />
            <div className="mt-2 truncate text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
              {modulo.nome}
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar o menu"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/60 transition active:bg-white/10"
          >
            <IconeFechar />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-3" aria-label={`Menu de ${modulo.nome}`}>
          {itens.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition ${
                  isActive ? 'bg-white/[0.07] text-white' : 'text-white/70'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <item.icone className={isActive ? 'text-brand-400' : 'text-white/40'} />
                  {item.label}
                  {avisos[item.to] && (
                    <PontoDeAviso {...avisos[item.to]} className="ml-auto" />
                  )}
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
            className="flex items-center gap-2.5"
            title="Minha conta"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-xs font-semibold text-brand-300">
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] font-medium text-white">
                {usuario?.nome}
              </span>
              <span className="block truncate text-[11px] text-white/45">
                {usuario?.email}
              </span>
            </span>
          </NavLink>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onSair}
              className="flex-1 rounded-lg border border-white/10 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/70 transition active:bg-white/5"
            >
              Sair
            </button>
            <button
              type="button"
              onClick={onTema}
              aria-pressed={escuro}
              title={escuro ? 'Voltar para o tema claro' : 'Trocar para o tema escuro'}
              className="rounded-lg border border-white/10 px-3 text-white/70 transition active:bg-white/5"
            >
              {escuro ? <IconeSol /> : <IconeLua />}
              <span className="sr-only">{escuro ? 'Tema claro' : 'Tema escuro'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** O × da gaveta. Fica aqui porque não é ícone de módulo nenhum. */
function IconeFechar() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
