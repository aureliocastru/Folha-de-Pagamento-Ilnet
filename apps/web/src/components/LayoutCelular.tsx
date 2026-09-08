import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { ItemMenu, Modulo } from '../lib/modulos';
import { useTema } from '../lib/tema';
import { IconeGrade, IconeLua, IconeSol } from './icones';

/**
 * Quantos itens do módulo cabem na barra de baixo.
 *
 * Quatro, e o quinto lugar é sempre o "Mais". Num aparelho de 360px de largura
 * são 72px por coluna: dá para o ícone, para o rótulo inteiro na maioria dos
 * casos, e para o dedo. Com seis a palavra começa a partir no meio, e uma barra
 * de navegação em que não se lê o destino não é navegação, é adivinhação.
 *
 * A folha tem onze itens e as contas a pagar dez — nenhuma barra caberia todos.
 * O corte não é arbitrário: a ordem do menu já é a ordem de uso, decidida em
 * `modulos.ts`, então os quatro primeiros são os quatro que mais se abrem.
 */
const ITENS_NA_BARRA = 4;

/**
 * A casca de um módulo no celular.
 *
 * A do computador é uma barra lateral de 248px sempre aberta, e ela não cabe
 * aqui: no celular ela virava uma gaveta atrás de um botão flutuante, e todo
 * caminho entre duas telas passava a custar dois toques e uma animação. Pior:
 * o botão morava por cima do conteúdo, e por isso **toda** página do sistema
 * carregava um `pt-20` — cinco centímetros de nada no alto de uma tela de
 * bolso, em todos os módulos.
 *
 * Aqui a navegação é uma barra fixa no rodapé, que é onde o polegar já está, e
 * o que sobra do menu mora numa folha que sobe do pé da tela. O conteúdo ganha
 * a tela inteira de volta.
 */
export function LayoutCelular({ modulo }: { modulo: Modulo }) {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const local = useLocation();
  const [maisAberto, setMaisAberto] = useState(false);
  const { escuro, trocar } = useTema();

  const itens = modulo.menu.filter(
    (item) => !item.somenteAdmin || usuario?.role === 'ADMIN',
  );
  const naBarra = itens.slice(0, ITENS_NA_BARRA);
  const noMais = itens.slice(ITENS_NA_BARRA);

  /*
   * A folha fecha ao trocar de tela.
   *
   * O `NavLink` de dentro dela navega sem desmontar este componente — sem isto
   * a pessoa tocaria em "Impostos", a tela mudaria por baixo e a folha
   * continuaria aberta por cima dela, cobrindo o que ela acabou de pedir.
   */
  useEffect(() => setMaisAberto(false), [local.pathname]);

  // Rolar a lista de contas por trás da folha aberta tira do lugar o que se
  // estava lendo. É o mesmo cuidado da `Janela`.
  useEffect(() => {
    if (!maisAberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [maisAberto]);

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-tinta-50">
      {/* pr-12: o bloco de notas fica grudado nesta quina, e sem a folga ele
          cairia em cima do nome do módulo. */}
      <header className="sticky top-0 z-20 border-b border-tinta-200 bg-papel/95 pl-4 pr-12 backdrop-blur">
        <div className="flex h-[52px] items-center justify-between gap-3">
          <NavLink to="/modulos" className="flex min-w-0 items-center gap-2.5">
            <img
              src="/logo-ilnet.png"
              alt="ilnet"
              width={92}
              height={57}
              className="h-auto w-[64px] shrink-0"
            />
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-tinta-500">
              {modulo.nome}
            </span>
          </NavLink>

          <NavLink
            to={`${modulo.base}/minha-conta`}
            title="Minha conta"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/15 font-display text-[11px] font-semibold text-brand-700 dark:text-brand-300"
          >
            {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
          </NavLink>
        </div>
      </header>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>

      {maisAberto && (
        <FolhaDoMais
          modulo={modulo}
          itens={noMais}
          escuro={escuro}
          onTema={() => trocar(escuro ? 'claro' : 'escuro')}
          onSair={sair}
          onFechar={() => setMaisAberto(false)}
        />
      )}

      {/*
        A barra vive acima do conteúdo (z-30) e abaixo do bloco de notas e das
        janelas (z-40 e z-50): quem abriu um pagamento para conferir não pode
        ter a navegação por cima do valor.

        O `pb` da área segura é o que a mantém acima da faixa do gesto de voltar
        no iPhone e nos Android sem botões — sem ele o último item da barra fica
        debaixo da barrinha do sistema e não atende ao toque.
      */}
      <nav
        className="sticky bottom-0 z-30 border-t border-tinta-200 bg-papel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        aria-label={`Menu de ${modulo.nome}`}
      >
        <div className="flex items-stretch">
          {naBarra.map((item) => (
            <BotaoDaBarra key={item.to} item={item} />
          ))}
          <button
            type="button"
            onClick={() => setMaisAberto((a) => !a)}
            aria-expanded={maisAberto}
            className={`flex flex-1 basis-0 flex-col items-center justify-center gap-1 px-1 py-2 transition ${
              maisAberto
                ? 'text-brand-600 dark:text-brand-300'
                : 'text-tinta-500'
            }`}
          >
            <IconeMais3Pontos />
            <span className="w-full truncate text-center text-[10px] font-semibold leading-none">
              Mais
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}

/**
 * Um destino da barra de baixo.
 *
 * O alvo tem a largura da coluna inteira e 52px de altura — acima dos 44px que
 * um dedo pede —, e é por isso que o botão não encolhe até o ícone: no rodapé
 * de um celular o erro de mira custa a tela errada.
 */
function BotaoDaBarra({ item }: { item: ItemMenu }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `relative flex flex-1 basis-0 flex-col items-center justify-center gap-1 px-1 py-2 transition ${
          isActive ? 'text-brand-600 dark:text-brand-300' : 'text-tinta-500'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* O traço no alto, e não um fundo colorido: numa barra de cinco
              colunas o fundo engorda o item ativo e desalinha os vizinhos. */}
          <span
            className={`absolute inset-x-3 top-0 h-[3px] rounded-b-full bg-brand-500 transition-opacity ${
              isActive ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <item.icone className="h-[19px] w-[19px]" />
          <span className="w-full truncate text-center text-[10px] font-semibold leading-none">
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/**
 * O resto do módulo, e as ações da conta.
 *
 * Sobe do pé da tela porque é de lá que ela foi chamada — o polegar não precisa
 * atravessar o aparelho para escolher. Os itens são linhas de 52px, e não uma
 * grade de ícones: o que se procura aqui já é o item raro do módulo, e ler o
 * nome inteiro é mais rápido que reconhecer um desenho.
 */
function FolhaDoMais({
  modulo,
  itens,
  escuro,
  onTema,
  onSair,
  onFechar,
}: {
  modulo: Modulo;
  itens: ItemMenu[];
  escuro: boolean;
  onTema: () => void;
  onSair: () => void;
  onFechar: () => void;
}) {
  const { usuario } = useAuth();

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      {/* Aqui o toque no fundo fecha, ao contrário da `Janela`: não há trabalho
          nenhum guardado numa lista de links. */}
      <div
        onClick={onFechar}
        className="absolute inset-0 bg-barra/60 backdrop-blur-sm"
      />

      <div className="surgir rolagem-fina relative max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-tinta-200 bg-papel pb-[env(safe-area-inset-bottom)] shadow-2xl">
        {/* A alça: diz que isto sobe do pé da tela e que dá para fechar. */}
        <div className="sticky top-0 z-10 flex justify-center bg-papel pb-2 pt-2.5">
          <span className="h-1 w-10 rounded-full bg-tinta-200" />
        </div>

        <div className="px-3 pb-3">
          <NavLink
            to={`${modulo.base}/minha-conta`}
            className="mb-2 flex items-center gap-3 rounded-xl bg-tinta-100/60 px-3 py-3"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/15 font-display text-xs font-semibold text-brand-700 dark:text-brand-300">
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-tinta-900">
                {usuario?.nome}
              </span>
              <span className="block truncate text-[12px] text-tinta-400">
                {usuario?.email}
              </span>
            </span>
          </NavLink>

          {itens.length > 0 && (
            <div className="lista-dividida">
              {itens.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex min-h-[52px] items-center gap-3 px-2 text-[15px] font-medium transition ${
                      isActive
                        ? 'text-brand-700 dark:text-brand-300'
                        : 'text-tinta-700'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icone
                        className={
                          isActive
                            ? 'h-5 w-5 text-brand-600 dark:text-brand-300'
                            : 'h-5 w-5 text-tinta-400'
                        }
                      />
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <NavLink
              to="/modulos"
              className="btn btn-neutro col-span-2 justify-center"
            >
              <IconeGrade className="h-4 w-4" />
              Trocar de módulo
            </NavLink>
            <button type="button" onClick={onTema} className="btn btn-neutro">
              {escuro ? <IconeSol /> : <IconeLua />}
              {escuro ? 'Tema claro' : 'Tema escuro'}
            </button>
            <button type="button" onClick={onSair} className="btn btn-neutro">
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Os três pontos do "Mais". Fica aqui porque não é ícone de módulo nenhum. */
function IconeMais3Pontos() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}
