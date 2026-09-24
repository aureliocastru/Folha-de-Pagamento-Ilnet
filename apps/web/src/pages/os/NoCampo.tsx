import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconeCaixa, IconeLupa, IconeOs, IconeRecolhido } from '../../components/icones';
import { LeitorDeCodigo, leitorDeCodigoSuportado } from '../../components/LeitorDeCodigo';
import { Aviso, Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento } from '../../lib/busca';
import {
  CONDICAO_LABEL,
  SITUACAO_LABEL,
  SITUACAO_TOM,
  TIPO_LABEL,
  TIPO_TOM,
  dataHoraCurta,
  identificacaoDaPeca,
  quantidadeComUnidade,
  type AparelhoParaInstalar,
  type ComodatoParaRetirar,
  type CondicaoDoRetirado,
  type ItemDeOs,
  type MaterialDaVan,
  type MinhasOs,
  type OsAberta,
  type OsNaLista,
  type PecaAchada,
  type ResultadoDaGravacao,
} from '../../lib/os';
import { VoltarAoInicio } from '../apr/Campo';

/**
 * As ordens de serviço no celular do técnico.
 *
 * A OS é do IXC — nasce no atendimento, e é lá que se finaliza. Aqui o técnico
 * diz o que fez com material dentro dela: o aparelho que tirou do cliente, o
 * que instalou no lugar, e o conector e o drop que gastou. Tudo sai e volta da
 * van dele, que é o almoxarifado dele no IXC.
 *
 * **Anotar e enviar são dois passos.** Anotar confere contra o IXC e guarda;
 * nada muda no estoque até o "Enviar ao IXC". É o que deixa o técnico anotar
 * no poste, sem sinal bom, e revisar antes de mexer no estoque de verdade.
 */

const CHAVE_LISTA = ['minhas-os'];

/** As OS do técnico: as abertas no IXC com ele, e as que ele acabou de fechar. */
export function CampoMinhasOs() {
  const navigate = useNavigate();
  const lista = useQuery({
    queryKey: CHAVE_LISTA,
    queryFn: async () => (await api.get<MinhasOs>('/minhas-os')).data,
    retry: 0,
  });
  const os = lista.data?.os ?? [];
  const abertas = os.filter((o) => !o.recusa);
  const fechadas = os.filter((o) => o.recusa);

  return (
    <div className="space-y-5">
      <VoltarAoInicio />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow mb-1">Minha área</p>
          <h1 className="titulo-pagina">Ordens de serviço</h1>
        </div>
        <button
          type="button"
          onClick={() => void lista.refetch()}
          disabled={lista.isFetching}
          className="btn btn-neutro btn-p"
        >
          {lista.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
        </button>
      </div>

      {lista.data && (
        <p className="text-[13px] text-tinta-500">
          O material sai de <strong className="text-tinta-800">{lista.data.tecnico.almox.nome}</strong>,
          o seu almoxarifado no IXC.
        </p>
      )}

      {lista.isLoading && <Carregando texto="Lendo suas OS no IXC…" />}
      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

      {lista.isSuccess && os.length === 0 && (
        <div className="rounded-2xl border border-dashed border-tinta-300 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-tinta-500">Nenhuma OS com você no IXC agora</p>
          <p className="mt-1 text-[13px] text-tinta-400">
            A OS aparece aqui quando o atendimento a passa para você.
          </p>
        </div>
      )}

      {abertas.length > 0 && (
        <div className="space-y-2">
          {abertas.map((o) => (
            <CartaoDaOs key={o.id} os={o} onAbrir={() => navigate(`/campo/os/${o.id}`)} />
          ))}
        </div>
      )}

      {fechadas.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Finalizadas há mais tempo</h2>
          <div className="space-y-2 opacity-70">
            {fechadas.map((o) => (
              <CartaoDaOs key={o.id} os={o} onAbrir={() => navigate(`/campo/os/${o.id}`)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CartaoDaOs({ os, onAbrir }: { os: OsNaLista; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} className="card card-hover w-full p-4 text-left">
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo tom={os.status === 'F' ? 'neutro' : 'info'} ponto>
          {os.statusNome}
        </Selo>
        {os.pendentes > 0 && (
          <Selo tom="atencao" pequeno>
            {os.pendentes} não enviado{os.pendentes > 1 ? 's' : ''}
          </Selo>
        )}
        {os.problemas > 0 && (
          <Selo tom="erro" pequeno>
            {os.problemas} com problema
          </Selo>
        )}
        <span className="ml-auto text-[11px] text-tinta-400">OS {os.id}</span>
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-tinta-900">
        {os.assunto ?? 'OS'} {os.cliente ? `— ${os.cliente}` : ''}
      </p>
      {os.endereco && <p className="mt-0.5 text-[13px] text-tinta-500">{os.endereco}</p>}
      <p className="mt-1 text-[12px] text-tinta-400">
        {os.agenda ? `Agendada ${dataHoraCurta(os.agenda)}` : `Aberta ${dataHoraCurta(os.abertura) ?? ''}`}
      </p>
    </button>
  );
}

type QualJanela = null | 'retirar' | 'fora' | 'instalar' | 'material';

/** Uma OS: o que foi anotado, os três botões, e o "Enviar ao IXC". */
export function CampoOs() {
  const { osId } = useParams<{ osId: string }>();
  const id = Number(osId);
  const qc = useQueryClient();
  const chave = ['minhas-os', id];
  const [janela, setJanela] = useState<QualJanela>(null);
  const [resultado, setResultado] = useState<{ tom: 'pago' | 'atencao' | 'erro'; texto: string } | null>(
    null,
  );

  const aberta = useQuery({
    queryKey: chave,
    queryFn: async () => (await api.get<OsAberta>(`/minhas-os/${id}`)).data,
    enabled: id > 0,
    retry: 0,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: CHAVE_LISTA });
  }

  const anotar = useMutation({
    mutationFn: async (pedido: Record<string, unknown>) =>
      (await api.post<ItemDeOs>(`/minhas-os/${id}/itens`, pedido)).data,
    onSuccess: () => {
      setJanela(null);
      setResultado(null);
      recarregar();
    },
  });

  const tirar = useMutation({
    mutationFn: async (itemId: string) => {
      await api.delete(`/minhas-os/${id}/itens/${itemId}`);
    },
    onSuccess: recarregar,
    onError: (e) => setResultado({ tom: 'erro', texto: mensagemErro(e) }),
  });

  const gravar = useMutation({
    mutationFn: async () =>
      (await api.post<ResultadoDaGravacao>(`/minhas-os/${id}/gravar`)).data,
    onSuccess: (r) => setResultado(resumoDaGravacao(r)),
    onError: (e) => setResultado({ tom: 'erro', texto: mensagemErro(e) }),
    onSettled: recarregar,
  });

  function abrir(qual: QualJanela) {
    anotar.reset();
    setJanela(qual);
  }

  if (!(id > 0)) return null;
  const dados = aberta.data;
  const itens = dados?.itens ?? [];
  const aEnviar = itens.filter((i) => i.situacao === 'PENDENTE' || i.situacao === 'FALHOU').length;
  const recusa = dados?.os.recusa ?? null;

  return (
    <div className="space-y-5 pb-24">
      <Link
        to="/campo/os"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-tinta-500 hover:text-tinta-800"
      >
        ‹ Minhas OS
      </Link>

      {aberta.isLoading && <Carregando texto="Lendo a OS, o comodato e a sua van no IXC…" />}
      {aberta.isError && <Aviso tom="erro">{mensagemErro(aberta.error)}</Aviso>}

      {dados && (
        <>
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Selo tom={dados.os.status === 'F' ? 'neutro' : 'info'} ponto>
                {dados.os.statusNome}
              </Selo>
              <span className="text-[12px] text-tinta-400">
                OS {dados.os.id}
                {dados.os.protocolo ? ` · protocolo ${dados.os.protocolo}` : ''}
              </span>
            </div>
            <h1 className="mt-2 font-display text-lg font-semibold leading-snug text-tinta-900">
              {dados.os.assunto ?? 'Ordem de serviço'}
            </h1>
            {dados.os.cliente && <p className="text-[14px] text-tinta-700">{dados.os.cliente}</p>}
            {dados.os.endereco && <p className="text-[13px] text-tinta-500">{dados.os.endereco}</p>}
            {dados.os.mensagem && (
              <p className="mt-2 whitespace-pre-line rounded-lg bg-tinta-50 px-3 py-2 text-[13px] text-tinta-600">
                {dados.os.mensagem}
              </p>
            )}
            <p className="mt-2 text-[12px] text-tinta-400">
              Material de <strong className="text-tinta-600">{dados.tecnico.almox.nome}</strong>
            </p>
          </div>

          {recusa && <Aviso tom="atencao">{recusa}</Aviso>}
          {resultado && <Aviso tom={resultado.tom}>{resultado.texto}</Aviso>}

          {!recusa && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <BotaoGrande
                icone={<IconeRecolhido className="h-5 w-5" />}
                titulo="Retirei"
                descricao="aparelho do cliente"
                onClick={() => abrir('retirar')}
              />
              <BotaoGrande
                icone={<IconeOs className="h-5 w-5" />}
                titulo="Instalei"
                descricao="aparelho novo"
                onClick={() => abrir('instalar')}
              />
              <BotaoGrande
                icone={<IconeCaixa className="h-5 w-5" />}
                titulo="Gastei"
                descricao="conector, drop…"
                onClick={() => abrir('material')}
              />
            </div>
          )}

          <section>
            <h2 className="eyebrow mb-2">Anotado nesta OS</h2>
            {itens.length === 0 ? (
              <p className="rounded-xl border border-dashed border-tinta-300 px-4 py-6 text-center text-[13px] text-tinta-400">
                Nada anotado ainda. Nada vai ao IXC até você tocar em "Enviar ao IXC".
              </p>
            ) : (
              <ul className="card lista-dividida">
                {itens.map((i) => (
                  <LinhaDoItem
                    key={i.id}
                    item={i}
                    tirando={tirar.isPending && tirar.variables === i.id}
                    onTirar={
                      i.situacao === 'PENDENTE' || i.situacao === 'FALHOU'
                        ? () => {
                            if (confirm(`Tirar "${i.descricao}" desta OS?`)) tirar.mutate(i.id);
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </section>

          {aEnviar > 0 && !recusa && (
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-tinta-200 bg-papel/95 px-4 py-3 backdrop-blur">
              <div className="mx-auto max-w-3xl">
                <button
                  type="button"
                  onClick={() => gravar.mutate()}
                  disabled={gravar.isPending}
                  className="btn btn-primario w-full justify-center py-3.5 text-base"
                >
                  {gravar.isPending
                    ? 'Gravando no IXC…'
                    : `Enviar ao IXC (${aEnviar} ite${aEnviar > 1 ? 'ns' : 'm'})`}
                </button>
              </div>
            </div>
          )}

          {janela === 'retirar' && (
            <JanelaRetirar
              comodatos={dados.paraRetirar}
              salvando={anotar.isPending}
              erro={anotar.error ? mensagemErro(anotar.error) : null}
              onAnotar={(pedido) => anotar.mutate({ tipo: 'RETIRADO', ...pedido })}
              onForaDaLista={() => abrir('fora')}
              onFechar={() => setJanela(null)}
            />
          )}
          {janela === 'fora' && (
            <JanelaForaDaLista
              salvando={anotar.isPending}
              erro={anotar.error ? mensagemErro(anotar.error) : null}
              onAnotar={(pedido) => anotar.mutate({ tipo: 'DIVERGENCIA', ...pedido })}
              onFechar={() => setJanela(null)}
            />
          )}
          {janela === 'instalar' && (
            <JanelaInstalar
              osId={id}
              aparelhos={dados.paraInstalar}
              semLista={dados.semListaDeAparelhos}
              salvando={anotar.isPending}
              erro={anotar.error ? mensagemErro(anotar.error) : null}
              onAnotar={(pedido) => anotar.mutate({ tipo: 'INSTALADO', ...pedido })}
              onFechar={() => setJanela(null)}
            />
          )}
          {janela === 'material' && (
            <JanelaMaterial
              materiais={dados.materiais}
              salvando={anotar.isPending}
              erro={anotar.error ? mensagemErro(anotar.error) : null}
              onAnotar={(pedido) => anotar.mutate({ tipo: 'MATERIAL', ...pedido })}
              onFechar={() => setJanela(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function resumoDaGravacao(r: ResultadoDaGravacao): { tom: 'pago' | 'atencao' | 'erro'; texto: string } {
  const partes = [
    r.gravados && `${r.gravados} gravado${r.gravados > 1 ? 's' : ''} no IXC`,
    r.falharam && `${r.falharam} recusado${r.falharam > 1 ? 's' : ''} (veja o motivo na lista)`,
    r.conferir && `${r.conferir} para a base conferir`,
    r.avisos && `${r.avisos} com aviso`,
  ].filter(Boolean);
  if (partes.length === 0) return { tom: 'atencao', texto: 'Não havia nada a enviar.' };
  return {
    tom: r.falharam || r.conferir ? 'erro' : r.avisos ? 'atencao' : 'pago',
    texto: partes.join(' · ') + '.',
  };
}

function BotaoGrande({
  icone,
  titulo,
  descricao,
  onClick,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card card-hover flex items-center gap-3 p-4 text-left sm:flex-col sm:items-start"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-300">
        {icone}
      </span>
      <span>
        <span className="block font-display text-[16px] font-semibold text-tinta-900">{titulo}</span>
        <span className="block text-[13px] text-tinta-500">{descricao}</span>
      </span>
    </button>
  );
}

function LinhaDoItem({
  item: i,
  tirando,
  onTirar,
}: {
  item: ItemDeOs;
  tirando: boolean;
  onTirar?: () => void;
}) {
  const peca = identificacaoDaPeca(i);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo tom={TIPO_TOM[i.tipo]} pequeno>
          {TIPO_LABEL[i.tipo]}
        </Selo>
        <Selo tom={SITUACAO_TOM[i.situacao]} pequeno ponto>
          {SITUACAO_LABEL[i.situacao]}
        </Selo>
        {i.condicao && (
          <Selo tom={i.condicao === 'DEFEITO' ? 'erro' : 'neutro'} pequeno>
            {CONDICAO_LABEL[i.condicao]}
          </Selo>
        )}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-tinta-900">{i.descricao}</p>
          <p className="text-[12px] text-tinta-500">
            {i.tipo === 'MATERIAL' ? quantidadeComUnidade(i.quantidade, i.unidade) : peca}
          </p>
          {i.observacao && <p className="mt-0.5 text-[12px] italic text-tinta-500">{i.observacao}</p>}
          {i.erro && <p className="mt-1 text-[12px] text-rose-600 dark:text-rose-300">{i.erro}</p>}
          {i.aviso && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{i.aviso}</p>}
        </div>
        {onTirar && (
          <button
            type="button"
            onClick={onTirar}
            disabled={tirando}
            className="btn btn-sutil btn-p shrink-0 text-rose-600"
          >
            {tirando ? 'Tirando…' : 'Tirar'}
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// As janelas de anotar
// ---------------------------------------------------------------------------

function EscolhaDaCondicao({
  valor,
  onMudar,
}: {
  valor: CondicaoDoRetirado | null;
  onMudar: (c: CondicaoDoRetirado) => void;
}) {
  return (
    <div>
      <p className="rotulo mb-1.5">Como o aparelho voltou?</p>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(CONDICAO_LABEL) as CondicaoDoRetirado[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onMudar(c)}
            className={`rounded-xl border px-2 py-2.5 text-[13px] font-medium transition ${
              valor === c
                ? c === 'DEFEITO'
                  ? 'border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200'
                  : 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200'
                : 'border-tinta-200 text-tinta-600 hover:border-tinta-300'
            }`}
          >
            {CONDICAO_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function RodapeDaJanela({
  erro,
  children,
}: {
  erro: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 space-y-3">
      {erro && (
        <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** O aparelho que saiu do cliente: escolhido entre os que o IXC tem em comodato no contrato. */
function JanelaRetirar({
  comodatos,
  salvando,
  erro,
  onAnotar,
  onForaDaLista,
  onFechar,
}: {
  comodatos: ComodatoParaRetirar[];
  salvando: boolean;
  erro: string | null;
  onAnotar: (p: { comodatoId: number; condicao: CondicaoDoRetirado; observacao: string }) => void;
  onForaDaLista: () => void;
  onFechar: () => void;
}) {
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [condicao, setCondicao] = useState<CondicaoDoRetirado | null>(null);
  const [observacao, setObservacao] = useState('');

  return (
    <Janela titulo="Retirei um aparelho" onFechar={onFechar}>
      <p className="mb-3 text-[13px] text-tinta-500">
        O que o IXC tem emprestado neste contrato. O aparelho volta para a sua van no IXC, e fica
        com você até a base receber.
      </p>

      {comodatos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-tinta-300 px-4 py-5 text-center text-[13px] text-tinta-500">
          O IXC não tem nenhum aparelho em comodato neste contrato.
        </p>
      ) : (
        <div className="space-y-2">
          {comodatos.map((c) => {
            const bloqueado = !!c.motivo;
            const marcado = escolhido === c.comodatoId;
            return (
              <button
                key={c.comodatoId}
                type="button"
                disabled={bloqueado}
                onClick={() => setEscolhido(c.comodatoId)}
                className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                  marcado
                    ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10'
                    : 'border-tinta-200 hover:border-tinta-300'
                } ${bloqueado ? 'opacity-60' : ''}`}
              >
                <p className="text-[14px] font-medium text-tinta-900">{c.produto}</p>
                <p className="text-[12px] text-tinta-500">
                  {identificacaoDaPeca(c) || `comodato ${c.comodatoId}`}
                  {c.desde ? ` · desde ${c.desde.split('-').reverse().join('/')}` : ''}
                </p>
                {c.motivo && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{c.motivo}</p>}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onForaDaLista}
        className="mt-2 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300"
      >
        O aparelho que eu tirei não está na lista
      </button>

      <div className="mt-4 space-y-3">
        <EscolhaDaCondicao valor={condicao} onMudar={setCondicao} />
        <div>
          <label className="rotulo" htmlFor="os-ret-obs">
            Observação {condicao === 'DEFEITO' ? '(qual o defeito?)' : '(opcional)'}
          </label>
          <textarea
            id="os-ret-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
            rows={2}
            className="campo"
          />
        </div>
      </div>

      <RodapeDaJanela erro={erro}>
        <button
          type="button"
          disabled={!escolhido || !condicao || salvando}
          onClick={() =>
            escolhido && condicao && onAnotar({ comodatoId: escolhido, condicao, observacao })
          }
          className="btn btn-primario flex-1 justify-center"
        >
          {salvando ? 'Anotando…' : 'Anotar retirada'}
        </button>
        <button type="button" onClick={onFechar} className="btn btn-sutil">
          Cancelar
        </button>
      </RodapeDaJanela>
    </Janela>
  );
}

/** O campo do código, com a câmera ao lado. */
function CampoDoCodigo({
  id,
  valor,
  onMudar,
  onLido,
  onEnter,
}: {
  id: string;
  valor: string;
  onMudar: (v: string) => void;
  onLido: (codigo: string) => void;
  onEnter?: () => void;
}) {
  const [lendo, setLendo] = useState(false);
  return (
    <>
      <div className="flex gap-2">
        <input
          id={id}
          value={valor}
          onChange={(e) => onMudar(e.target.value.slice(0, 80))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder="MAC, série ou nº da etiqueta"
          autoComplete="off"
          autoCapitalize="characters"
          className="campo num min-w-0 flex-1"
        />
        {leitorDeCodigoSuportado() && (
          <button type="button" onClick={() => setLendo(true)} className="btn btn-neutro shrink-0">
            Câmera
          </button>
        )}
      </div>
      {lendo && (
        <LeitorDeCodigo
          alvo="etiqueta"
          onLido={(codigo) => {
            setLendo(false);
            onLido(codigo);
          }}
          onFechar={() => setLendo(false)}
        />
      )}
    </>
  );
}

/**
 * O aparelho que o técnico trouxe e que o IXC não tem no contrato. Não mexe no
 * IXC: fica anotado, com o que o IXC sabe da peça, e a base confere.
 */
function JanelaForaDaLista({
  salvando,
  erro,
  onAnotar,
  onFechar,
}: {
  salvando: boolean;
  erro: string | null;
  onAnotar: (p: {
    codigo: string;
    descricao: string;
    condicao: CondicaoDoRetirado;
    observacao: string;
  }) => void;
  onFechar: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [condicao, setCondicao] = useState<CondicaoDoRetirado | null>(null);
  const [observacao, setObservacao] = useState('');
  const temOQue = codigo.trim().length >= 3 || descricao.trim().length >= 2;

  return (
    <Janela titulo="Aparelho fora da lista" onFechar={onFechar}>
      <p className="mb-3 text-[13px] text-tinta-500">
        O IXC não tem este aparelho em comodato neste contrato. Ele fica anotado para a base
        conferir — nada muda no IXC agora. Entregue o aparelho na base.
      </p>
      <div className="space-y-3">
        <div>
          <label className="rotulo" htmlFor="os-fora-codigo">
            Código da etiqueta
          </label>
          <CampoDoCodigo id="os-fora-codigo" valor={codigo} onMudar={setCodigo} onLido={setCodigo} />
        </div>
        <div>
          <label className="rotulo" htmlFor="os-fora-desc">
            O que é
          </label>
          <input
            id="os-fora-desc"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value.slice(0, 200))}
            placeholder="Ex.: roteador TP-Link branco"
            className="campo"
          />
        </div>
        <EscolhaDaCondicao valor={condicao} onMudar={setCondicao} />
        <div>
          <label className="rotulo" htmlFor="os-fora-obs">
            Observação (opcional)
          </label>
          <textarea
            id="os-fora-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
            rows={2}
            className="campo"
          />
        </div>
      </div>
      <RodapeDaJanela erro={erro}>
        <button
          type="button"
          disabled={!temOQue || !condicao || salvando}
          onClick={() => condicao && onAnotar({ codigo, descricao, condicao, observacao })}
          className="btn btn-primario flex-1 justify-center"
        >
          {salvando ? 'Anotando…' : 'Anotar para a base conferir'}
        </button>
        <button type="button" onClick={onFechar} className="btn btn-sutil">
          Cancelar
        </button>
      </RodapeDaJanela>
    </Janela>
  );
}

/**
 * O aparelho novo: bipado (ou tocado na lista da van), conferido contra o IXC
 * — tem de estar na van dele, na prateleira, e não pode ser um recolhido que
 * ainda não passou pela base.
 */
function JanelaInstalar({
  osId,
  aparelhos,
  semLista,
  salvando,
  erro,
  onAnotar,
  onFechar,
}: {
  osId: number;
  aparelhos: AparelhoParaInstalar[];
  /** A base ainda não montou a lista de aparelhos: nada se instala. */
  semLista: boolean;
  salvando: boolean;
  erro: string | null;
  onAnotar: (p: { codigo: string; patrimonioId: number; observacao: string }) => void;
  onFechar: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [observacao, setObservacao] = useState('');

  const procurar = useMutation({
    mutationFn: async (c: string) =>
      (
        await api.get<{ peca: PecaAchada; motivo: string | null }>(`/minhas-os/${osId}/aparelho`, {
          params: { codigo: c },
        })
      ).data,
  });

  function buscar(c: string) {
    const limpo = c.trim();
    setCodigo(limpo);
    if (limpo.length >= 3) procurar.mutate(limpo);
  }

  const achado = procurar.data;

  return (
    <Janela titulo="Instalei um aparelho" onFechar={onFechar}>
      {semLista && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          A base ainda não montou a lista de aparelhos de cliente, e sem ela não dá para separar a
          ONU da ferramenta. Peça à base para incluir os modelos.
        </p>
      )}
      <div className="space-y-3">
        <div>
          <label className="rotulo" htmlFor="os-inst-codigo">
            Leia a etiqueta do aparelho novo
          </label>
          <CampoDoCodigo
            id="os-inst-codigo"
            valor={codigo}
            onMudar={(v) => {
              setCodigo(v);
              procurar.reset();
            }}
            onLido={buscar}
            onEnter={() => buscar(codigo)}
          />
          <button
            type="button"
            onClick={() => buscar(codigo)}
            disabled={codigo.trim().length < 3 || procurar.isPending}
            className="btn btn-neutro btn-p mt-2"
          >
            <IconeLupa className="h-4 w-4" />
            {procurar.isPending ? 'Procurando no IXC…' : 'Procurar'}
          </button>
        </div>

        {procurar.isError && (
          <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
            {mensagemErro(procurar.error)}
          </p>
        )}

        {achado && (
          <div
            className={`rounded-xl border px-3.5 py-3 ${
              achado.motivo
                ? 'border-rose-300 bg-rose-50/60 dark:bg-rose-500/10'
                : 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-500/10'
            }`}
          >
            <p className="text-[14px] font-semibold text-tinta-900">{achado.peca.descricao}</p>
            <p className="text-[12px] text-tinta-500">{identificacaoDaPeca(achado.peca)}</p>
            <p className="text-[12px] text-tinta-500">
              {achado.peca.situacao} · {achado.peca.almoxarifado || 'sem almoxarifado'}
            </p>
            {achado.motivo && (
              <p className="mt-1.5 text-[13px] text-rose-700 dark:text-rose-200">{achado.motivo}</p>
            )}
          </div>
        )}

        {achado && !achado.motivo && (
          <div>
            <label className="rotulo" htmlFor="os-inst-obs">
              Observação (opcional)
            </label>
            <textarea
              id="os-inst-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
              rows={2}
              className="campo"
            />
          </div>
        )}

        {!achado && aparelhos.length > 0 && (
          <div>
            <p className="rotulo mb-1.5">Ou toque num aparelho da sua van</p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {aparelhos.map((a) => {
                const codigoDele = a.mac ?? a.numeroSerie ?? a.numeroPatrimonial;
                const bloqueio = a.motivo ?? (codigoDele ? null : 'sem MAC nem série no IXC — bipe a etiqueta');
                return (
                  <button
                    key={a.patrimonioId}
                    type="button"
                    disabled={!!bloqueio || procurar.isPending}
                    onClick={() => codigoDele && buscar(codigoDele)}
                    className={`w-full rounded-xl border border-tinta-200 px-3 py-2 text-left hover:border-tinta-300 ${
                      bloqueio ? 'opacity-60' : ''
                    }`}
                  >
                    <p className="text-[13px] font-medium text-tinta-900">{a.descricao}</p>
                    <p className="text-[12px] text-tinta-500">{identificacaoDaPeca(a)}</p>
                    {bloqueio && <p className="text-[12px] text-amber-700 dark:text-amber-300">{bloqueio}</p>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <RodapeDaJanela erro={erro}>
        <button
          type="button"
          disabled={!achado || !!achado.motivo || salvando}
          onClick={() =>
            achado && onAnotar({ codigo, patrimonioId: achado.peca.patrimonioId, observacao })
          }
          className="btn btn-primario flex-1 justify-center"
        >
          {salvando ? 'Anotando…' : 'Anotar instalação'}
        </button>
        <button type="button" onClick={onFechar} className="btn btn-sutil">
          Cancelar
        </button>
      </RodapeDaJanela>
    </Janela>
  );
}

/** O material que se gasta: escolhido na lista curta, com o que ele tem na van. */
function JanelaMaterial({
  materiais,
  salvando,
  erro,
  onAnotar,
  onFechar,
}: {
  materiais: MaterialDaVan[];
  salvando: boolean;
  erro: string | null;
  onAnotar: (p: { produtoId: number; quantidade: number; observacao: string }) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<MaterialDaVan | null>(null);
  const [quantidade, setQuantidade] = useState('1');
  const [observacao, setObservacao] = useState('');

  const filtrados = useMemo(() => {
    const termo = semAcento(busca.trim().toLowerCase());
    return termo
      ? materiais.filter((m) => semAcento(m.descricao.toLowerCase()).includes(termo))
      : materiais;
  }, [busca, materiais]);

  const qtd = Number(quantidade.replace(',', '.'));
  const acimaDoTeto =
    !!escolhido && escolhido.maximoPorOs !== null && escolhido.jaNestaOs + qtd > escolhido.maximoPorOs;
  const semSaldo = !!escolhido && qtd > escolhido.livre;
  const valido = !!escolhido && qtd > 0 && !semSaldo && (!acimaDoTeto || observacao.trim().length >= 5);

  function mudar(delta: number) {
    const n = Math.max(0, (Number.isFinite(qtd) ? qtd : 0) + delta);
    setQuantidade(String(Math.round(n * 1000) / 1000));
  }

  return (
    <Janela titulo="Gastei material" onFechar={onFechar}>
      {!escolhido ? (
        <>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar material…"
            className="campo mb-3"
            autoComplete="off"
          />
          {materiais.length === 0 ? (
            <p className="text-[13px] text-tinta-500">
              A lista de materiais de OS está vazia. Peça à base para montar.
            </p>
          ) : (
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {filtrados.map((m) => (
                <button
                  key={m.produtoId}
                  type="button"
                  onClick={() => {
                    setEscolhido(m);
                    setQuantidade('1');
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-tinta-200 px-3.5 py-3 text-left hover:border-tinta-300"
                >
                  <span className="text-[14px] font-medium text-tinta-900">{m.descricao}</span>
                  <span
                    className={`num shrink-0 text-[12px] ${m.livre > 0 ? 'text-tinta-500' : 'text-rose-600'}`}
                  >
                    tem {quantidadeComUnidade(Math.max(0, m.livre), m.unidade)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-tinta-900">{escolhido.descricao}</p>
              <p className="text-[12px] text-tinta-500">
                Na sua van: {quantidadeComUnidade(Math.max(0, escolhido.livre), escolhido.unidade)}
                {escolhido.maximoPorOs !== null &&
                  ` · normal até ${quantidadeComUnidade(escolhido.maximoPorOs, escolhido.unidade)} por OS`}
                {escolhido.jaNestaOs > 0 &&
                  ` · já tem ${quantidadeComUnidade(escolhido.jaNestaOs, escolhido.unidade)} nesta OS`}
              </p>
            </div>
            <button type="button" onClick={() => setEscolhido(null)} className="btn btn-sutil btn-p">
              Trocar
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => mudar(-1)} className="btn btn-neutro h-12 w-12 justify-center text-xl">
              −
            </button>
            <input
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 10))}
              inputMode="decimal"
              aria-label="Quantidade"
              className="campo num h-12 flex-1 text-center text-lg"
            />
            <button type="button" onClick={() => mudar(1)} className="btn btn-neutro h-12 w-12 justify-center text-xl">
              +
            </button>
            {escolhido.unidade && <span className="text-sm text-tinta-500">{escolhido.unidade}</span>}
          </div>

          {semSaldo && (
            <p className="text-[13px] text-rose-600 dark:text-rose-300">
              Sua van no IXC não tem isso tudo. Se o material está com você, falta a transferência
              para o seu almoxarifado.
            </p>
          )}

          <div>
            <label className="rotulo" htmlFor="os-mat-obs">
              {acimaDoTeto ? 'Por que mais que o normal? (obrigatório)' : 'Observação (opcional)'}
            </label>
            <textarea
              id="os-mat-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
              rows={2}
              className="campo"
            />
          </div>
        </div>
      )}

      <RodapeDaJanela erro={erro}>
        <button
          type="button"
          disabled={!valido || salvando}
          onClick={() =>
            escolhido && onAnotar({ produtoId: escolhido.produtoId, quantidade: qtd, observacao })
          }
          className="btn btn-primario flex-1 justify-center"
        >
          {salvando ? 'Anotando…' : 'Anotar material'}
        </button>
        <button type="button" onClick={onFechar} className="btn btn-sutil">
          Cancelar
        </button>
      </RodapeDaJanela>
    </Janela>
  );
}
