import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconeAlerta, IconeVoltar } from '../../components/icones';
import { Carregando } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { combina, semAcento } from '../../lib/busca';
import {
  CATEGORIA_APR_LABEL,
  GRAVIDADE_LABEL,
  RESPOSTAS_RELATO,
} from '../../lib/status';
import type {
  Apr,
  CategoriaItemApr,
  FormularioApr as FormularioAprDados,
  GravidadeApr,
  ItemApr,
  PessoaDaEquipe,
  RespostaRelato,
} from '../../lib/types';
import { PassoEquipe, type PessoaEscolhida } from './PassoEquipe';
import {
  BlocoDeMarcar,
  Grade,
  MarcarEmLinha,
  type DefinirMarcacoes,
  type Marcacao,
} from './marcar';

/**
 * A APR sendo preenchida.
 *
 * É a tela que o técnico usa de pé, na beira da estrada, com o celular numa mão
 * — e é isso que manda em cada decisão daqui.
 *
 * **Por passos, e não numa página só.** O papel tem cinco blocos e umas noventa
 * marcações; empilhados numa rolagem única, o técnico perde o lugar e desiste no
 * meio. Cada passo cabe numa tela.
 *
 * **Salva sozinha ao virar de passo.** Ao fim do primeiro passo a APR já existe
 * como rascunho no servidor, e cada "Continuar" grava o que foi feito até ali.
 * O sinal cai onde se trabalha — quem perde vinte minutos de preenchimento uma
 * vez não preenche de novo, preenche por fora.
 *
 * **O que falta aparece antes do botão, não depois.** A conferência da
 * liberação roda no servidor, mas a lista de pendências volta inteira e fica
 * visível no rodapé do último passo.
 */

/**
 * As etapas do preenchimento.
 *
 * Só o nome de cada uma. A legenda explicativa que havia aqui saiu junto com
 * as demais: este é um documento de segurança do trabalho, e o formulário
 * impresso que ele substitui nomeia os campos sem instruir quem preenche.
 */
const PASSOS = [
  'Identificação do serviço',
  'Riscos da atividade',
  'Equipamentos e proteções',
  'Relato situacional',
  'Executantes',
] as const;

/** O que ela guarda de cada pergunta do relato. */
interface Conferencia {
  resposta: RespostaRelato | null;
  providencia: string;
}

export function FormularioApr({
  aprId,
  onSair,
  onPronta,
}: {
  /** Preenchido = continuar um rascunho; vazio = APR nova. */
  aprId?: string;
  onSair: () => void;
  /** Chamada quando a APR é liberada, com o id dela. */
  onPronta: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const [passo, setPasso] = useState(0);
  const [id, setId] = useState<string | undefined>(aprId);
  const [erro, setErro] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);

  // --- O que se preenche ---
  const [local, setLocal] = useState('');
  const [coordenador, setCoordenador] = useState('');
  const [inicioEm, setInicioEm] = useState(agoraParaCampo);
  const [previsaoInicio, setPrevisaoInicio] = useState('');
  const [previsaoFim, setPrevisaoFim] = useState('');
  const [etapas, setEtapas] = useState('');
  const [gravidade, setGravidade] = useState<GravidadeApr>('ALTA');
  const [marcacoes, setMarcacoes] = useState<Record<string, Marcacao>>({});
  const [conferencias, setConferencias] = useState<Record<string, Conferencia>>({});
  const [equipe, setEquipe] = useState<PessoaEscolhida[]>([]);

  const formulario = useQuery({
    queryKey: ['apr-formulario'],
    queryFn: async () =>
      (await api.get<FormularioAprDados>('/apr/formulario')).data,
    staleTime: 5 * 60 * 1000,
  });

  const pessoas = useQuery({
    queryKey: ['apr-equipe'],
    queryFn: async () => (await api.get<PessoaDaEquipe[]>('/apr/equipe')).data,
    staleTime: 5 * 60 * 1000,
  });

  const rascunho = useQuery({
    queryKey: ['apr', id],
    queryFn: async () => (await api.get<Apr>(`/apr/${id}`)).data,
    enabled: !!id,
  });

  /*
   * O rascunho que voltou do servidor manda na tela.
   *
   * Vale para os dois casos: continuar uma APR aberta ontem e recarregar a
   * página no meio do preenchimento de hoje. As assinaturas só existem lá, e é
   * por isso que a equipe é sempre relida — o estado local não sabe quem já
   * assinou.
   */
  const carregado = useRef<string | null>(null);
  useEffect(() => {
    const apr = rascunho.data;
    if (!apr || carregado.current === apr.id) return;
    carregado.current = apr.id;

    setLocal(apr.local);
    setCoordenador(apr.coordenador);
    setInicioEm(paraCampoDeHora(apr.inicioEm));
    setPrevisaoInicio(apr.previsaoInicio?.slice(0, 10) ?? '');
    setPrevisaoFim(apr.previsaoFim?.slice(0, 10) ?? '');
    setEtapas(apr.descricaoEtapas);
    setGravidade(apr.gravidade);

    const marcadas: Record<string, Marcacao> = {};
    const respondidas: Record<string, Conferencia> = {};
    for (const r of apr.respostas) {
      if (!r.itemId) continue;
      if (r.categoria === 'RELATO') {
        respondidas[r.itemId] = {
          resposta: r.resposta,
          providencia: r.detalhe ?? '',
        };
      } else {
        marcadas[r.itemId] = { marcado: r.marcado, detalhe: r.detalhe ?? '' };
      }
    }
    setMarcacoes(marcadas);
    setConferencias(respondidas);
    setEquipe(
      apr.executantes.map((e) => ({
        funcionarioId: e.funcionarioId ?? undefined,
        nome: e.nome,
        cpf: e.cpf ?? undefined,
      })),
    );
  }, [rascunho.data]);

  /*
   * O que falta vem do servidor a cada resposta dele, e não só ao salvar.
   *
   * Assinar não passa por "salvar" — é uma rota própria —, e a lista ficava
   * dizendo "faltam 2 assinaturas" com as duas já colhidas na tela. Como o
   * efeito acima só roda uma vez por APR (ele reescreve os campos, e não pode
   * fazer isso embaixo de quem está digitando), a pendência precisa do seu.
   */
  useEffect(() => {
    if (rascunho.data) setPendencias(rascunho.data.pendencias);
  }, [rascunho.data]);

  /*
   * Numa APR nova, o coordenador já vem sendo quem está preenchendo.
   *
   * É o caso comum — quem abre a APR é quem responde pela equipe em campo — e
   * é um campo a menos para digitar de pé. Continua editável: a equipe que sai
   * com o encarregado troca o nome e segue.
   */
  useEffect(() => {
    if (!id && usuario?.nome) setCoordenador((atual) => atual || usuario.nome);
  }, [id, usuario?.nome]);

  const blocos = formulario.data?.blocos ?? [];
  const itensDe = (categoria: CategoriaItemApr): ItemApr[] =>
    blocos.find((b) => b.categoria === categoria)?.itens ?? [];

  function corpo() {
    return {
      local: local.trim(),
      coordenador: coordenador.trim(),
      inicioEm: new Date(inicioEm).toISOString(),
      previsaoInicio: previsaoInicio || undefined,
      previsaoFim: previsaoFim || undefined,
      descricaoEtapas: etapas.trim(),
      gravidade,
      respostas: [
        ...Object.entries(marcacoes).map(([itemId, m]) => ({
          itemId,
          marcado: m.marcado,
          detalhe: m.detalhe || undefined,
        })),
        ...Object.entries(conferencias)
          .filter(([, c]) => c.resposta)
          .map(([itemId, c]) => ({
            itemId,
            resposta: c.resposta!,
            detalhe: c.providencia || undefined,
          })),
      ],
      executantes: equipe,
    };
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = corpo();
      const apr = id
        ? (await api.patch<Apr>(`/apr/${id}`, dados)).data
        : (await api.post<Apr>('/apr', dados)).data;
      return apr;
    },
    onSuccess: (apr) => {
      setErro(null);
      setId(apr.id);
      // O rascunho recarregado é o dono das assinaturas e das pendências: o
      // passo da equipe lê dele quem já assinou, e o rodapé, o que falta.
      carregado.current = apr.id;
      qc.setQueryData(['apr', apr.id], apr);
      void qc.invalidateQueries({ queryKey: ['aprs'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const liberar = useMutation({
    mutationFn: async () => {
      await salvar.mutateAsync();
      return (await api.post<Apr>(`/apr/${id}/liberar`)).data;
    },
    onSuccess: (apr) => {
      void qc.invalidateQueries({ queryKey: ['aprs'] });
      onPronta(apr.id);
    },
    onError: (e) => {
      // A recusa da liberação vem como lista: é tudo o que falta, de uma vez.
      const corpoErro = (e as { response?: { data?: { message?: unknown } } })
        ?.response?.data?.message;
      if (Array.isArray(corpoErro)) {
        setPendencias(corpoErro as string[]);
        setErro(null);
      } else {
        setErro(mensagemErro(e));
      }
    },
  });

  async function avancar() {
    setErro(null);
    try {
      await salvar.mutateAsync();
      setPasso((p) => Math.min(p + 1, PASSOS.length - 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // A mensagem já está na tela pelo onError.
    }
  }

  function voltar() {
    setErro(null);
    if (passo === 0) return onSair();
    setPasso((p) => p - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const podeAvancar =
    passo > 0 || (local.trim().length >= 3 && coordenador.trim().length >= 3);
  const ultimo = passo === PASSOS.length - 1;

  if (formulario.isLoading || (id && rascunho.isLoading)) {
    return <Carregando texto="Abrindo o formulário…" />;
  }
  if (formulario.isError) {
    return (
      <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {mensagemErro(formulario.error)}
      </p>
    );
  }

  return (
    <div className="pb-32">
      <Cabecalho
        passo={passo}
        numero={rascunho.data?.numero}
        onVoltar={voltar}
      />

      {passo === 0 && (
        <PassoServico
          local={local}
          setLocal={setLocal}
          coordenador={coordenador}
          setCoordenador={setCoordenador}
          inicioEm={inicioEm}
          setInicioEm={setInicioEm}
          previsaoInicio={previsaoInicio}
          setPrevisaoInicio={setPrevisaoInicio}
          previsaoFim={previsaoFim}
          setPrevisaoFim={setPrevisaoFim}
          etapas={etapas}
          setEtapas={setEtapas}
          gravidade={gravidade}
          setGravidade={setGravidade}
          normas={itensDe('NORMA')}
          atividades={itensDe('ATIVIDADE')}
          marcacoes={marcacoes}
          setMarcacoes={setMarcacoes}
        />
      )}

      {passo === 1 && (
        <PassoRiscos
          itens={itensDe('RISCO')}
          marcacoes={marcacoes}
          setMarcacoes={setMarcacoes}
        />
      )}

      {passo === 2 && (
        <>
          <BlocoDeMarcar
            titulo={CATEGORIA_APR_LABEL.FERRAMENTA}
            itens={itensDe('FERRAMENTA')}
            marcacoes={marcacoes}
            setMarcacoes={setMarcacoes}
          />
          <BlocoDeMarcar
            titulo={CATEGORIA_APR_LABEL.PROTECAO}
            itens={itensDe('PROTECAO')}
            marcacoes={marcacoes}
            setMarcacoes={setMarcacoes}
          />
        </>
      )}

      {passo === 3 && (
        <PassoConferencia
          itens={itensDe('RELATO')}
          conferencias={conferencias}
          setConferencias={setConferencias}
        />
      )}

      {passo === 4 && (
        <PassoEquipe
          aprId={id}
          equipe={equipe}
          setEquipe={setEquipe}
          pessoas={pessoas.data ?? []}
          executantes={rascunho.data?.executantes ?? []}
          onSalvarEquipe={() => salvar.mutateAsync()}
          onErro={setErro}
        />
      )}

      <Rodape
        erro={erro}
        pendencias={ultimo ? pendencias : []}
        passo={passo}
        salvando={salvar.isPending}
        liberando={liberar.isPending}
        podeAvancar={podeAvancar}
        onVoltar={voltar}
        onAvancar={avancar}
        onLiberar={() => liberar.mutate()}
      />
    </div>
  );
}

// --- A casca ----------------------------------------------------------------

function Cabecalho({
  passo,
  numero,
  onVoltar,
}: {
  passo: number;
  numero?: number;
  onVoltar: () => void;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onVoltar}
          aria-label="Voltar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-tinta-200 bg-papel text-tinta-600 transition hover:border-brand-300 hover:text-brand-700"
        >
          <IconeVoltar className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="eyebrow">
            Passo {passo + 1} de {PASSOS.length}
            {numero ? ` · APR nº ${numero}` : ''}
          </p>
          <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-tinta-900">
            {PASSOS[passo]}
          </h1>
        </div>
      </div>

      {/* A régua de progresso: cinco traços, e o de agora aceso. */}
      <div className="mt-4 flex gap-1.5">
        {PASSOS.map((p, i) => (
          <span
            key={p}
            className={`h-1 flex-1 rounded-full transition ${
              i <= passo ? 'bg-brand-500' : 'bg-tinta-200'
            }`}
          />
        ))}
      </div>
    </header>
  );
}

/**
 * A barra de baixo, fixa.
 *
 * Fixa porque os passos rolam: o botão de continuar no fim de uma lista de
 * quarenta riscos é um botão que se procura. E é nela que as pendências
 * aparecem — em cima do botão que elas impedem, não numa mensagem que sobe e
 * some.
 */
function Rodape({
  erro,
  pendencias,
  passo,
  salvando,
  liberando,
  podeAvancar,
  onVoltar,
  onAvancar,
  onLiberar,
}: {
  erro: string | null;
  pendencias: string[];
  passo: number;
  salvando: boolean;
  liberando: boolean;
  podeAvancar: boolean;
  onVoltar: () => void;
  onAvancar: () => void;
  onLiberar: () => void;
}) {
  const ultimo = passo === PASSOS.length - 1;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-tinta-200 bg-papel/95 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        {erro && (
          <p className="mb-2.5 rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
            {erro}
          </p>
        )}

        {pendencias.length > 0 && (
          <div className="mb-2.5 max-h-40 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              <IconeAlerta className="h-3.5 w-3.5" />
              Falta para liberar
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] leading-snug text-amber-900 dark:text-amber-200">
              {pendencias.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onVoltar}
            className="btn btn-neutro px-4 py-3"
          >
            Voltar
          </button>
          {ultimo ? (
            <button
              type="button"
              onClick={onLiberar}
              disabled={liberando || salvando}
              className="btn btn-pagar flex-1 py-3 text-base"
            >
              {liberando ? 'Liberando…' : 'Liberar o serviço'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onAvancar}
              disabled={!podeAvancar || salvando}
              className="btn btn-primario flex-1 py-3 text-base"
            >
              {salvando ? 'Salvando…' : 'Continuar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Passo 1: o serviço -----------------------------------------------------

function PassoServico(p: {
  local: string;
  setLocal: (v: string) => void;
  coordenador: string;
  setCoordenador: (v: string) => void;
  inicioEm: string;
  setInicioEm: (v: string) => void;
  previsaoInicio: string;
  setPrevisaoInicio: (v: string) => void;
  previsaoFim: string;
  setPrevisaoFim: (v: string) => void;
  etapas: string;
  setEtapas: (v: string) => void;
  gravidade: GravidadeApr;
  setGravidade: (v: GravidadeApr) => void;
  normas: ItemApr[];
  atividades: ItemApr[];
  marcacoes: Record<string, Marcacao>;
  setMarcacoes: DefinirMarcacoes;
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="rotulo" htmlFor="local">
          Local da atividade
        </label>
        <input
          id="local"
          className="campo"
          value={p.local}
          onChange={(e) => p.setLocal(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div>
        <label className="rotulo" htmlFor="coordenador">
          Coordenador responsável
        </label>
        <input
          id="coordenador"
          className="campo"
          value={p.coordenador}
          onChange={(e) => p.setCoordenador(e.target.value)}
          autoComplete="off"
        />
      </div>

      <MarcarEmLinha
        titulo={CATEGORIA_APR_LABEL.NORMA}
        itens={p.normas}
        marcacoes={p.marcacoes}
        setMarcacoes={p.setMarcacoes}
      />

      <MarcarEmLinha
        titulo={CATEGORIA_APR_LABEL.ATIVIDADE}
        itens={p.atividades}
        marcacoes={p.marcacoes}
        setMarcacoes={p.setMarcacoes}
      />

      <div>
        <label className="rotulo" htmlFor="etapas">
          Descrição da atividade por etapas, de forma sequencial
        </label>
        <textarea
          id="etapas"
          className="campo min-h-[140px] resize-y"
          value={p.etapas}
          onChange={(e) => p.setEtapas(e.target.value)}
        />
      </div>

      <div>
        <span className="rotulo">Potencial de gravidade</span>
        <div className="flex gap-2">
          {(['BAIXA', 'MEDIA', 'ALTA'] as GravidadeApr[]).map((g) => {
            const escolhida = p.gravidade === g;
            const cor =
              g === 'ALTA'
                ? 'border-rose-500 bg-rose-500 text-white'
                : g === 'MEDIA'
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-emerald-600 bg-emerald-600 text-white';
            return (
              <button
                key={g}
                type="button"
                onClick={() => p.setGravidade(g)}
                aria-pressed={escolhida}
                className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition ${
                  escolhida
                    ? cor
                    : 'border-tinta-200 bg-papel text-tinta-600 hover:border-tinta-300'
                }`}
              >
                {GRAVIDADE_LABEL[g]}
              </button>
            );
          })}
        </div>
      </div>

      <details className="rounded-xl border border-tinta-200 bg-papel px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-tinta-600">
          Período de execução
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <label className="rotulo" htmlFor="inicio">
              Data e hora de início
            </label>
            <input
              id="inicio"
              type="datetime-local"
              className="campo"
              value={p.inicioEm}
              onChange={(e) => p.setInicioEm(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="rotulo" htmlFor="prev-ini">
                Previsão de execução — de
              </label>
              <input
                id="prev-ini"
                type="date"
                className="campo"
                value={p.previsaoInicio}
                onChange={(e) => p.setPrevisaoInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="prev-fim">
                Previsão de execução — até
              </label>
              <input
                id="prev-fim"
                type="date"
                className="campo"
                value={p.previsaoFim}
                onChange={(e) => p.setPrevisaoFim(e.target.value)}
              />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

// --- Passo 2: os riscos -----------------------------------------------------

/**
 * A grade de riscos, que é a maior lista do formulário.
 *
 * Ganha busca porque são mais de quarenta itens: quem já sabe que vai marcar
 * "descarga elétrica" não deve ter de percorrer a lista atrás dela. E ganha o
 * resumo do que já foi marcado no alto — rolando quarenta chips, ninguém lembra
 * o que ficou para trás.
 */
function PassoRiscos({
  itens,
  marcacoes,
  setMarcacoes,
}: {
  itens: ItemApr[];
  marcacoes: Record<string, Marcacao>;
  setMarcacoes: DefinirMarcacoes;
}) {
  const [busca, setBusca] = useState('');

  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return itens;
    return itens.filter((i) => combina([i.texto], termo));
  }, [itens, busca]);

  const marcados = itens.filter((i) => marcacoes[i.id]?.marcado);

  return (
    <div className="space-y-4">
      <input
        type="search"
        className="campo"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Localizar risco"
        aria-label="Localizar risco"
      />

      {marcados.length > 0 && (
        <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.07] px-3.5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            {marcados.length} marcado{marcados.length > 1 ? 's' : ''}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-tinta-700">
            {marcados.map((i) => i.texto).join(' · ')}
          </p>
        </div>
      )}

      <Grade
        itens={visiveis}
        marcacoes={marcacoes}
        setMarcacoes={setMarcacoes}
      />

      {visiveis.length === 0 && (
        <p className="py-8 text-center text-sm text-tinta-400">
          Nenhum risco com esse nome na lista.
        </p>
      )}
    </div>
  );
}

// --- Passo 4: o relato situacional -------------------------------------------

/**
 * A conferência de antes de subir.
 *
 * Três botões grandes por pergunta, e não uma caixinha: é o gesto que se faz de
 * pé, com o polegar. Responder "Não" abre o campo da providência logo abaixo —
 * é o único acréscimo ao papel, e ele existe porque no papel esse "Não" ia
 * embora sem deixar dito o que foi feito a respeito.
 */
function PassoConferencia({
  itens,
  conferencias,
  setConferencias,
}: {
  itens: ItemApr[];
  conferencias: Record<string, Conferencia>;
  setConferencias: React.Dispatch<
    React.SetStateAction<Record<string, Conferencia>>
  >;
}) {
  const respondidas = itens.filter((i) => conferencias[i.id]?.resposta).length;

  function responder(item: ItemApr, resposta: RespostaRelato) {
    setConferencias((atual) => ({
      ...atual,
      [item.id]: {
        resposta,
        providencia:
          resposta === 'NAO' ? (atual[item.id]?.providencia ?? '') : '',
      },
    }));
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-tinta-500">
        {respondidas} de {itens.length} respondidas
      </p>

      {itens.map((item, indice) => {
        const atual = conferencias[item.id];
        const negativa = atual?.resposta === 'NAO';

        return (
          <div
            key={item.id}
            className={`rounded-2xl border p-4 transition ${
              negativa
                ? 'border-rose-300 bg-rose-50 dark:bg-rose-500/10'
                : atual?.resposta
                  ? 'border-tinta-200 bg-papel'
                  : 'border-tinta-200 bg-papel'
            }`}
          >
            <p className="text-[14px] leading-snug text-tinta-800">
              <span className="mr-1.5 font-semibold text-tinta-400">
                {indice + 1}.
              </span>
              {item.texto}
            </p>

            <div className="mt-3 flex gap-2">
              {RESPOSTAS_RELATO.map(({ valor, label }) => {
                const escolhida = atual?.resposta === valor;
                const cor =
                  valor === 'SIM'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : valor === 'NAO'
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-tinta-500 bg-tinta-500 text-white';
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => responder(item, valor)}
                    aria-pressed={escolhida}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition ${
                      escolhida
                        ? cor
                        : 'border-tinta-200 bg-papel text-tinta-600 hover:border-tinta-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {negativa && item.exigeProvidencia && (
              <div className="mt-3">
                <label className="rotulo" htmlFor={`prov-${item.id}`}>
                  Providência adotada
                </label>
                <textarea
                  id={`prov-${item.id}`}
                  className="campo min-h-[70px] resize-y"
                  value={atual?.providencia ?? ''}
                  onChange={(e) =>
                    setConferencias((c) => ({
                      ...c,
                      [item.id]: {
                        resposta: 'NAO',
                        providencia: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Miudezas ---------------------------------------------------------------

/** "AAAA-MM-DDTHH:mm" no fuso de quem está olhando — o que o campo espera. */
function agoraParaCampo(): string {
  return paraCampoDeHora(new Date().toISOString());
}

function paraCampoDeHora(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

