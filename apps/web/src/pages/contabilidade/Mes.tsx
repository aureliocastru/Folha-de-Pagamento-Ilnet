import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Aviso, CabecalhoPagina, CampoDinheiro, Carregando, Janela, Pagina, Selo, type Tom } from '../../components/ui';
import { api, mensagemErro, mensagemErroDeArquivo } from '../../lib/api';
import { abrirNumaAba, motivoDoErroEmArquivo } from '../../lib/arquivo';
import { semAcento } from '../../lib/busca';
import { prepararArquivo } from '../../lib/foto';
import { formatBRL } from '../../lib/format';
import {
  diaBr,
  nomeDoPeriodo,
  tamanhoLegivel,
  type Comprovante,
  type Estado,
  type ItemNaTela,
  type LinhaDoResumo,
  type PacoteNaTela,
  type PagamentoNaLista,
  type Vaga,
} from './tipos';

const ESTADO: Record<Estado, { texto: string; tom: Tom }> = {
  pronto: { texto: 'Pronto', tom: 'pago' },
  atencao: { texto: 'Pronto · conferir', tom: 'atencao' },
  nao_teve: { texto: 'Não teve', tom: 'neutro' },
  falta: { texto: 'Falta', tom: 'erro' },
  lendo: { texto: 'Lendo o IXC', tom: 'info' },
  erro: { texto: 'Erro na leitura', tom: 'erro' },
};

/** Os itens que leem o IXC (ou o caixa daqui) e podem ser lidos de novo. */
const LIDOS_DO_IXC = new Set([1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

/** Os itens em que "não teve" é marca de quem envia, e não conta do sistema. */
const MARCA_NAO_TEVE = new Set([2, 3, 4, 16, 17]);

/** A chave da consulta do período, para todo componente daqui invalidar a mesma. */
const chaveDoPacote = (id: string) => ['contabilidade', 'pacote', id];

/** O navegador manda o OFX sem tipo; a API precisa de um. */
function dadosComTipo(dados: string): string {
  return dados.replace(/^data:;base64,/, 'data:application/octet-stream;base64,');
}

/**
 * Abre na aba o arquivo da API com o tipo que ela disse — PDF e foto abrem
 * para ver; planilha e OFX descem.
 */
function abrirDaApi(caminho: string, nome: string): Promise<void> {
  return abrirNumaAba(async () => {
    try {
      return (await api.get<Blob>(caminho, { responseType: 'blob' })).data;
    } catch (e) {
      throw new Error(await motivoDoErroEmArquivo(e));
    }
  }, nome);
}

async function baixarBlob(caminho: string, nome: string): Promise<void> {
  const res = await api.get<Blob>(caminho, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * O período aberto: os vinte itens do papel da contabilidade, com o que já
 * está pronto e o que falta.
 *
 * O que sai do IXC chega sozinho (a leitura corre por fora, e a tela se
 * atualiza enquanto ela anda). O que só existe fora — extrato, contrato,
 * relatório da maquininha, o comprovante de um pagamento — tem a vaga dele
 * no cartão do item. No fim, "Baixar pacote" entrega o zip para mandar.
 */
export function MesDaContabilidade() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<'falta' | 'todos'>('todos');
  const [lista, setLista] = useState<ItemNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  const pacote = useQuery({
    queryKey: chaveDoPacote(id),
    queryFn: async () => (await api.get<PacoteNaTela>(`/contabilidade/pacotes/${id}`)).data,
    // Enquanto o IXC está sendo lido, a tela acompanha.
    refetchInterval: (q) => (q.state.data?.lendo ? 3000 : false),
  });

  const lerDeNovo = useMutation({
    mutationFn: async (itens?: number[]) => api.post(`/contabilidade/pacotes/${id}/ler`, { itens }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDoPacote(id) }),
    onError: (e) => setErro(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: async () => api.delete(`/contabilidade/pacotes/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contabilidade', 'pacotes'] });
      navigate('/contabilidade/meses');
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  async function baixarPacote(p: PacoteNaTela) {
    setErro(null);
    setBaixando(true);
    try {
      await baixarBlob(
        `/contabilidade/pacotes/${p.id}/zip`,
        `Contabilidade ${diaBr(p.de).replace(/\//g, '-')} a ${diaBr(p.ate).replace(/\//g, '-')}.zip`,
      );
      void qc.invalidateQueries({ queryKey: chaveDoPacote(id) });
    } catch (e) {
      setErro(await mensagemErroDeArquivo(e));
    } finally {
      setBaixando(false);
    }
  }

  if (pacote.isLoading) return <Pagina><Carregando /></Pagina>;
  if (pacote.isError || !pacote.data) {
    return (
      <Pagina>
        <Aviso tom="erro">{mensagemErro(pacote.error)}</Aviso>
      </Pagina>
    );
  }

  const p = pacote.data;
  const faltando = p.itens.filter((i) => ['falta', 'erro'].includes(i.estado));
  const itens = filtro === 'falta' ? faltando : p.itens;
  const pronto = faltando.length === 0 && !p.lendo;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contabilidade"
        titulo={nomeDoPeriodo(p.de, p.ate)}
        voltar={() => navigate('/contabilidade/meses')}
        acoes={
          <>
            <button
              type="button"
              className="btn btn-neutro"
              disabled={p.lendo || lerDeNovo.isPending}
              onClick={() => lerDeNovo.mutate(undefined)}
            >
              {p.lendo ? 'Lendo o IXC…' : 'Ler o IXC de novo'}
            </button>
            <button
              type="button"
              className={`btn ${pronto ? 'btn-primario' : 'btn-acao'}`}
              disabled={baixando}
              onClick={() => void baixarPacote(p)}
            >
              {baixando ? 'Montando o zip…' : 'Baixar pacote'}
            </button>
          </>
        }
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="card mb-5 p-4 md:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Prontos</p>
            <p className="num font-display text-[26px] font-semibold leading-none text-tinta-900">
              {p.prontos} <span className="text-base text-tinta-400">de {p.itens.length}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Prazo</p>
            <p className="font-display text-lg font-semibold text-tinta-900">{diaBr(p.prazo)}</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-tinta-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all"
            style={{ width: `${Math.round((p.prontos / p.itens.length) * 100)}%` }}
          />
        </div>
        {p.lendo && <p className="mt-3 text-sm text-sky-700 dark:text-sky-300">Lendo o IXC…</p>}
        {pronto && <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Tudo pronto para mandar.</p>}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn btn-p ${filtro === 'todos' ? 'btn-ferramenta' : 'btn-neutro'}`}
          onClick={() => setFiltro('todos')}
        >
          Todos ({p.itens.length})
        </button>
        <button
          type="button"
          className={`btn btn-p ${filtro === 'falta' ? 'btn-alerta' : 'btn-neutro'}`}
          onClick={() => setFiltro('falta')}
        >
          O que falta ({faltando.length})
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {itens.map((item) => (
          <CartaoDoItem
            key={item.numero}
            item={item}
            pacote={p}
            lendo={p.lendo}
            onLista={() => setLista(item)}
            onLerDeNovo={() => lerDeNovo.mutate([item.numero])}
          />
        ))}
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          className="btn btn-perigo"
          disabled={apagar.isPending}
          onClick={() => {
            if (window.confirm(`Apagar ${nomeDoPeriodo(p.de, p.ate)} com tudo que foi enviado nele?`)) apagar.mutate();
          }}
        >
          Apagar este período
        </button>
      </div>

      {lista && <JanelaDePagamentos pacoteId={p.id} item={lista} onFechar={() => setLista(null)} />}
    </Pagina>
  );
}

// ---------------------------------------------------------------------------
// O cartão de um item
// ---------------------------------------------------------------------------

function CartaoDoItem({
  item,
  pacote,
  lendo,
  onLista,
  onLerDeNovo,
}: {
  item: ItemNaTela;
  pacote: PacoteNaTela;
  lendo: boolean;
  onLista: () => void;
  onLerDeNovo: () => void;
}) {
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);
  const estado = ESTADO[item.estado];
  const destaque = item.resumo.find((r) => r.destaque);
  const outros = item.resumo.filter((r) => r !== destaque);

  const marcar = useMutation({
    mutationFn: async (dados: { naoTeve: boolean; observacao?: string | null }) =>
      api.put(`/contabilidade/pacotes/${pacote.id}/marcas`, { item: item.numero, ...dados }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDoPacote(pacote.id) }),
    onError: (e) => setErro(mensagemErro(e)),
  });

  async function baixarPlanilha() {
    setErro(null);
    setBaixando(true);
    try {
      await baixarBlob(
        `/contabilidade/pacotes/${pacote.id}/itens/${item.numero}/planilha`,
        `${String(item.numero).padStart(2, '0')} - ${item.titulo}.xlsx`,
      );
    } catch (e) {
      setErro(await mensagemErroDeArquivo(e));
    } finally {
      setBaixando(false);
    }
  }

  // As vagas por grupo (a conta, o cartão): é como se acha a de um banco.
  const grupos = useMemo(() => {
    const mapa = new Map<string, Vaga[]>();
    for (const v of item.vagas) {
      const g = v.grupo ?? '';
      mapa.set(g, [...(mapa.get(g) ?? []), v]);
    }
    return [...mapa.entries()];
  }, [item.vagas]);

  return (
    <section className="card flex flex-col overflow-hidden">
      <div className="faixa-titulo flex items-start gap-3 px-4 py-3">
        <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 font-display text-sm font-bold text-brand-700 dark:text-brand-300">
          {String(item.numero).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold leading-snug text-tinta-900">{item.titulo}</h2>
          <p className="text-xs text-tinta-500">{item.pedido}</p>
        </div>
        <Selo tom={estado.tom} ponto={item.estado === 'lendo'}>
          {estado.texto}
        </Selo>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        {destaque && (
          <div>
            <p className="eyebrow">{destaque.rotulo}</p>
            <p className="num font-display text-[22px] font-semibold leading-tight text-tinta-900">
              {valorDoResumo(destaque)}
            </p>
          </div>
        )}
        {outros.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {outros.map((r) => (
              <div key={r.rotulo} className="flex min-w-0 justify-between gap-2">
                <dt className="truncate text-tinta-500">{r.rotulo}</dt>
                <dd className="num shrink-0 font-semibold text-tinta-800">{valorDoResumo(r)}</dd>
              </div>
            ))}
          </dl>
        )}

        {item.erro && item.estado === 'erro' && (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{item.erro}</p>
        )}
        {item.pendencias.length > 0 && item.estado !== 'lendo' && (
          <ul className="space-y-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
            {item.pendencias.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        )}
        {item.avisos.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
            {item.avisos.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        )}
        {item.naoTeve && item.observacao && <p className="text-sm text-tinta-500">{item.observacao}</p>}

        {grupos.map(([grupo, vagas]) => (
          <div key={grupo || 'sem-grupo'} className="rounded-xl border border-tinta-100 p-3">
            {grupo && <p className="mb-2 text-sm font-semibold text-tinta-800">{grupo}</p>}
            <div className="space-y-3">
              {vagas.map((v) =>
                v.tipo === 'valor' ? (
                  <VagaDeValor key={v.chave} vaga={v} item={item} pacoteId={pacote.id} />
                ) : (
                  <VagaDeArquivo key={v.chave} vaga={v} item={item} pacoteId={pacote.id} />
                ),
              )}
            </div>
          </div>
        ))}

        {erro && <p className="text-sm text-rose-700 dark:text-rose-300">{erro}</p>}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {item.temLista && (
            <button type="button" className="btn btn-p btn-ferramenta" onClick={onLista}>
              {item.numero === 14 ? 'Ver pagamentos e notas' : 'Ver pagamentos e comprovantes'}
            </button>
          )}
          {item.temPlanilha && (
            <button type="button" className="btn btn-p btn-neutro" disabled={baixando} onClick={() => void baixarPlanilha()}>
              {baixando ? 'Baixando…' : 'Baixar planilha'}
            </button>
          )}
          {MARCA_NAO_TEVE.has(item.numero) &&
            (item.naoTeve ? (
              <button
                type="button"
                className="btn btn-p btn-neutro"
                disabled={marcar.isPending}
                onClick={() => marcar.mutate({ naoTeve: false })}
              >
                Desfazer "não teve"
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-p btn-neutro"
                disabled={marcar.isPending}
                onClick={() => marcar.mutate({ naoTeve: true })}
              >
                {item.numero === 3 ? 'Não tem empréstimo' : 'Não teve no período'}
              </button>
            ))}
          {item.ajuste && (
            <Link to={`/contabilidade/ajustes#${item.ajuste}`} className="btn btn-p btn-sutil">
              Ajustar
            </Link>
          )}
          {LIDOS_DO_IXC.has(item.numero) && item.origem !== 'arquivo' && (
            <button type="button" className="btn btn-p btn-sutil" disabled={lendo} onClick={onLerDeNovo}>
              Ler de novo
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function valorDoResumo(r: LinhaDoResumo): string {
  if (r.tipo === 'moeda' && typeof r.valor === 'number') return formatBRL(r.valor);
  if (r.tipo === 'numero' && typeof r.valor === 'number') return r.valor.toLocaleString('pt-BR');
  return String(r.valor);
}

// ---------------------------------------------------------------------------
// As vagas
// ---------------------------------------------------------------------------

function VagaDeArquivo({ vaga, item, pacoteId }: { vaga: Vaga; item: ItemNaTela; pacoteId: string }) {
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const atualizar = () => void qc.invalidateQueries({ queryKey: chaveDoPacote(pacoteId) });

  async function enviar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setErro(null);
    const lista = vaga.multiplo ? [...arquivos] : [arquivos[0]];
    setEnviando(lista.length);
    try {
      for (const arquivo of lista) {
        const { nome, dados } = await prepararArquivo(arquivo);
        await api.post(`/contabilidade/pacotes/${pacoteId}/arquivos`, {
          item: item.numero,
          chave: vaga.chave,
          nome,
          arquivo: dadosComTipo(dados),
        });
        setEnviando((n) => n - 1);
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(0);
      if (entrada.current) entrada.current.value = '';
      atualizar();
    }
  }

  const tirar = useMutation({
    mutationFn: async (id: string) => api.delete(`/contabilidade/arquivos/${id}`),
    onSuccess: atualizar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  const marcar = useMutation({
    mutationFn: async (naoTem: boolean) =>
      api.put(`/contabilidade/pacotes/${pacoteId}/marcas`, {
        item: item.numero,
        chave: vaga.chave,
        naoTeve: naoTem,
        observacao: naoTem ? vaga.rotuloDoNaoTem : null,
      }),
    onSuccess: atualizar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  const falta = vaga.obrigatoria && vaga.arquivos.length === 0 && !vaga.naoTem;
  const podeEnviarMais = vaga.multiplo || vaga.arquivos.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm ${falta ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-tinta-700'}`}>
          {vaga.rotulo}
          {!vaga.obrigatoria && <span className="ml-1 text-xs font-normal text-tinta-400">(se tiver)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {!vaga.naoTem && (
            <>
              <input
                ref={entrada}
                type="file"
                className="hidden"
                accept={vaga.aceita === '*' ? undefined : vaga.aceita}
                multiple={vaga.multiplo}
                onChange={(e) => void enviar(e.target.files)}
              />
              <button
                type="button"
                className={`btn btn-p ${falta ? 'btn-pagar' : 'btn-ferramenta'}`}
                disabled={enviando > 0}
                onClick={() => entrada.current?.click()}
              >
                {enviando > 0 ? 'Enviando…' : podeEnviarMais ? 'Enviar' : 'Trocar'}
              </button>
            </>
          )}
          {vaga.rotuloDoNaoTem && vaga.arquivos.length === 0 && (
            <button
              type="button"
              className="btn btn-p btn-sutil"
              disabled={marcar.isPending}
              onClick={() => marcar.mutate(!vaga.naoTem)}
            >
              {vaga.naoTem ? `${vaga.motivo ?? vaga.rotuloDoNaoTem} · desfazer` : vaga.rotuloDoNaoTem}
            </button>
          )}
        </div>
      </div>
      {vaga.arquivos.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {vaga.arquivos.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
              <button
                type="button"
                className="min-w-0 truncate text-left text-brand-700 hover:underline dark:text-brand-300"
                onClick={() =>
                  void abrirDaApi(`/contabilidade/arquivos/${a.id}`, a.nome).catch((e: unknown) =>
                    setErro(e instanceof Error ? e.message : String(e)),
                  )
                }
              >
                {a.nome}
              </button>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-tinta-400">{a.detalhe ?? tamanhoLegivel(a.tamanho)}</span>
                <button
                  type="button"
                  className="btn btn-p btn-alerta"
                  disabled={tirar.isPending}
                  onClick={() => {
                    if (window.confirm(`Tirar "${a.nome}"?`)) tirar.mutate(a.id);
                  }}
                >
                  Tirar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{erro}</p>}
    </div>
  );
}

function VagaDeValor({ vaga, item, pacoteId }: { vaga: Vaga; item: ItemNaTela; pacoteId: string }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(vaga.valor != null ? vaga.valor.toFixed(2) : '');
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: async () =>
      api.put(`/contabilidade/pacotes/${pacoteId}/marcas`, {
        item: item.numero,
        chave: vaga.chave,
        valor: valor === '' ? null : Number(valor),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDoPacote(pacoteId) }),
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <div>
      <label className="rotulo" htmlFor={vaga.chave}>
        {vaga.rotulo}
      </label>
      <div className="flex min-w-0 gap-2">
        <div className="min-w-0 flex-1">
          <CampoDinheiro id={vaga.chave} valor={valor} onChange={setValor} />
        </div>
        <button type="button" className="btn btn-pagar" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      {erro && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{erro}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Os pagamentos e o comprovante de cada um (itens 8, 13, 14, 18)
// ---------------------------------------------------------------------------

/** Os motivos de um pagamento não ter papel — os que a contabilidade aceita sem nota. */
const MOTIVOS = [
  'Tarifa bancária',
  'Imposto (a guia está com a contabilidade)',
  'Folha de pagamento (a contabilidade tem o recibo)',
  'Transferência entre contas da empresa',
  'Empréstimo / financiamento (está no contrato)',
  'Outro',
];

function JanelaDePagamentos({ pacoteId, item, onFechar }: { pacoteId: string; item: ItemNaTela; onFechar: () => void }) {
  const [busca, setBusca] = useState('');
  const [soSem, setSoSem] = useState(item.numero === 8);

  const pagamentos = useQuery({
    queryKey: ['contabilidade', 'pagamentos', pacoteId, item.numero],
    queryFn: async () =>
      (await api.get<{ pagamentos: PagamentoNaLista[] }>(`/contabilidade/pacotes/${pacoteId}/itens/${item.numero}/pagamentos`))
        .data.pagamentos,
  });

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    return (pagamentos.data ?? []).filter((p) => {
      if (soSem && (p.comprovantes.length > 0 || p.semComprovante)) return false;
      if (!termo) return true;
      return semAcento(`${p.fornecedor} ${p.idFnApagar} ${p.notaFiscal} ${p.observacao} ${p.conta}`).includes(termo);
    });
  }, [pagamentos.data, busca, soSem]);

  const sem = (pagamentos.data ?? []).filter((p) => p.comprovantes.length === 0 && !p.semComprovante).length;

  return (
    <Janela titulo={`${String(item.numero).padStart(2, '0')} · ${item.titulo}`} onFechar={onFechar} larga>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="campo min-w-0 flex-1"
          placeholder="Buscar fornecedor, título, nota…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button
          type="button"
          className={`btn btn-p ${soSem ? 'btn-alerta' : 'btn-neutro'}`}
          onClick={() => setSoSem((s) => !s)}
        >
          Sem comprovante ({sem})
        </button>
      </div>

      {pagamentos.isLoading ? (
        <Carregando />
      ) : pagamentos.isError ? (
        <Aviso tom="erro">{mensagemErro(pagamentos.error)}</Aviso>
      ) : lista.length === 0 ? (
        <p className="py-8 text-center text-sm text-tinta-500">
          {soSem && sem === 0 ? 'Todos os pagamentos têm comprovante.' : 'Nenhum pagamento.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((p) => (
            <LinhaDePagamento key={p.idFnApagar} pagamento={p} pacoteId={pacoteId} />
          ))}
        </ul>
      )}
    </Janela>
  );
}

function LinhaDePagamento({ pagamento: p, pacoteId }: { pagamento: PagamentoNaLista; pacoteId: string }) {
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [escolhendoMotivo, setEscolhendoMotivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['contabilidade', 'pagamentos', pacoteId] });
    void qc.invalidateQueries({ queryKey: chaveDoPacote(pacoteId) });
  };

  async function enviar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setErro(null);
    setEnviando(true);
    try {
      for (const arquivo of [...arquivos]) {
        const { nome, dados } = await prepararArquivo(arquivo);
        // O comprovante é do título, venha da lista que vier: um lugar só.
        await api.post(`/contabilidade/pacotes/${pacoteId}/arquivos`, {
          item: 8,
          chave: `titulo:${p.idFnApagar}`,
          nome,
          arquivo: dadosComTipo(dados),
        });
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = '';
      atualizar();
    }
  }

  const marcar = useMutation({
    mutationFn: async (motivo: string | null) =>
      api.put(`/contabilidade/pacotes/${pacoteId}/marcas`, {
        item: 8,
        chave: `titulo:${p.idFnApagar}`,
        naoTeve: motivo !== null,
        observacao: motivo,
      }),
    onSuccess: () => {
      setEscolhendoMotivo(false);
      atualizar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const tirar = useMutation({
    mutationFn: async (id: string) => api.delete(`/contabilidade/arquivos/${id}`),
    onSuccess: atualizar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  function abrir(c: Comprovante) {
    const caminho =
      c.origem === 'pacote'
        ? `/contabilidade/arquivos/${c.id}`
        : `/contabilidade/comprovante?origem=${c.origem}&id=${encodeURIComponent(c.id)}`;
    void abrirDaApi(caminho, c.nome).catch((e: unknown) =>
      setErro(e instanceof Error ? e.message : String(e)),
    );
  }

  const falta = p.comprovantes.length === 0 && !p.semComprovante;

  return (
    <li className={`rounded-xl border p-3 ${falta ? 'border-rose-200 dark:border-rose-500/30' : 'border-tinta-100'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-tinta-900">{p.fornecedor || 'Sem fornecedor'}</p>
          <p className="text-xs text-tinta-500">
            {diaBr(p.dia)} · título {p.idFnApagar}
            {p.notaFiscal && ` · nota ${p.notaFiscal}`} · {p.conta}
          </p>
          {p.observacao && <p className="mt-0.5 line-clamp-2 text-xs text-tinta-400">{p.observacao}</p>}
        </div>
        <p className="num shrink-0 font-display text-base font-semibold text-tinta-900">{formatBRL(p.pago)}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {p.comprovantes.map((c) => (
          <span key={`${c.origem}:${c.id}`} className="flex items-center gap-1">
            <button type="button" className="btn btn-p btn-ok" onClick={() => abrir(c)}>
              {c.nome}
            </button>
            {c.origem === 'pacote' && (
              <button
                type="button"
                className="btn btn-p btn-sutil"
                aria-label="Tirar comprovante"
                disabled={tirar.isPending}
                onClick={() => {
                  if (window.confirm(`Tirar "${c.nome}"?`)) tirar.mutate(c.id);
                }}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {p.semComprovante && (
          <button type="button" className="btn btn-p btn-neutro" onClick={() => marcar.mutate(null)}>
            Não tem: {p.semComprovante} · desfazer
          </button>
        )}
        {!p.semComprovante && (
          <>
            <input
              ref={entrada}
              type="file"
              className="hidden"
              multiple
              accept=".pdf,image/*"
              onChange={(e) => void enviar(e.target.files)}
            />
            <button
              type="button"
              className={`btn btn-p ${falta ? 'btn-pagar' : 'btn-ferramenta'}`}
              disabled={enviando}
              onClick={() => entrada.current?.click()}
            >
              {enviando ? 'Enviando…' : falta ? 'Enviar comprovante' : 'Enviar mais'}
            </button>
            {falta && !escolhendoMotivo && (
              <button type="button" className="btn btn-p btn-sutil" onClick={() => setEscolhendoMotivo(true)}>
                Não tem
              </button>
            )}
          </>
        )}
      </div>

      {escolhendoMotivo && (
        <div className="mt-2 flex flex-wrap gap-2">
          {MOTIVOS.map((m) => (
            <button key={m} type="button" className="btn btn-p btn-neutro" disabled={marcar.isPending} onClick={() => marcar.mutate(m)}>
              {m}
            </button>
          ))}
          <button type="button" className="btn btn-p btn-sutil" onClick={() => setEscolhendoMotivo(false)}>
            Cancelar
          </button>
        </div>
      )}
      {erro && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{erro}</p>}
    </li>
  );
}
