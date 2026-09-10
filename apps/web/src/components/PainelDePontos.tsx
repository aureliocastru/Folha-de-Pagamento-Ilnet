import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { useMemo, useState } from 'react';
import { mensagemErro } from '../lib/api';
import { semAcento } from '../lib/busca';
import { formatData } from '../lib/format';
import { Aviso, Carregando, Janela, Vazio } from './ui';

/** Uma linha do painel, como a API a devolve. */
export interface FuncionarioNoPainel {
  id: string;
  nome: string;
  apelido: string | null;
  funcao: string | null;
  pontos: number;
  lancamentos: number;
  posicao: number;
}

interface LancamentoNaTela {
  id: string;
  pontos: number;
  motivo: string;
  data: string;
  lancadoPor: string;
  podeApagar: boolean;
}

/** Os valores de um toque. Cobrem quase tudo; o campo livre cobre o resto. */
const ATALHOS = [1, 2, 5, 10];

/**
 * Motivos de um toque. Só preenchem o campo — quem pontua ainda pode (e
 * deve) completar com o que aconteceu de fato.
 */
const MOTIVOS_A_MAIS = ['Pontualidade', 'Elogio de cliente', 'Serviço bem feito', 'Ajudou a equipe'];
const MOTIVOS_A_MENOS = ['Atraso', 'Falta sem aviso', 'Retrabalho', 'Material perdido'];

/**
 * O painel de pontuar: todos os funcionários, os pontos do mês de cada um e
 * o botão para dar mais.
 *
 * É o mesmo para o coordenador no portal e para o ADMIN por dentro do
 * sistema — o que muda é o cliente (o token de cada um) e o caminho da API.
 * Pensado para o celular: é lá que o coordenador está quando o motivo
 * acontece.
 */
export function PainelDePontos({
  cliente,
  base,
}: {
  cliente: AxiosInstance;
  /** "/pontos" no portal, "/pontuacao" por dentro do sistema. */
  base: string;
}) {
  const [competencia, setCompetencia] = useState(mesAtual);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<FuncionarioNoPainel | null>(null);

  const painel = useQuery({
    queryKey: ['pontos', base, 'painel', competencia],
    queryFn: async () =>
      (
        await cliente.get<{ competencia: string; funcionarios: FuncionarioNoPainel[] }>(
          `${base}/painel`,
          { params: { competencia } },
        )
      ).data,
    placeholderData: (anterior) => anterior,
  });

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    const todos = painel.data?.funcionarios ?? [];
    if (!termo) return todos;
    return todos.filter((f) =>
      semAcento(`${f.nome} ${f.apelido ?? ''} ${f.funcao ?? ''}`).includes(termo),
    );
  }, [painel.data, busca]);

  const ehMesAtual = competencia === mesAtual();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCompetencia((c) => somarMeses(c, -1))}
            className="btn btn-neutro btn-p"
            aria-label="Mês anterior"
          >
            ‹
          </button>
          <span className="min-w-[128px] text-center text-sm inline-block font-semibold text-tinta-800 first-letter:uppercase">
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
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="campo min-w-[180px] flex-1"
          placeholder="Procurar funcionário"
          aria-label="Procurar funcionário"
          autoComplete="off"
        />
      </div>

      {painel.isError && (
        <Aviso tom="erro">Não deu para ler a pontuação: {mensagemErro(painel.error)}</Aviso>
      )}

      <div className="card overflow-hidden">
        {painel.isLoading ? (
          <Carregando texto="Lendo a pontuação…" />
        ) : lista.length === 0 ? (
          <Vazio titulo={busca ? 'Ninguém com esse nome' : 'Nenhum funcionário ativo'} />
        ) : (
          <ul className="lista-dividida">
            {lista.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setAberto(f)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-brand-500/5 md:px-5"
                >
                  <Posicao posicao={f.posicao} temPontos={f.lancamentos > 0} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-tinta-800">
                      {f.apelido || f.nome}
                    </span>
                    <span className="block truncate text-xs text-tinta-400">
                      {f.apelido ? f.nome : (f.funcao ?? '')}
                      {f.lancamentos > 0 &&
                        ` · ${f.lancamentos} lançamento${f.lancamentos > 1 ? 's' : ''}`}
                    </span>
                  </span>
                  <Pontos valor={f.pontos} />
                  <span className="text-lg text-tinta-300" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {aberto && (
        <FichaDePontos
          cliente={cliente}
          base={base}
          funcionario={aberto}
          competencia={competencia}
          onFechar={() => setAberto(null)}
        />
      )}
    </div>
  );
}

/**
 * A ficha de um funcionário: dar pontos, e o que ele já recebeu no mês.
 *
 * Os pontos se escolhem num toque (+1, +2, +5, +10, ou os mesmos a menos), e o
 * motivo é obrigatório — ponto sem motivo não ensina nada a quem recebe.
 */
function FichaDePontos({
  cliente,
  base,
  funcionario,
  competencia,
  onFechar,
}: {
  cliente: AxiosInstance;
  base: string;
  funcionario: FuncionarioNoPainel;
  competencia: string;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [sinal, setSinal] = useState<1 | -1>(1);
  const [quantos, setQuantos] = useState('');
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState(hojeIso);
  const [feito, setFeito] = useState<string | null>(null);

  const chave = ['pontos', base, 'lancamentos', funcionario.id, competencia];
  const lancamentos = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (
        await cliente.get<LancamentoNaTela[]>(
          `${base}/funcionarios/${funcionario.id}/lancamentos`,
          { params: { competencia } },
        )
      ).data,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['pontos', base] });
  }

  const n = Number(quantos);
  const pontos = sinal * n;
  const valido = Number.isInteger(n) && n >= 1 && n <= 100 && motivo.trim().length >= 3;

  const lancar = useMutation({
    mutationFn: async () => {
      await cliente.post(`${base}/lancamentos`, {
        funcionarioId: funcionario.id,
        pontos,
        motivo: motivo.trim(),
        data,
      });
    },
    onSuccess: () => {
      setFeito(
        `${pontos > 0 ? '+' : ''}${pontos} ponto${Math.abs(pontos) > 1 ? 's' : ''} para ${
          funcionario.apelido || funcionario.nome.split(' ')[0]
        }.`,
      );
      setQuantos('');
      setMotivo('');
      recarregar();
    },
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      await cliente.delete(`${base}/lancamentos/${id}`);
    },
    onSuccess: recarregar,
  });

  const total = (lancamentos.data ?? []).reduce((s, l) => s + l.pontos, 0);
  const motivos = sinal > 0 ? MOTIVOS_A_MAIS : MOTIVOS_A_MENOS;

  return (
    <Janela titulo={funcionario.apelido || funcionario.nome} onFechar={onFechar}>
      <p className="mb-4 text-[13px] text-tinta-500">
        {funcionario.apelido ? `${funcionario.nome} · ` : ''}
        {funcionario.posicao}º lugar em {mesPorExtenso(competencia)} ·{' '}
        <strong className={corDosPontos(total)}>
          {total > 0 ? '+' : ''}
          {total} pontos
        </strong>
      </p>

      {feito && (
        <Aviso
          tom="pago"
          acao={
            <button onClick={() => setFeito(null)} className="btn btn-sutil btn-p">
              Ok
            </button>
          }
        >
          {feito}
        </Aviso>
      )}

      {/* A mais ou a menos: o primeiro gesto, e o que decide a cor de tudo. */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSinal(1)}
          aria-pressed={sinal === 1}
          className={`rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition ${
            sinal === 1
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-tinta-200 text-tinta-500'
          }`}
        >
          + Dar pontos
        </button>
        <button
          type="button"
          onClick={() => setSinal(-1)}
          aria-pressed={sinal === -1}
          className={`rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition ${
            sinal === -1
              ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'border-tinta-200 text-tinta-500'
          }`}
        >
          − Tirar pontos
        </button>
      </div>

      <label className="rotulo" htmlFor="pontos-quantos">
        Quantos pontos
      </label>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ATALHOS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setQuantos(String(a))}
            aria-pressed={quantos === String(a)}
            className={`num h-11 min-w-[52px] rounded-xl border text-base font-semibold transition ${
              quantos === String(a)
                ? sinal > 0
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                : 'border-tinta-200 text-tinta-700 hover:border-brand-300'
            }`}
          >
            {sinal > 0 ? '+' : '−'}
            {a}
          </button>
        ))}
        <input
          id="pontos-quantos"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={quantos}
          onChange={(e) => setQuantos(e.target.value.replace(/\D/g, '').slice(0, 3))}
          className="campo num h-11 w-20 text-center"
          placeholder="outro"
        />
      </div>

      <label className="rotulo" htmlFor="pontos-motivo">
        Motivo
      </label>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {motivos.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMotivo((atual) => (atual.trim() ? atual : `${m}: `))}
            className="rounded-full border border-tinta-200 px-2.5 py-1 text-xs text-tinta-600 transition hover:border-brand-300 hover:text-brand-700"
          >
            {m}
          </button>
        ))}
      </div>
      <textarea
        id="pontos-motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
        rows={2}
        className="campo mb-3"
        placeholder="O que aconteceu? É isto que o funcionário vai ler."
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="rotulo" htmlFor="pontos-data">
            Dia
          </label>
          <input
            id="pontos-data"
            type="date"
            value={data}
            max={hojeIso()}
            onChange={(e) => setData(e.target.value || hojeIso())}
            className="campo"
          />
        </div>
        <button
          type="button"
          onClick={() => lancar.mutate()}
          disabled={!valido || lancar.isPending}
          className={`btn ml-auto h-11 flex-1 sm:flex-none ${sinal > 0 ? 'btn-primario' : 'border-rose-600 bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50'}`}
        >
          {lancar.isPending
            ? 'Gravando…'
            : valido
              ? `${sinal > 0 ? 'Dar' : 'Tirar'} ${n} ponto${n > 1 ? 's' : ''}`
              : !(n >= 1)
                ? 'Escolha os pontos'
                : 'Escreva o motivo'}
        </button>
      </div>

      {lancar.isError && <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>}
      {apagar.isError && <Aviso tom="erro">{mensagemErro(apagar.error)}</Aviso>}

      <p className="eyebrow mb-2 border-t border-tinta-200 pt-4">
        Pontos de {mesPorExtenso(competencia)}
      </p>
      {lancamentos.isLoading ? (
        <Carregando />
      ) : (lancamentos.data ?? []).length === 0 ? (
        <p className="text-sm text-tinta-400">Nenhum ponto neste mês ainda.</p>
      ) : (
        <ul className="lista-dividida rounded-xl border border-tinta-200">
          {(lancamentos.data ?? []).map((l) => (
            <li key={l.id} className="flex items-start gap-3 px-3 py-2.5">
              <Pontos valor={l.pontos} pequeno />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-tinta-800">{l.motivo}</span>
                <span className="block text-[11px] text-tinta-400">
                  {formatData(l.data)} · {l.lancadoPor}
                </span>
              </span>
              {l.podeApagar && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Apagar "${l.motivo}" (${l.pontos} pontos)?`)) {
                      apagar.mutate(l.id);
                    }
                  }}
                  disabled={apagar.isPending}
                  className="btn btn-sutil btn-p text-rose-600"
                >
                  Apagar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Janela>
  );
}

/** A posição num círculo; os três primeiros em dourado. */
export function Posicao({ posicao, temPontos }: { posicao: number; temPontos: boolean }) {
  const podio = temPontos && posicao <= 3;
  return (
    <span
      className={`num flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
        podio
          ? 'bg-amber-400/20 text-amber-700 ring-1 ring-amber-400/50 dark:text-amber-300'
          : 'bg-tinta-100 text-tinta-500'
      }`}
    >
      {posicao}º
    </span>
  );
}

/** Os pontos, com sinal e cor: verde a mais, vermelho a menos. */
export function Pontos({ valor, pequeno = false }: { valor: number; pequeno?: boolean }) {
  return (
    <span
      className={`num shrink-0 text-right font-display font-semibold ${
        pequeno ? 'w-10 text-sm' : 'min-w-[3.5rem] text-lg'
      } ${corDosPontos(valor)}`}
    >
      {valor > 0 ? '+' : ''}
      {valor}
    </span>
  );
}

export function corDosPontos(valor: number): string {
  if (valor > 0) return 'text-emerald-600 dark:text-emerald-300';
  if (valor < 0) return 'text-rose-600 dark:text-rose-300';
  return 'text-tinta-400';
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function mesPorExtenso(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  return `${MESES[mes - 1] ?? competencia} de ${ano}`;
}

export function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

export function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hojeIso(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(
    agora.getDate(),
  ).padStart(2, '0')}`;
}
