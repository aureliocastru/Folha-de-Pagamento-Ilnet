import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  FotoDoPonto,
  PainelDePontos,
  Pontos,
  corDosPontos,
  mesAtual,
  mesPorExtenso,
  somarMeses,
} from '../../components/PainelDePontos';
import { IconeTrofeu } from '../../components/icones';
import { Aviso, Carregando } from '../../components/ui';
import { mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import { apiPontos, mascararCpf, tokenDoPortal } from '../../lib/pontos';

type Etapa =
  | { tipo: 'cpf' }
  | { tipo: 'senha'; cpf: string; nome: string | null; funcionario: boolean }
  | { tipo: 'coordenador'; nome: string }
  | { tipo: 'funcionario'; cpf: string };

interface MinhaPontuacao {
  nome: string;
  competencia: string;
  pontos: number;
  posicao: number;
  de: number;
  lancamentos: Array<{
    id: string;
    pontos: number;
    motivo: string;
    data: string;
    lancadoPor: string;
    temFoto: boolean;
  }>;
  meses: Array<{ competencia: string; pontos: number }>;
}

/**
 * O portal de pontos — a porta de quem não tem login no sistema.
 *
 * Uma pergunta só na entrada: o CPF. Se ele é de um coordenador, vem a senha
 * e depois o painel de pontuar; se é de um funcionário, a tela dele abre na
 * hora. Nada de usuário, e-mail ou "esqueci a senha": quem pontua é meia
 * dúzia de pessoas, e quem é pontuado só precisa saber o próprio CPF.
 */
export function Portal() {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'cpf' });

  /*
   * O coordenador que já entrou hoje volta direto para o painel. O token dura
   * doze horas — o turno —, e pedir a senha a cada vez que ele abre o celular
   * seria o jeito mais rápido de ele deixar de usar.
   */
  const sessao = useQuery({
    queryKey: ['pontos', 'eu'],
    queryFn: async () => (await apiPontos.get<{ nome: string }>('/pontos/eu')).data,
    enabled: !!tokenDoPortal.ler(),
    retry: 0,
  });

  useEffect(() => {
    if (sessao.data) setEtapa({ tipo: 'coordenador', nome: sessao.data.nome });
    if (sessao.isError) tokenDoPortal.apagar();
  }, [sessao.data, sessao.isError]);

  function sair() {
    tokenDoPortal.apagar();
    qc.removeQueries({ queryKey: ['pontos'] });
    setEtapa({ tipo: 'cpf' });
  }

  return (
    <div className="min-h-screen bg-tinta-50">
      <header className="sticky top-0 z-20 border-b border-tinta-200 bg-papel/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/logo-ilnet.png" alt="ilnet" width={92} height={57} className="h-auto w-[72px]" />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-tinta-400">
              Pontuação
            </span>
          </div>
          {etapa.tipo !== 'cpf' && (
            <button onClick={sair} className="btn btn-neutro btn-p">
              Sair
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5">
        {sessao.isLoading && tokenDoPortal.ler() ? (
          <Carregando />
        ) : etapa.tipo === 'cpf' ? (
          <EntradaPorCpf
            onCoordenador={(cpf, nome, funcionario) =>
              setEtapa({ tipo: 'senha', cpf, nome, funcionario })
            }
            onFuncionario={(cpf) => setEtapa({ tipo: 'funcionario', cpf })}
          />
        ) : etapa.tipo === 'senha' ? (
          <SenhaDoCoordenador
            cpf={etapa.cpf}
            nome={etapa.nome}
            onEntrou={(nome) => setEtapa({ tipo: 'coordenador', nome })}
            onSoMinha={etapa.funcionario ? () => setEtapa({ tipo: 'funcionario', cpf: etapa.cpf }) : undefined}
            onVoltar={() => setEtapa({ tipo: 'cpf' })}
          />
        ) : etapa.tipo === 'coordenador' ? (
          <>
            <p className="eyebrow mb-1">Coordenação</p>
            <h1 className="titulo-pagina mb-4">Olá, {etapa.nome.split(' ')[0]}</h1>
            <PainelDePontos cliente={apiPontos} base="/pontos" />
          </>
        ) : (
          <TelaDoFuncionario cpf={etapa.cpf} />
        )}
      </main>
    </div>
  );
}

function Cartao({ children }: { children: ReactNode }) {
  return <div className="card mx-auto mt-6 max-w-sm p-5 sm:p-6">{children}</div>;
}

function EntradaPorCpf({
  onCoordenador,
  onFuncionario,
}: {
  onCoordenador: (cpf: string, nome: string | null, funcionario: boolean) => void;
  onFuncionario: (cpf: string) => void;
}) {
  const [cpf, setCpf] = useState('');
  const digitos = cpf.replace(/\D/g, '');

  const identificar = useMutation({
    mutationFn: async () =>
      (
        await apiPontos.post<{ coordenador: boolean; funcionario: boolean; nome: string | null }>(
          '/pontos/identificar',
          { cpf: digitos },
        )
      ).data,
    onSuccess: (r) => {
      if (r.coordenador) onCoordenador(digitos, r.nome, r.funcionario);
      else onFuncionario(digitos);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (digitos.length === 11 && !identificar.isPending) identificar.mutate();
  }

  return (
    <Cartao>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-600 dark:text-amber-300">
        <IconeTrofeu className="h-6 w-6" />
      </div>
      <h1 className="font-display text-xl font-semibold text-tinta-900">Sua pontuação</h1>
      <p className="mb-5 mt-1 text-sm text-tinta-500">Digite seu CPF para entrar.</p>
      <form onSubmit={enviar}>
        <label className="rotulo" htmlFor="portal-cpf">
          CPF
        </label>
        <input
          id="portal-cpf"
          value={cpf}
          onChange={(e) => setCpf(mascararCpf(e.target.value))}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="000.000.000-00"
          className="campo num mb-4 h-12 text-lg tracking-wide"
        />
        {identificar.isError && <Aviso tom="erro">{mensagemErro(identificar.error)}</Aviso>}
        <button
          type="submit"
          disabled={digitos.length !== 11 || identificar.isPending}
          className="btn btn-primario h-12 w-full text-base"
        >
          {identificar.isPending ? 'Procurando…' : 'Entrar'}
        </button>
      </form>
    </Cartao>
  );
}

function SenhaDoCoordenador({
  cpf,
  nome,
  onEntrou,
  onSoMinha,
  onVoltar,
}: {
  cpf: string;
  nome: string | null;
  onEntrou: (nome: string) => void;
  onSoMinha?: () => void;
  onVoltar: () => void;
}) {
  const [senha, setSenha] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  const entrar = useMutation({
    mutationFn: async () =>
      (await apiPontos.post<{ token: string; nome: string }>('/pontos/entrar', { cpf, senha })).data,
    onSuccess: (r) => {
      tokenDoPortal.gravar(r.token);
      onEntrou(r.nome);
    },
    onError: () => {
      setSenha('');
      campo.current?.focus();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (senha.length >= 4 && !entrar.isPending) entrar.mutate();
  }

  return (
    <Cartao>
      <h1 className="font-display text-xl font-semibold text-tinta-900">
        {nome ? `Olá, ${nome}` : 'Coordenação'}
      </h1>
      <p className="mb-5 mt-1 text-sm text-tinta-500">Digite sua senha para pontuar.</p>
      <form onSubmit={enviar}>
        <label className="rotulo" htmlFor="portal-senha">
          Senha
        </label>
        <input
          id="portal-senha"
          ref={campo}
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          placeholder="4 a 6 números"
          className="campo num mb-4 h-12 text-center text-2xl tracking-[0.5em]"
        />
        {entrar.isError && <Aviso tom="erro">{mensagemErro(entrar.error)}</Aviso>}
        <button
          type="submit"
          disabled={senha.length < 4 || entrar.isPending}
          className="btn btn-primario h-12 w-full text-base"
        >
          {entrar.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" onClick={onVoltar} className="text-tinta-500 hover:text-tinta-700">
          ‹ Outro CPF
        </button>
        {onSoMinha && (
          <button
            type="button"
            onClick={onSoMinha}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Ver só a minha pontuação
          </button>
        )}
      </div>
    </Cartao>
  );
}

/**
 * A tela do funcionário: os pontos do mês, o lugar dele e cada lançamento com
 * o motivo. Os pontos dos colegas não aparecem — só em que lugar ele está.
 */
function TelaDoFuncionario({ cpf }: { cpf: string }) {
  const [competencia, setCompetencia] = useState(mesAtual);

  const minha = useQuery({
    queryKey: ['pontos', 'minha', cpf, competencia],
    queryFn: async () =>
      (await apiPontos.post<MinhaPontuacao>('/pontos/minha', { cpf, competencia })).data,
    placeholderData: (anterior) => anterior,
    retry: 0,
  });

  if (minha.isLoading) return <Carregando texto="Buscando sua pontuação…" />;
  if (minha.isError || !minha.data) {
    return <Aviso tom="erro">{mensagemErro(minha.error)}</Aviso>;
  }

  const d = minha.data;
  const teto = Math.max(1, ...d.meses.map((m) => Math.abs(m.pontos)));
  const ehMesAtual = competencia === mesAtual();

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow mb-1">Sua pontuação</p>
        <h1 className="titulo-pagina">{d.nome}</h1>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCompetencia((c) => somarMeses(c, -1))}
          className="btn btn-neutro btn-p"
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <span className="min-w-[140px] text-center text-sm inline-block font-semibold text-tinta-800 first-letter:uppercase">
          {mesPorExtenso(competencia)}
        </span>
        <button
          type="button"
          onClick={() => setCompetencia((c) => somarMeses(c, 1))}
          disabled={ehMesAtual}
          className="btn btn-neutro btn-p"
          aria-label="Próximo mês"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow">Pontos no mês</p>
          <p className={`num mt-2 font-display text-4xl font-semibold ${corDosPontos(d.pontos)}`}>
            {d.pontos > 0 ? '+' : ''}
            {d.pontos}
          </p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Sua posição</p>
          <p className="num mt-2 font-display text-4xl font-semibold text-tinta-900">
            {d.posicao}º
          </p>
          <p className="mt-1 text-xs text-tinta-400">de {d.de} funcionários</p>
        </div>
      </div>

      {/* Os últimos meses de relance: melhorou ou piorou? */}
      <div className="card p-4">
        <p className="eyebrow mb-3">Últimos meses</p>
        <div className="flex h-24 items-end gap-2">
          {d.meses.map((m) => (
            <button
              key={m.competencia}
              type="button"
              onClick={() => setCompetencia(m.competencia)}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${mesPorExtenso(m.competencia)}: ${m.pontos} pontos`}
            >
              <span className={`num text-[11px] font-semibold ${corDosPontos(m.pontos)}`}>
                {m.pontos}
              </span>
              <span
                className={`w-full max-w-[36px] rounded-t-md ${
                  m.pontos >= 0 ? 'bg-emerald-500/70' : 'bg-rose-500/70'
                } ${m.competencia === competencia ? 'ring-2 ring-brand-400' : ''}`}
                style={{ height: `${Math.max(4, (Math.abs(m.pontos) / teto) * 60)}px` }}
              />
              <span className="text-[10px] uppercase text-tinta-400">
                {mesPorExtenso(m.competencia).slice(0, 3)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <p className="eyebrow px-4 pb-2 pt-4">O que contou neste mês</p>
        {d.lancamentos.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-tinta-400">Nenhum ponto neste mês ainda.</p>
        ) : (
          <ul className="lista-dividida">
            {d.lancamentos.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                <Pontos valor={l.pontos} pequeno />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-tinta-800">{l.motivo}</span>
                  <span className="block text-[11px] text-tinta-400">
                    {formatData(l.data)} · {l.lancadoPor}
                  </span>
                  {l.temFoto && (
                    <FotoDoPonto
                      chave={['pontos', 'minha', 'foto', l.id]}
                      buscar={async () =>
                        (
                          await apiPontos.post<{ foto: string }>('/pontos/minha/foto', {
                            cpf,
                            lancamentoId: l.id,
                          })
                        ).data.foto
                      }
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
