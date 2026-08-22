import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  AssinaturaCanvas,
  type AssinaturaCanvasRef,
} from '../../components/AssinaturaCanvas';
import { IconeAlerta } from '../../components/icones';
import { Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { abrirArquivo } from '../../lib/arquivo';
import { useAuth } from '../../lib/auth';
import {
  CATEGORIA_APR_LABEL,
  GRAVIDADE_LABEL,
  GRAVIDADE_TOM,
  STATUS_APR_LABEL,
  STATUS_APR_TOM,
} from '../../lib/status';
import type { Apr, CategoriaItemApr } from '../../lib/types';

/**
 * Uma APR, aberta.
 *
 * A mesma tela serve ao técnico e a quem supervisiona — o que muda é o que
 * cada um pode fazer com ela, e isso vem do perfil, não de duas telas
 * parecidas mantidas em paralelo.
 *
 * O que o papel enterrava vem primeiro aqui: as respostas "Não" do relato, com
 * a providência de cada uma. No formulário impresso elas ficam num quadradinho
 * no meio da terceira folha, que é onde ninguém as lê.
 */

const BLOCOS: CategoriaItemApr[] = [
  'NORMA',
  'ATIVIDADE',
  'RISCO',
  'FERRAMENTA',
  'PROTECAO',
];

export function DetalheApr({
  id,
  onContinuar,
  onSair,
}: {
  id: string;
  /** Chamada ao clicar em "continuar preenchendo" um rascunho. */
  onContinuar?: (id: string) => void;
  onSair?: () => void;
}) {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const [erro, setErro] = useState<string | null>(null);
  const [janela, setJanela] = useState<'prorrogar' | 'cancelar' | 'supervisao' | null>(null);

  const consulta = useQuery({
    queryKey: ['apr', id],
    queryFn: async () => (await api.get<Apr>(`/apr/${id}`)).data,
  });

  const abrirPdf = useMutation({
    mutationFn: async () =>
      abrirArquivo(`/apr/${id}/pdf`, `APR-${consulta.data?.numero ?? id}.pdf`),
    onError: (e) => setErro(mensagemErro(e)),
  });

  const acao = useMutation({
    mutationFn: async ({
      rota,
      corpo,
    }: {
      rota: string;
      corpo?: Record<string, unknown>;
    }) => (await api.post<Apr>(`/apr/${id}/${rota}`, corpo ?? {})).data,
    onSuccess: (apr) => {
      setErro(null);
      setJanela(null);
      qc.setQueryData(['apr', id], apr);
      void qc.invalidateQueries({ queryKey: ['aprs'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  if (consulta.isLoading) return <Carregando texto="Carregando…" />;
  if (consulta.isError) {
    return (
      <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {mensagemErro(consulta.error)}
      </p>
    );
  }

  const apr = consulta.data!;
  const rascunho = apr.status === 'RASCUNHO';
  const liberada = apr.status === 'LIBERADA';
  const supervisiona = usuario?.role === 'ADMIN' || usuario?.role === 'RH';

  return (
    <div className="space-y-5">
      {/* --- O que a APR é, em três linhas --- */}
      <header className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom={STATUS_APR_TOM[apr.status]} ponto>
            {STATUS_APR_LABEL[apr.status]}
          </Selo>
          <Selo tom={GRAVIDADE_TOM[apr.gravidade]}>
            Gravidade {GRAVIDADE_LABEL[apr.gravidade].toLowerCase()}
          </Selo>
          {apr.prorrogacoes > 0 && (
            <Selo tom="atencao">
              {apr.prorrogacoes}ª prorrogação
            </Selo>
          )}
          {apr.supervisorEm && <Selo tom="marca">Supervisionada</Selo>}
        </div>

        <h1 className="mt-3 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-tinta-900">
          APR nº {apr.numero}
        </h1>
        <p className="mt-1 text-[15px] text-tinta-700">{apr.local}</p>
        <p className="mt-1 text-[13px] text-tinta-500">
          {apr.tipoTrabalho} · coordenação de {apr.coordenador} ·{' '}
          {formatDataHora(apr.inicioEm)}
          {apr.fimEm ? ` até ${formatDataHora(apr.fimEm)}` : ''}
        </p>
      </header>

      {apr.status === 'CANCELADA' && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:bg-rose-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">
            Cancelada
          </p>
          <p className="mt-1 text-sm text-rose-900 dark:text-rose-200">
            {apr.motivoCancelamento}
          </p>
        </div>
      )}

      {/* --- O que o papel enterrava --- */}
      {apr.alertas.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-500/10">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            <IconeAlerta className="h-3.5 w-3.5" />
            Não conformidades no relato situacional
          </p>
          <ul className="mt-2.5 space-y-2.5">
            {apr.alertas.map((a) => (
              <li key={a.pergunta}>
                <p className="text-[13px] font-semibold leading-snug text-amber-900 dark:text-amber-200">
                  {a.pergunta}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-amber-800 dark:text-amber-300/90">
                  {a.providencia ?? 'Sem providência registrada.'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rascunho && apr.pendencias.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Pendências para liberação
          </p>
          <ul className="mt-1.5 space-y-1 text-[13px] leading-snug text-amber-900 dark:text-amber-200">
            {apr.pendencias.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </section>
      )}

      {/* --- O que fazer com ela --- */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => abrirPdf.mutate()}
          disabled={abrirPdf.isPending}
          className="btn btn-primario"
        >
          {abrirPdf.isPending ? 'Abrindo…' : 'Visualizar PDF'}
        </button>

        {rascunho && onContinuar && (
          <button
            type="button"
            onClick={() => onContinuar(apr.id)}
            className="btn btn-acao"
          >
            Continuar preenchimento
          </button>
        )}

        {liberada && !apr.fimEm && (
          <button
            type="button"
            onClick={() => acao.mutate({ rota: 'encerrar' })}
            disabled={acao.isPending}
            className="btn btn-pagar"
          >
            Encerrar
          </button>
        )}

        {liberada && apr.prorrogacoes < 2 && (
          <button
            type="button"
            onClick={() => setJanela('prorrogar')}
            className="btn btn-neutro"
          >
            Prorrogar
          </button>
        )}

        {liberada && supervisiona && !apr.supervisorEm && (
          <button
            type="button"
            onClick={() => setJanela('supervisao')}
            className="btn btn-neutro"
          >
            Registrar supervisão
          </button>
        )}

        {apr.status !== 'CANCELADA' && (
          <button
            type="button"
            onClick={() => setJanela('cancelar')}
            className="btn btn-perigo"
          >
            Cancelar
          </button>
        )}

        {onSair && (
          <button type="button" onClick={onSair} className="btn btn-sutil">
            Voltar
          </button>
        )}
      </div>

      {erro && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro}
        </p>
      )}

      {/* --- A equipe --- */}
      <section className="card p-5">
        <h2 className="titulo-bloco mb-3">Executantes da tarefa</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {apr.executantes.map((e) => (
            <div
              key={e.id}
              className="rounded-xl border border-tinta-200 p-3 text-center"
            >
              {e.assinaturaPng ? (
                /* Sobre papel: a tinta é escura, e o cartão pode não ser. */
                <img
                  src={e.assinaturaPng}
                  alt=""
                  className="mx-auto h-12 w-full rounded-md bg-white object-contain p-1"
                />
              ) : (
                <div className="flex h-12 items-center justify-center text-xs text-tinta-400">
                  sem assinatura
                </div>
              )}
              <p className="mt-1 border-t border-tinta-200 pt-1.5 text-[13px] font-semibold text-tinta-900">
                {e.nome}
              </p>
              <p className="text-[11px] text-tinta-400">
                {e.assinadoEm ? formatDataHora(e.assinadoEm) : 'não assinou'}
                {e.modo === 'DIGITADA' ? ' · gerada do nome' : ''}
              </p>
            </div>
          ))}
        </div>

        {apr.supervisorEm && (
          <div className="mt-4 flex items-center gap-4 border-t border-tinta-200 pt-4">
            {apr.supervisorAssinatura && (
              <img
                src={apr.supervisorAssinatura}
                alt=""
                className="h-10 w-28 shrink-0 rounded-md bg-white object-contain p-0.5"
              />
            )}
            <div>
              <p className="eyebrow">Supervisão</p>
              <p className="text-[13px] font-semibold text-tinta-900">
                {apr.supervisorNome}
              </p>
              <p className="text-[11px] text-tinta-400">
                {formatDataHora(apr.supervisorEm)}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* --- O que foi marcado --- */}
      <section className="card p-5">
        <h2 className="titulo-bloco mb-3">Itens assinalados</h2>
        <div className="space-y-4">
          {BLOCOS.map((categoria) => {
            const itens = apr.respostas.filter(
              (r) => r.categoria === categoria && r.marcado,
            );
            if (itens.length === 0) return null;
            return (
              <div key={categoria}>
                <p className="eyebrow mb-1.5">
                  {CATEGORIA_APR_LABEL[categoria]}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {itens.map((i) => (
                    <span
                      key={i.id}
                      className="rounded-lg bg-tinta-100 px-2 py-1 text-[12px] text-tinta-700"
                    >
                      {i.detalhe
                        ? `${i.texto.replace(/\?$/, '')}: ${i.detalhe}`
                        : i.texto}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 border-t border-tinta-200 pt-4">
          <p className="eyebrow mb-1.5">Descrição da atividade por etapas</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-tinta-700">
            {apr.descricaoEtapas}
          </p>
        </div>
      </section>

      {janela === 'prorrogar' && (
        <JanelaDeMotivo
          titulo="Prorrogação"
          rotulo="Motivo da prorrogação"
          confirmar="Prorrogar"
          pendente={acao.isPending}
          onConfirmar={(motivo) => acao.mutate({ rota: 'prorrogar', corpo: { motivo } })}
          onFechar={() => setJanela(null)}
        />
      )}

      {janela === 'cancelar' && (
        <JanelaDeMotivo
          titulo="Cancelamento da APR"
          rotulo="Motivo do cancelamento"
          confirmar="Cancelar a APR"
          perigo
          pendente={acao.isPending}
          onConfirmar={(motivo) => acao.mutate({ rota: 'cancelar', corpo: { motivo } })}
          onFechar={() => setJanela(null)}
        />
      )}

      {janela === 'supervisao' && (
        <JanelaDeSupervisao
          nomePadrao={usuario?.nome ?? ''}
          pendente={acao.isPending}
          onConfirmar={(nome, assinaturaPng) =>
            acao.mutate({ rota: 'supervisao', corpo: { nome, assinaturaPng } })
          }
          onFechar={() => setJanela(null)}
        />
      )}
    </div>
  );
}

/** Prorrogar e cancelar pedem a mesma coisa: uma frase dizendo por quê. */
function JanelaDeMotivo({
  titulo,
  rotulo,
  confirmar,
  perigo,
  pendente,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  rotulo: string;
  confirmar: string;
  perigo?: boolean;
  pendente: boolean;
  onConfirmar: (motivo: string) => void;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState('');

  return (
    <Janela titulo={titulo} onFechar={onFechar}>
      <label className="rotulo" htmlFor="motivo">
        {rotulo}
      </label>
      <textarea
        id="motivo"
        className="campo min-h-[90px] resize-y"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        autoFocus
      />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="btn btn-neutro">
          Voltar
        </button>
        <button
          type="button"
          onClick={() => onConfirmar(motivo.trim())}
          disabled={motivo.trim().length < 5 || pendente}
          className={`btn ${perigo ? 'btn-perigo' : 'btn-primario'}`}
        >
          {pendente ? 'Enviando…' : confirmar}
        </button>
      </div>
    </Janela>
  );
}

/** O supervisor confere e assina embaixo — o campo "SUPERVISÃO" do papel. */
function JanelaDeSupervisao({
  nomePadrao,
  pendente,
  onConfirmar,
  onFechar,
}: {
  nomePadrao: string;
  pendente: boolean;
  onConfirmar: (nome: string, assinaturaPng: string) => void;
  onFechar: () => void;
}) {
  const controle = useRef<AssinaturaCanvasRef>(null);
  const [nome, setNome] = useState(nomePadrao);
  const [temTraco, setTemTraco] = useState(false);

  return (
    <Janela titulo="Supervisão" onFechar={onFechar}>
      <p className="text-sm leading-relaxed text-tinta-600">
        Ao assinar, o supervisor declara ter conferido esta análise preliminar
        de risco, os itens assinalados, o relato situacional e as assinaturas
        dos executantes.
      </p>

      <label className="rotulo mt-4" htmlFor="sup-nome">
        Seu nome
      </label>
      <input
        id="sup-nome"
        className="campo"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        autoComplete="name"
      />

      <div className="mt-4 flex items-center justify-between">
        <span className="rotulo mb-0">Assinatura</span>
        <button
          type="button"
          onClick={() => controle.current?.limpar()}
          className="btn btn-sutil btn-p"
        >
          Limpar
        </button>
      </div>
      <AssinaturaCanvas
        controle={controle}
        onMudou={setTemTraco}
        disabled={pendente}
      />

      <button
        type="button"
        onClick={() => {
          const png = controle.current?.exportar();
          if (png) onConfirmar(nome.trim(), png);
        }}
        disabled={!temTraco || nome.trim().length < 3 || pendente}
        className="btn btn-primario mt-5 w-full py-3"
      >
        {pendente ? 'Registrando…' : 'Registrar supervisão'}
      </button>
    </Janela>
  );
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
