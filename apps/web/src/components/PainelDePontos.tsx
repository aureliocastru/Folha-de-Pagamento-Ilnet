import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { useMemo, useState, type ChangeEvent } from 'react';
import { mensagemErro } from '../lib/api';
import { semAcento } from '../lib/busca';
import { useCelular } from '../lib/celular';
import { formatData } from '../lib/format';
import { reduzirFoto } from '../lib/foto';
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
  temFoto: boolean;
  podeApagar: boolean;
}

/** Um motivo de um toque, cadastrado pelo ADMIN em Pontuação → Motivos. */
export interface MotivoDePontos {
  id: string;
  texto: string;
  positivo: boolean;
}

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
 * A ficha de um funcionário: dar um ponto, e o que ele já recebeu no mês.
 *
 * É sempre um ponto, a mais ou a menos: o que se escolhe é o motivo, que é
 * obrigatório — ponto sem motivo não ensina nada a quem recebe. A foto é
 * opcional, e no celular sai da câmera na hora.
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
  const celular = useCelular();
  const [sinal, setSinal] = useState<1 | -1>(1);
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState(hojeIso);
  const [foto, setFoto] = useState<string | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  // Os motivos mudam pouco: lidos uma vez, servem para todas as fichas.
  const cadastrados = useQuery({
    queryKey: ['pontos', base, 'motivos'],
    queryFn: async () => (await cliente.get<MotivoDePontos[]>(`${base}/motivos`)).data,
    staleTime: 5 * 60 * 1000,
  });

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

  const valido = motivo.trim().length >= 3 && !preparandoFoto;

  const lancar = useMutation({
    mutationFn: async () => {
      await cliente.post(`${base}/lancamentos`, {
        funcionarioId: funcionario.id,
        pontos: sinal,
        motivo: motivo.trim(),
        data,
        ...(foto ? { foto } : {}),
      });
    },
    onSuccess: () => {
      setFeito(
        `${sinal > 0 ? '+1 ponto para' : '−1 ponto de'} ${
          funcionario.apelido || funcionario.nome.split(' ')[0]
        }.`,
      );
      setMotivo('');
      setFoto(null);
      recarregar();
    },
  });

  async function aoEscolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    if (!arquivo) return;
    setErroFoto(null);
    setPreparandoFoto(true);
    try {
      setFoto(await reduzirFoto(arquivo));
    } catch (err) {
      setErroFoto(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparandoFoto(false);
    }
  }

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      await cliente.delete(`${base}/lancamentos/${id}`);
    },
    onSuccess: recarregar,
  });

  const total = (lancamentos.data ?? []).reduce((s, l) => s + l.pontos, 0);
  const todos = cadastrados.data ?? [];
  const motivos = todos.filter((m) => m.positivo === sinal > 0).map((m) => m.texto);

  /**
   * O toque num motivo: no campo vazio (ou com outro motivo de um toque) ele
   * entra no lugar; tocado de novo, sai. Com texto escrito à mão, ele vai na
   * frente, e o que foi escrito fica como o detalhe.
   */
  function tocarMotivo(m: string) {
    setMotivo((atual) => {
      const t = atual.trim();
      if (t === m) return '';
      if (!t || todos.some((x) => x.texto === t)) return m;
      return t.startsWith(m) ? atual : `${m}: ${t}`;
    });
  }

  function trocarSinal(novo: 1 | -1) {
    setSinal(novo);
    // O motivo de um toque do outro lado não serve mais ("Atraso" num +1).
    setMotivo((atual) => (todos.some((x) => x.texto === atual.trim()) ? '' : atual));
  }

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
          onClick={() => trocarSinal(1)}
          aria-pressed={sinal === 1}
          className={`rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition ${
            sinal === 1
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-tinta-200 text-tinta-500'
          }`}
        >
          +1 ponto
        </button>
        <button
          type="button"
          onClick={() => trocarSinal(-1)}
          aria-pressed={sinal === -1}
          className={`rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition ${
            sinal === -1
              ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'border-tinta-200 text-tinta-500'
          }`}
        >
          −1 ponto
        </button>
      </div>

      <label className="rotulo" htmlFor="pontos-motivo">
        Motivo
      </label>
      {motivos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {motivos.map((m) => {
            const escolhido = motivo.trim() === m || motivo.startsWith(`${m}:`);
            return (
              <button
                key={m}
                type="button"
                onClick={() => tocarMotivo(m)}
                aria-pressed={escolhido}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  escolhido
                    ? sinal > 0
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                    : 'border-tinta-200 text-tinta-600 hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}
      <textarea
        id="pontos-motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
        rows={2}
        className="campo mb-3"
        placeholder={
          motivos.length > 0
            ? 'Toque num motivo acima ou escreva o que aconteceu. É isto que o funcionário vai ler.'
            : 'O que aconteceu? É isto que o funcionário vai ler.'
        }
      />

      {/* A foto: opcional, e a prova do que aconteceu. No celular, a câmera
          abre direto no "Tirar foto"; a galeria fica no outro botão. */}
      <p className="rotulo">Foto (se quiser)</p>
      <div className="mb-3">
        {foto ? (
          <div className="flex items-start gap-3">
            <img
              src={foto}
              alt="Foto que vai junto com o ponto"
              className="h-24 w-24 rounded-xl border border-tinta-200 object-cover"
            />
            <button type="button" onClick={() => setFoto(null)} className="btn btn-sutil btn-p text-rose-600">
              Tirar a foto
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {celular && (
              <label className="btn btn-neutro btn-p cursor-pointer">
                {preparandoFoto ? 'Preparando…' : 'Tirar foto'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={aoEscolherFoto}
                  disabled={preparandoFoto}
                />
              </label>
            )}
            <label className="btn btn-neutro btn-p cursor-pointer">
              {preparandoFoto && !celular
                ? 'Preparando…'
                : celular
                  ? 'Escolher da galeria'
                  : 'Anexar foto'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={aoEscolherFoto}
                disabled={preparandoFoto}
              />
            </label>
          </div>
        )}
        {erroFoto && <p className="mt-1.5 text-xs text-rose-600">{erroFoto}</p>}
      </div>

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
            ? foto
              ? 'Enviando a foto…'
              : 'Gravando…'
            : preparandoFoto
              ? 'Preparando a foto…'
              : !valido
                ? 'Escolha o motivo'
                : sinal > 0
                  ? 'Dar +1 ponto'
                  : 'Tirar 1 ponto'}
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
                {l.temFoto && (
                  <FotoDoPonto
                    chave={['pontos', base, 'foto', l.id]}
                    buscar={async () =>
                      (await cliente.get<{ foto: string }>(`${base}/lancamentos/${l.id}/foto`)).data
                        .foto
                    }
                  />
                )}
              </span>
              {l.podeApagar && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Apagar "${l.motivo}" (${l.pontos > 0 ? '+' : ''}${l.pontos})?`)) {
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

/**
 * A foto de um ponto, aberta ali mesmo na lista.
 *
 * A lista chega só com o aviso de que há foto; a imagem se pede no toque. São
 * centenas de KB cada, e o mês de um funcionário pode ter dezenas de pontos.
 */
export function FotoDoPonto({
  chave,
  buscar,
}: {
  chave: unknown[];
  buscar: () => Promise<string>;
}) {
  const [aberta, setAberta] = useState(false);
  const foto = useQuery({
    queryKey: chave,
    queryFn: buscar,
    enabled: aberta,
    staleTime: Infinity,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
      >
        {aberta ? 'Esconder a foto' : 'Ver a foto'}
      </button>
      {aberta &&
        (foto.isLoading ? (
          <span className="block text-xs text-tinta-400">Abrindo a foto…</span>
        ) : foto.isError ? (
          <span className="block text-xs text-rose-600">{mensagemErro(foto.error)}</span>
        ) : (
          <img
            src={foto.data}
            alt="Foto do ponto"
            className="mt-2 max-h-96 w-full rounded-lg bg-tinta-100 object-contain"
          />
        ))}
    </>
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
