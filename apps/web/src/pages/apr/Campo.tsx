import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  IconeBomba,
  IconeCapacete,
  IconeChecklist,
  IconeTrofeu,
  type Icone,
} from '../../components/icones';
import { PainelDePontos } from '../../components/PainelDePontos';
import { Aviso, Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  abreAnaliseDeRisco,
  cartoesDoColaborador,
  useInicioDoColaborador,
} from '../../lib/colaborador';
import {
  GRAVIDADE_LABEL,
  GRAVIDADE_TOM,
  STATUS_APR_LABEL,
  STATUS_APR_TOM,
} from '../../lib/status';
import type { AprResumo } from '../../lib/types';
import {
  FormularioDeAbastecimento,
  type DadosDoAbastecimento,
  type VeiculosDoResponsavel,
} from '../pontos/Abastecimento';
import { type MinhaPontuacao, TelaDaMinhaPontuacao } from '../pontos/MinhaPontuacao';
import { DetalheApr } from './DetalheApr';
import { FormularioApr } from './FormularioApr';

/**
 * A tela do colaborador — e, para o técnico de campo, a única que ele vê do
 * sistema inteiro.
 *
 * Sem barra lateral, sem escolha de módulo, sem nada além do que é da pessoa:
 * a pontuação dela, o abastecimento do veículo que está no nome dela, e a
 * análise de risco do serviço. O login de TECNICO cai aqui e não sai daqui;
 * qualquer outro endereço o traz de volta (ver o `App.tsx`), e o servidor
 * recusa o resto por conta própria (ver o `ModulosGuard`).
 *
 * É o mesmo login do sistema, e não um login a mais: quem a pessoa é vem do
 * vínculo do login com o cadastro. Quem trabalha nos módulos também chega
 * aqui, pelo cartão "Minha área" da tela de módulos.
 */
export function Campo() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-tinta-50">
      <header className="sticky top-0 z-20 border-b border-tinta-200 bg-papel/95 backdrop-blur">
        {/* pr-14: o bloco de notas fica na quina da tela, e numa janela
            estreita ele cairia em cima do "Sair". */}
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 py-3 pl-4 pr-14">
          <NavLink to="/campo" className="flex items-center gap-2.5">
            <img
              src="/logo-ilnet.png"
              alt="ilnet"
              width={92}
              height={57}
              className="h-auto w-[72px]"
            />
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-tinta-400 sm:block">
              Minha área
            </span>
          </NavLink>

          <div className="flex min-w-0 items-center gap-2">
            {/* Quem também trabalha nos módulos volta para eles por aqui. O
                técnico não tem para onde voltar: esta é a tela dele. */}
            {usuario && usuario.role !== 'TECNICO' && (
              <NavLink
                to="/modulos"
                className="shrink-0 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Módulos
              </NavLink>
            )}
            <NavLink
              to="/campo/minha-conta"
              className="max-w-[9rem] truncate text-[13px] font-medium text-tinta-600 hover:text-tinta-900"
              title="Minha conta"
            >
              {usuario?.nome}
            </NavLink>
            <button
              onClick={sair}
              className="rounded-lg border border-tinta-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tinta-500 transition hover:border-tinta-300 hover:text-tinta-800"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * A primeira coisa que o colaborador vê: o que é dele, em cartões grandes.
 *
 * - **Minha pontuação** — só a dele, quando o login está ligado ao cadastro;
 * - **Abastecimento** — só quando algum veículo da frota está no nome dele;
 * - **Pontuar** — para o coordenador;
 * - **Análise de risco** — a de sempre, para quem já a abria. O coordenador
 *   não a vê: pontuar é o serviço dele, e subir no poste não.
 *
 * As três primeiras o administrador marca login a login, junto dos módulos.
 *
 * O que não é da pessoa nem aparece: um cartão que leva a um "isto não é seu"
 * é pior que cartão nenhum.
 */
export function CampoInicio() {
  const { usuario } = useAuth();
  const inicio = useInicioDoColaborador();
  const colaborador = inicio.data?.colaborador ?? null;
  const cartoes = cartoesDoColaborador(inicio.data);
  const apr = abreAnaliseDeRisco(usuario) && !cartoes.pontuar;

  const nome = colaborador?.nome ?? usuario?.nome.split(' ')[0] ?? '';

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow mb-1">Minha área</p>
        <h1 className="titulo-pagina">Olá, {nome}</h1>
      </div>

      {inicio.isLoading && <Carregando texto="Carregando…" />}

      {inicio.isError && <Aviso tom="erro">{mensagemErro(inicio.error)}</Aviso>}

      {inicio.isSuccess && cartoes.faltaLigar && (
        <Aviso tom="atencao">
          Seu login ainda não está ligado ao seu cadastro de funcionário, e por isso a
          pontuação e o abastecimento não aparecem. Peça ao administrador para ligar, na
          tela de Usuários.
        </Aviso>
      )}

      {!inicio.isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cartoes.pontuacao && (
            <CartaoDaArea
              para="/campo/pontuacao"
              icone={IconeTrofeu}
              tom="bg-amber-400/15 text-amber-600 dark:text-amber-300"
              titulo="Minha pontuação"
              descricao="Seus pontos do mês, o motivo de cada um e em que lugar você está"
            />
          )}
          {cartoes.abastecimento && (
            <CartaoDaArea
              para="/campo/abastecimento"
              icone={IconeBomba}
              tom="bg-sky-500/15 text-sky-600 dark:text-sky-300"
              titulo="Abastecimento"
              descricao="O km do painel e a foto da nota do posto, no veículo que está com você"
            />
          )}
          {cartoes.pontuar && (
            <CartaoDaArea
              para="/campo/pontuar"
              icone={IconeChecklist}
              tom="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
              titulo="Pontuar"
              descricao="Dar ou tirar pontos dos funcionários, com o motivo e a foto"
            />
          )}
          {apr && (
            <CartaoDaArea
              para="/campo/aprs"
              icone={IconeCapacete}
              tom="bg-rose-500/15 text-rose-600 dark:text-rose-300"
              titulo="Análise de risco"
              descricao="A APR do serviço: abrir, colher as assinaturas e encerrar"
            />
          )}
        </div>
      )}

      {inicio.isSuccess && !cartoes.algum && !apr && !cartoes.faltaLigar && (
        <p className="text-sm text-tinta-500">Por enquanto não há nada para você aqui.</p>
      )}
    </div>
  );
}

/** Um cartão da tela inicial: grande, para o dedo. */
function CartaoDaArea({
  para,
  icone: Icone,
  tom,
  titulo,
  descricao,
}: {
  para: string;
  icone: Icone;
  tom: string;
  titulo: string;
  descricao: string;
}) {
  return (
    <Link to={para} className="card card-hover flex items-start gap-3.5 p-4 sm:flex-col sm:p-5">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tom}`}>
        <Icone className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[16px] font-semibold text-tinta-900">{titulo}</span>
        <span className="mt-1 block text-[13px] leading-snug text-tinta-500">{descricao}</span>
      </span>
    </Link>
  );
}

/** A volta para a tela inicial, no alto de cada uma das três. */
function VoltarAoInicio({ children }: { children?: ReactNode }) {
  const { usuario } = useAuth();
  // Quem trabalha nos módulos chegou pelo cartão de lá, e volta para lá.
  const tecnico = usuario?.role === 'TECNICO';
  return (
    <Link
      to={tecnico ? '/campo' : '/modulos'}
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-tinta-500 hover:text-tinta-800"
    >
      ‹ {children ?? (tecnico ? 'Minha área' : 'Módulos')}
    </Link>
  );
}

/** A pontuação de quem entrou, pelo login — só a dele. */
export function CampoPontuacao() {
  return (
    <>
      <VoltarAoInicio />
      <TelaDaMinhaPontuacao
        chave={['colaborador', 'pontuacao']}
        buscar={async (competencia) =>
          (await api.get<MinhaPontuacao>('/colaborador/pontuacao', { params: { competencia } })).data
        }
        buscarFoto={async (lancamentoId) =>
          (await api.get<{ foto: string }>(`/colaborador/pontuacao/${lancamentoId}/foto`)).data.foto
        }
      />
    </>
  );
}

/**
 * O painel de pontuar do coordenador, pelo login: o mesmo do portal e o mesmo
 * do administrador, com a API da tela do colaborador — que só atende o login
 * com "Pontuar" marcado.
 */
export function CampoPontuar() {
  return (
    <>
      <VoltarAoInicio />
      <p className="eyebrow mb-1">Pontuação</p>
      <h1 className="titulo-pagina mb-4">Pontuar</h1>
      <PainelDePontos cliente={api} base="/colaborador/pontos" />
    </>
  );
}

/**
 * O abastecimento pelo login. O veículo vem do vínculo que já existe (o
 * responsável dele, na aba Veículos): a pessoa só põe o km e a foto da nota, e
 * ficam gravados o login, o colaborador, o veículo, a data e a hora.
 */
export function CampoAbastecimento() {
  return (
    <>
      <VoltarAoInicio />
      <FormularioDeAbastecimento
        chave={['colaborador', 'abastecimento']}
        buscar={async () =>
          (await api.get<VeiculosDoResponsavel>('/colaborador/abastecimento')).data
        }
        lancar={async (dados: DadosDoAbastecimento) =>
          (await api.post('/colaborador/abastecimento', dados)).data
        }
      />
    </>
  );
}

/**
 * As análises de risco: o botão de abrir a APR do serviço, e as dele.
 *
 * A lista existe por três motivos concretos, e nenhum deles é histórico: um
 * rascunho interrompido precisa de onde ser retomado, uma APR liberada precisa
 * de onde ser encerrada no fim do dia, e o papel precisa de onde ser mostrado a
 * quem o pedir na obra.
 */
export function CampoAprs() {
  const navigate = useNavigate();

  const lista = useQuery({
    queryKey: ['aprs', 'minhas'],
    queryFn: async () =>
      (await api.get<AprResumo[]>('/apr', { params: { minhas: true } })).data,
  });

  const aprs = lista.data ?? [];
  const rascunhos = aprs.filter((a) => a.status === 'RASCUNHO');
  const resto = aprs.filter((a) => a.status !== 'RASCUNHO');

  return (
    <div className="space-y-6">
      <VoltarAoInicio />
      <button
        type="button"
        onClick={() => navigate('/campo/nova')}
        className="btn btn-primario w-full justify-center gap-2.5 py-5 text-base"
      >
        <IconeCapacete className="h-5 w-5" />
        Nova análise de risco
      </button>

      {lista.isLoading && <Carregando texto="Carregando…" />}

      {lista.isError && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(lista.error)}
        </p>
      )}

      {rascunhos.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Em preenchimento</h2>
          <div className="space-y-2">
            {rascunhos.map((a) => (
              <CartaoApr key={a.id} apr={a} />
            ))}
          </div>
        </section>
      )}

      {resto.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Análises registradas</h2>
          <div className="space-y-2">
            {resto.map((a) => (
              <CartaoApr key={a.id} apr={a} />
            ))}
          </div>
        </section>
      )}

      {!lista.isLoading && aprs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-tinta-300 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-tinta-500">
            Nenhuma análise de risco registrada
          </p>
        </div>
      )}
    </div>
  );
}

/** Uma APR na lista do técnico: só o que ele precisa para reconhecê-la. */
function CartaoApr({ apr }: { apr: AprResumo }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/campo/${apr.id}`)}
      className="card card-hover w-full p-4 text-left"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo tom={STATUS_APR_TOM[apr.status]} ponto>
          {STATUS_APR_LABEL[apr.status]}
        </Selo>
        <Selo tom={GRAVIDADE_TOM[apr.gravidade]} pequeno>
          {GRAVIDADE_LABEL[apr.gravidade]}
        </Selo>
        {apr.assinaturasFaltando > 0 && (
          <Selo tom="atencao" pequeno>
            {apr.assinaturasFaltando} sem assinar
          </Selo>
        )}
      </div>

      <p className="mt-2 text-[15px] font-semibold leading-snug text-tinta-900">
        {apr.local}
      </p>
      <p className="mt-0.5 text-[12px] text-tinta-500">
        APR nº {apr.numero} · {formatDataHora(apr.inicioEm)}
        {apr.fimEm ? ' · encerrada' : ''}
      </p>
      {apr.riscos.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-tinta-400">
          {apr.riscos.join(' · ')}
        </p>
      )}
    </button>
  );
}

/** O formulário, abrindo em branco. */
export function CampoNova() {
  const navigate = useNavigate();
  return (
    <FormularioApr
      onSair={() => navigate('/campo/aprs')}
      onPronta={(id) => navigate(`/campo/${id}`, { replace: true })}
    />
  );
}

/** Uma APR do técnico: retomar o rascunho, ver o papel, encerrar. */
export function CampoApr() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [continuando, setContinuando] = useState(false);

  if (!id) return null;

  if (continuando) {
    return (
      <FormularioApr
        aprId={id}
        onSair={() => setContinuando(false)}
        onPronta={() => setContinuando(false)}
      />
    );
  }

  return (
    <DetalheApr
      id={id}
      onContinuar={() => setContinuando(true)}
      onSair={() => navigate('/campo/aprs')}
    />
  );
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
