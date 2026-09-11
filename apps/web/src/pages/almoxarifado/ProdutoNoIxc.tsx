import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Aviso, CampoDinheiro, Carregando, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento, useTermoAdiado } from '../../lib/busca';
import { formatBRL } from '../../lib/format';
import { OndeFicouNegativo } from './rastreio';
import type {
  ConferenciaDeSaldo,
  ItemDeEstoque,
  OpcoesDoEstoque,
  ProdutoNoIxc,
} from '../../lib/types';

interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/** Quantidade como o almoxarifado a lê: sem casa decimal quando é inteira. */
export function quantidade(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/**
 * "2,5", "2.5" e "1.250,5" → 2.5, 2.5 e 1250.5. Com vírgula, o ponto é de
 * milhar; sem ela, o ponto é a casa decimal — tirar todo ponto faria de "2.5"
 * vinte e cinco metros de cabo. Vazio ou inválido → NaN.
 */
function numeroDigitado(texto: string): number {
  const t = texto.trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

/** O que a entrada de compra lembra de uma vez para a outra, neste navegador. */
const CHAVE_DA_ENTRADA = 'almoxarifado.ultima-entrada';

function lerUltimaEntrada(): {
  tipoDocumentoId?: string;
  condicaoPagamentoId?: string;
  fornecedor?: { id: number; nome: string };
} {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_DA_ENTRADA) ?? '{}');
  } catch {
    return {};
  }
}

function gravarUltimaEntrada(v: ReturnType<typeof lerUltimaEntrada>) {
  try {
    localStorage.setItem(CHAVE_DA_ENTRADA, JSON.stringify(v));
  } catch {
    // Sem armazenamento: a próxima entrada começa em branco, e só.
  }
}

function useOpcoes() {
  return useQuery({
    queryKey: ['almoxarifado', 'opcoes'],
    queryFn: async () =>
      (await api.get<OpcoesDoEstoque>('/almoxarifado/produtos/opcoes')).data,
    staleTime: 5 * 60_000,
  });
}

type Aba = 'cadastro' | 'mover' | 'entrada';

/**
 * Um produto do estoque, aberto para mexer — no IXC.
 *
 * Tudo o que se faz aqui é escrito lá: o cadastro (nome, preço, unidade,
 * ativo), a transferência entre almoxarifados e a entrada de compra, que é o
 * jeito documentado de o saldo subir. Depois de cada escrita a janela relê o
 * produto no IXC e mostra o que ficou lá.
 */
export function JanelaDoProduto({
  produtoId,
  produtos,
  onFechar,
}: {
  produtoId: number;
  /** Os produtos do estoque, para escolher o modelo do fiscal que faltar. */
  produtos: ItemDeEstoque[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>('cadastro');
  const [aviso, setAviso] = useState<{ texto: string; tom: 'pago' | 'atencao' | 'erro' } | null>(
    null,
  );

  const produto = useQuery({
    queryKey: ['almoxarifado', 'produto', produtoId],
    queryFn: async () =>
      (await api.get<ProdutoNoIxc>(`/almoxarifado/produtos/${produtoId}`)).data,
  });
  const opcoes = useOpcoes();

  function mudou(texto: string, tom: 'pago' | 'atencao' = 'pago') {
    setAviso({ texto, tom });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'produto', produtoId] });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
  }

  const p = produto.data;
  /** O acerto escolhido no aviso de negativo — a aba abre com ele preenchido. */
  const [acerto, setAcerto] = useState<{ almoxId: number; quantidade: number } | null>(null);
  // Serviço não conta: o IXC não soma entrada dele (ver `temNegativo` no Estoque).
  const negativos = p && p.tipo !== 'S' ? p.saldos.filter((s) => s.saldo < 0) : [];
  const positivos = p?.saldos.filter((s) => s.saldo > 0) ?? [];
  const ligarControle = useMutation({
    mutationFn: async () => {
      await api.patch(`/almoxarifado/produtos/${produtoId}`, { controlaEstoque: true });
    },
    onSuccess: () =>
      mudou('Controle de estoque ligado no IXC. Agora a transferência e a entrada mexem no saldo.'),
  });

  return (
    <Janela titulo={p ? p.descricao : 'Produto'} onFechar={onFechar}>
      {produto.isLoading && <Carregando texto="Lendo o produto no IXC…" />}
      {produto.isError && <Aviso tom="erro">{mensagemErro(produto.error)}</Aviso>}

      {p && (
        <>
          <p className="mb-3 text-[13px] text-tinta-500">
            Código {p.id} no IXC · {formatBRL(p.precoBase)} a {p.unidade ?? 'unidade'}
            {!p.ativo && ' · desativado'}
          </p>

          {/* O saldo de cada lugar, lido agora do IXC. */}
          <div className="mb-4 rounded-xl border border-tinta-200 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="eyebrow">Saldo no IXC</span>
              <span className="valor text-[15px]">
                {quantidade(p.total)} {p.unidade ?? ''}
              </span>
            </div>
            {p.saldos.length === 0 ? (
              <p className="text-sm text-tinta-400">Não tem saldo em almoxarifado nenhum.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {p.saldos.map((s) => (
                  <span key={s.almoxId} className="selo-p bg-tinta-100 text-tinta-700">
                    {s.almoxarifado} · {quantidade(s.saldo)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/*
            Negativo é o IXC registrando saída do que nunca entrou ali. Dois
            jeitos de acertar, e a ordem importa: se outro almoxarifado tem a
            peça sobrando, a saída foi lançada no lugar errado e mover acerta
            os dois; se ninguém tem, faltou a entrada.
          */}
          {!p.controlaEstoque && !aviso && (
            <Aviso
              tom="atencao"
              acao={
                <button
                  type="button"
                  onClick={() => ligarControle.mutate()}
                  disabled={ligarControle.isPending}
                  className="btn btn-p btn-primario"
                >
                  {ligarControle.isPending ? 'Gravando…' : 'Ligar controle de estoque'}
                </button>
              }
            >
              <strong>Este produto não controla estoque no IXC.</strong> Transferência e entrada
              são gravadas, mas não mexem no saldo — ele fica parado. Ligue o controle antes de
              mover. O saldo continua o de agora; o que saiu enquanto estava desligado não é
              descontado.
              {ligarControle.isError && (
                <span className="mt-1 block text-rose-600">{mensagemErro(ligarControle.error)}</span>
              )}
            </Aviso>
          )}

          {negativos.length > 0 && !aviso && (
            <Aviso tom="atencao">
              <p>
                <strong>Saldo negativo</strong> — o IXC registrou saída do que nunca entrou ali:
              </p>
              <ul className="mt-1 space-y-0.5">
                {negativos.map((s) => (
                  <li key={s.almoxId}>
                    <strong>
                      {s.almoxarifado} ({quantidade(s.saldo)})
                    </strong>
                    : <OndeFicouNegativo produtoId={p.id} almoxId={s.almoxId} />
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                {positivos.length > 0
                  ? `Se o que saiu estava na verdade em ${positivos
                      .map((s) => s.almoxarifado)
                      .join(' ou ')}, use "Mover" de lá para cá — acerta os dois. Se não, `
                  : 'Nenhum outro almoxarifado tem este produto sobrando: '}
                falta uma entrada.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {negativos.map((s) => (
                  <button
                    key={s.almoxId}
                    type="button"
                    onClick={() => {
                      setAcerto({ almoxId: s.almoxId, quantidade: -s.saldo });
                      setAba('entrada');
                    }}
                    className="btn btn-p btn-neutro"
                  >
                    Dar entrada de {quantidade(-s.saldo)} em {s.almoxarifado}
                  </button>
                ))}
              </div>
            </Aviso>
          )}

          {aviso && (
            <Aviso
              tom={aviso.tom}
              acao={
                <button onClick={() => setAviso(null)} className="btn btn-sutil btn-p">
                  Ok
                </button>
              }
            >
              {aviso.texto}
            </Aviso>
          )}

          <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-tinta-100 p-1">
            {(
              [
                ['cadastro', 'Cadastro'],
                ['mover', 'Mover'],
                ['entrada', 'Dar entrada'],
              ] as Array<[Aba, string]>
            ).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setAba(id);
                  setAviso(null);
                }}
                aria-pressed={aba === id}
                className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
                  aba === id ? 'bg-papel text-tinta-900 shadow-sm' : 'text-tinta-500'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {opcoes.isError && <Aviso tom="erro">{mensagemErro(opcoes.error)}</Aviso>}
          {opcoes.isLoading && <Carregando texto="Lendo as opções do IXC…" />}

          {opcoes.data && aba === 'cadastro' && (
            <Cadastro
              produto={p}
              produtos={produtos}
              opcoes={opcoes.data}
              onMudou={mudou}
              onApagado={onFechar}
            />
          )}
          {opcoes.data && aba === 'mover' && (
            <Mover produto={p} opcoes={opcoes.data} onMudou={mudou} />
          )}
          {opcoes.data && aba === 'entrada' && (
            <DarEntrada
              // Um acerto novo recomeça o formulário com ele preenchido.
              key={acerto ? `${acerto.almoxId}:${acerto.quantidade}` : 'livre'}
              produto={p}
              opcoes={opcoes.data}
              inicial={acerto}
              onMudou={(texto, tom) => {
                setAcerto(null);
                mudou(texto, tom);
              }}
            />
          )}
        </>
      )}
    </Janela>
  );
}

function Cadastro({
  produto,
  produtos,
  opcoes,
  onMudou,
  onApagado,
}: {
  produto: ProdutoNoIxc;
  produtos: ItemDeEstoque[];
  opcoes: OpcoesDoEstoque;
  onMudou: (texto: string) => void;
  onApagado: () => void;
}) {
  const qc = useQueryClient();
  const [descricao, setDescricao] = useState(produto.descricao);
  const [preco, setPreco] = useState(produto.precoBase.toFixed(2));
  const [unidadeId, setUnidadeId] = useState(String(produto.unidadeId || ''));
  const [ativo, setAtivo] = useState(produto.ativo);
  const [modelo, setModelo] = useState<ItemDeEstoque | null>(null);

  const faltaFiscal = produto.faltaFiscal.length > 0;
  const mudancas: Record<string, unknown> = {};
  if (descricao.trim() !== produto.descricao) mudancas.descricao = descricao.trim();
  if (preco !== '' && Number(preco) !== produto.precoBase) mudancas.precoBase = Number(preco);
  if (unidadeId && Number(unidadeId) !== produto.unidadeId) mudancas.unidadeId = Number(unidadeId);
  if (ativo !== produto.ativo) mudancas.ativo = ativo;
  // Completar o fiscal já é mudança, mesmo sem mexer em mais nada.
  if (faltaFiscal && modelo) mudancas.modeloId = modelo.produtoId;
  const temMudanca = Object.keys(mudancas).length > 0;

  const salvar = useMutation({
    mutationFn: async () => {
      await api.patch(`/almoxarifado/produtos/${produto.id}`, mudancas);
    },
    onSuccess: () => {
      setModelo(null);
      onMudou(
        mudancas.modeloId
          ? `Cadastro alterado no IXC, com o fiscal copiado de "${modelo?.descricao}".`
          : 'Cadastro alterado no IXC.',
      );
    },
  });

  const apagar = useMutation({
    mutationFn: async () => {
      await api.delete(`/almoxarifado/produtos/${produto.id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
      onApagado();
    },
  });

  const comSaldo = produto.saldos.some((s) => s.saldo !== 0);

  return (
    <div>
      {faltaFiscal && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="mb-2 text-sm">
            Este produto está sem <strong>{produto.faltaFiscal.join(', ')}</strong> no IXC. O
            IXC confere isso a cada gravação, e sem ele não aceita nem troca de nome. Escolha
            um produto parecido: o fiscal que falta sai dele, e o que este já tem fica.
          </p>
          <EscolherModelo
            id="produto-modelo"
            produtos={produtos.filter((p) => p.produtoId !== produto.id)}
            modelo={modelo}
            onEscolher={setModelo}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="produto-nome">
            Nome do produto
          </label>
          <input
            id="produto-nome"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value.slice(0, 100))}
            className="campo"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="produto-preco">
            Preço base (R$)
          </label>
          <CampoDinheiro id="produto-preco" valor={preco} onChange={setPreco} />
        </div>
        <div>
          <label className="rotulo" htmlFor="produto-unidade">
            Unidade
          </label>
          <select
            id="produto-unidade"
            value={unidadeId}
            onChange={(e) => setUnidadeId(e.target.value)}
            className="campo"
          >
            {!unidadeId && <option value="">Escolha…</option>}
            {opcoes.unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.sigla} — {u.descricao}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="opcao mt-3">
        <input
          type="checkbox"
          className="marcador"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
        />
        Ativo no IXC
      </label>

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={!temMudanca || salvar.isPending || descricao.trim().length < 2}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Gravando no IXC…' : 'Salvar no IXC'}
        </button>
      </div>

      {/* Apagar mora longe do salvar, e pede confirmação: some do IXC. */}
      <div className="mt-6 border-t border-tinta-200 pt-4">
        <p className="text-sm font-semibold text-tinta-800">Apagar o produto do IXC</p>
        <p className="ajuda mb-2">
          {comSaldo
            ? 'Só dá para apagar com o saldo zerado em todo almoxarifado. Para tirar de uso sem mexer no saldo, desmarque "Ativo".'
            : 'Produto que já teve compra, OS ou comodato o IXC não deixa apagar — aí desmarque "Ativo".'}
        </p>
        {apagar.isError && <Aviso tom="erro">{mensagemErro(apagar.error)}</Aviso>}
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Apagar "${produto.descricao}" (código ${produto.id}) do IXC?\n\nNão dá para desfazer.`,
              )
            ) {
              apagar.mutate();
            }
          }}
          disabled={comSaldo || apagar.isPending}
          className="btn border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          {apagar.isPending ? 'Apagando…' : 'Apagar do IXC'}
        </button>
      </div>
    </div>
  );
}

function Mover({
  produto,
  opcoes,
  onMudou,
}: {
  produto: ProdutoNoIxc;
  opcoes: OpcoesDoEstoque;
  onMudou: (texto: string, tom?: 'pago' | 'atencao') => void;
}) {
  const comSaldo = produto.saldos.filter((s) => s.saldo > 0);
  const [de, setDe] = useState(String(comSaldo[0]?.almoxId ?? ''));
  const [para, setPara] = useState('');
  const [qtde, setQtde] = useState('');
  const [observacao, setObservacao] = useState('');

  const saldoDe = produto.saldos.find((s) => String(s.almoxId) === de)?.saldo ?? 0;
  const n = numeroDigitado(qtde);
  const destinos = opcoes.almoxarifados.filter((a) => a.ativo && String(a.id) !== de);
  const nome = (id: string) => opcoes.almoxarifados.find((a) => String(a.id) === id)?.nome ?? id;
  const valido = !!de && !!para && Number.isFinite(n) && n > 0 && n <= saldoDe + 1e-9;

  const transferir = useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          transferenciaId: number;
          origem: ConferenciaDeSaldo;
          destino: ConferenciaDeSaldo;
        }>(`/almoxarifado/produtos/${produto.id}/transferir`, {
          de: Number(de),
          para: Number(para),
          quantidade: n,
          observacao: observacao.trim() || undefined,
        })
      ).data,
    onSuccess: (r) => {
      const ok = r.origem.confere && r.destino.confere;
      onMudou(
        ok
          ? `Transferência #${r.transferenciaId} feita no IXC: ${nome(de)} ${quantidade(r.origem.antes)} → ${quantidade(r.origem.depois)}, ${nome(para)} ${quantidade(r.destino.antes)} → ${quantidade(r.destino.depois)}.`
          : `O IXC registrou a transferência #${r.transferenciaId}, mas o saldo lido agora não mudou como esperado (${nome(de)}: ${quantidade(r.origem.depois)}, ${nome(para)}: ${quantidade(r.destino.depois)}). Confira a transferência no IXC.`,
        ok ? 'pago' : 'atencao',
      );
      setQtde('');
      setObservacao('');
    },
  });

  if (comSaldo.length === 0) {
    return (
      <p className="text-sm text-tinta-500">
        Não há saldo deste produto em almoxarifado nenhum para mover. Dê entrada primeiro.
      </p>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="mover-de">
            Sai de
          </label>
          <select id="mover-de" value={de} onChange={(e) => setDe(e.target.value)} className="campo">
            {comSaldo.map((s) => (
              <option key={s.almoxId} value={s.almoxId}>
                {s.almoxarifado} ({quantidade(s.saldo)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="mover-para">
            Vai para
          </label>
          <select
            id="mover-para"
            value={para}
            onChange={(e) => setPara(e.target.value)}
            className="campo"
          >
            <option value="">Escolha…</option>
            {destinos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="mover-qtde">
            Quantidade ({produto.unidade ?? 'unidade'})
          </label>
          <div className="flex gap-2">
            <input
              id="mover-qtde"
              value={qtde}
              onChange={(e) => setQtde(e.target.value.replace(/[^\d.,]/g, ''))}
              inputMode="decimal"
              className="campo num"
              placeholder="0"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setQtde(String(saldoDe).replace('.', ','))}
              className="btn btn-neutro shrink-0"
            >
              Tudo
            </button>
          </div>
          {Number.isFinite(n) && n > saldoDe && (
            <p className="mt-1 text-xs text-rose-600">Só tem {quantidade(saldoDe)} lá.</p>
          )}
        </div>
        <div>
          <label className="rotulo" htmlFor="mover-obs">
            Observação (vai para o IXC)
          </label>
          <input
            id="mover-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value.slice(0, 200))}
            className="campo"
            placeholder="Ex.: para a van da equipe 2"
            autoComplete="off"
          />
        </div>
      </div>

      {transferir.isError && <Aviso tom="erro">{mensagemErro(transferir.error)}</Aviso>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Transferir ${quantidade(n)} ${produto.unidade ?? ''} de "${produto.descricao}" de ${nome(de)} para ${nome(para)} no IXC?`,
              )
            ) {
              transferir.mutate();
            }
          }}
          disabled={!valido || transferir.isPending}
          className="btn btn-primario"
        >
          {transferir.isPending ? 'Transferindo no IXC…' : 'Transferir no IXC'}
        </button>
      </div>
    </div>
  );
}

function DarEntrada({
  produto,
  opcoes,
  inicial,
  onMudou,
}: {
  produto: ProdutoNoIxc;
  opcoes: OpcoesDoEstoque;
  /** O acerto de um saldo negativo: onde e quanto, já preenchidos. */
  inicial?: { almoxId: number; quantidade: number } | null;
  onMudou: (texto: string, tom?: 'pago' | 'atencao') => void;
}) {
  const ultima = useMemo(lerUltimaEntrada, []);
  const ativos = opcoes.almoxarifados.filter((a) => a.ativo);
  const [almoxId, setAlmoxId] = useState(
    String(inicial?.almoxId ?? produto.saldos[0]?.almoxId ?? ativos[0]?.id ?? ''),
  );
  const [qtde, setQtde] = useState(inicial ? quantidade(inicial.quantidade) : '');
  const [unitario, setUnitario] = useState(produto.precoBase.toFixed(2));
  const [tipoDocumentoId, setTipoDocumentoId] = useState(ultima.tipoDocumentoId ?? '');
  const [condicaoPagamentoId, setCondicaoPagamentoId] = useState(
    ultima.condicaoPagamentoId ?? '',
  );
  const [fornecedor, setFornecedor] = useState<{ id: number; nome: string } | null>(
    ultima.fornecedor ?? null,
  );
  const [termo, setTermo] = useState('');
  const [numeroNota, setNumeroNota] = useState('');
  const busca = useTermoAdiado(termo);

  const fornecedores = useQuery({
    queryKey: ['almoxarifado', 'fornecedores', busca],
    queryFn: async () =>
      (
        await api.get<FornecedorIxc[]>('/almoxarifado/fornecedores', { params: { busca } })
      ).data,
    enabled: busca.length >= 2 && !fornecedor,
    retry: 0,
  });

  const n = numeroDigitado(qtde);
  const vu = Number(unitario);
  const total = Number.isFinite(n) && Number.isFinite(vu) ? Math.round(n * vu * 100) / 100 : 0;
  const valido =
    !!almoxId &&
    Number.isFinite(n) &&
    n > 0 &&
    unitario !== '' &&
    !!fornecedor &&
    !!tipoDocumentoId &&
    !!condicaoPagamentoId;
  const nomeAlmox = ativos.find((a) => String(a.id) === almoxId)?.nome ?? '';

  const lancar = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ entradaId: number; conferencia: ConferenciaDeSaldo }>(
          `/almoxarifado/produtos/${produto.id}/entrada`,
          {
            almoxId: Number(almoxId),
            quantidade: n,
            valorUnitario: vu,
            fornecedorId: fornecedor!.id,
            tipoDocumentoId: Number(tipoDocumentoId),
            condicaoPagamentoId: Number(condicaoPagamentoId),
            numeroNota: numeroNota.trim() || undefined,
          },
        )
      ).data,
    onSuccess: (r) => {
      gravarUltimaEntrada({ tipoDocumentoId, condicaoPagamentoId, fornecedor: fornecedor! });
      onMudou(
        r.conferencia.confere
          ? `Compra #${r.entradaId} lançada no IXC: ${nomeAlmox} ${quantidade(r.conferencia.antes)} → ${quantidade(r.conferencia.depois)}. Ela fica aberta lá — o financeiro dela sai quando alguém a finalizar no IXC.`
          : `Compra #${r.entradaId} lançada no IXC, mas o saldo de ${nomeAlmox} ainda está em ${quantidade(r.conferencia.depois)}: o IXC deve somar só quando a compra for finalizada. Abra a compra #${r.entradaId} no IXC (Entradas › Compras) e finalize.`,
        r.conferencia.confere ? 'pago' : 'atencao',
      );
      setQtde('');
      setNumeroNota('');
    },
  });

  return (
    <div>
      <p className="mb-3 text-[13px] leading-relaxed text-tinta-500">
        O saldo sobe por uma <strong>compra</strong> no IXC — é o caminho que a API dele
        documenta. Ela nasce aberta, com o fornecedor, o tipo de documento e a condição
        de pagamento escolhidos aqui; o financeiro sai quando alguém a finalizar lá.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="entrada-almox">
            Entra em
          </label>
          <select
            id="entrada-almox"
            value={almoxId}
            onChange={(e) => setAlmoxId(e.target.value)}
            className="campo"
          >
            {ativos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="entrada-qtde">
            Quantidade ({produto.unidade ?? 'unidade'})
          </label>
          <input
            id="entrada-qtde"
            value={qtde}
            onChange={(e) => setQtde(e.target.value.replace(/[^\d.,]/g, ''))}
            inputMode="decimal"
            className="campo num"
            placeholder="0"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="entrada-unitario">
            Valor unitário (R$)
          </label>
          <CampoDinheiro id="entrada-unitario" valor={unitario} onChange={setUnitario} />
          {total > 0 && <p className="ajuda">Total da compra: {formatBRL(total)}</p>}
        </div>
        <div>
          <label className="rotulo" htmlFor="entrada-nota">
            Nº da nota (se houver)
          </label>
          <input
            id="entrada-nota"
            value={numeroNota}
            onChange={(e) => setNumeroNota(e.target.value.slice(0, 40))}
            className="campo num"
            autoComplete="off"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="entrada-fornecedor">
            Fornecedor (do IXC)
          </label>
          {fornecedor ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-tinta-200 px-3 py-2">
              <span className="text-sm text-tinta-800">
                {fornecedor.nome}
                <span className="num ml-2 text-xs text-tinta-400">{fornecedor.id}</span>
              </span>
              <button
                type="button"
                onClick={() => setFornecedor(null)}
                className="btn btn-sutil btn-p"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                id="entrada-fornecedor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                className="campo"
                placeholder="Digite o nome ou o CNPJ"
                autoComplete="off"
              />
              {fornecedores.isLoading && <p className="ajuda">Procurando no IXC…</p>}
              {fornecedores.isError && (
                <p className="mt-1 text-xs text-rose-600">{mensagemErro(fornecedores.error)}</p>
              )}
              {fornecedores.data && fornecedores.data.length === 0 && (
                <p className="ajuda">Nenhum fornecedor ativo com esse nome no IXC.</p>
              )}
              {fornecedores.data && fornecedores.data.length > 0 && (
                <div className="mt-2 max-h-44 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  {fornecedores.data.map((f) => (
                    <button
                      key={f.idFornecedor}
                      type="button"
                      onClick={() => {
                        setFornecedor({ id: f.idFornecedor, nome: f.nome });
                        setTermo('');
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-50"
                    >
                      <span className="text-tinta-800">{f.nome}</span>
                      <span className="num ml-2 text-xs text-tinta-400">{f.idFornecedor}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="entrada-tipo">
            Tipo de documento
          </label>
          <select
            id="entrada-tipo"
            value={tipoDocumentoId}
            onChange={(e) => setTipoDocumentoId(e.target.value)}
            className="campo"
          >
            <option value="">Escolha…</option>
            {opcoes.tiposDeDocumento.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} — {t.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="entrada-condicao">
            Condição de pagamento
          </label>
          <select
            id="entrada-condicao"
            value={condicaoPagamentoId}
            onChange={(e) => setCondicaoPagamentoId(e.target.value)}
            className="campo"
          >
            <option value="">Escolha…</option>
            {opcoes.condicoesDePagamento.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {lancar.isError && <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Lançar no IXC uma compra de ${quantidade(n)} ${produto.unidade ?? ''} de "${produto.descricao}" a ${formatBRL(vu)} (total ${formatBRL(total)}), de ${fornecedor?.nome}, entrando em ${nomeAlmox}?`,
              )
            ) {
              lancar.mutate();
            }
          }}
          disabled={!valido || lancar.isPending}
          className="btn btn-primario"
        >
          {lancar.isPending ? 'Lançando no IXC…' : 'Lançar compra no IXC'}
        </button>
      </div>
    </div>
  );
}

/** Achar, pelo nome, o produto parecido de onde sai o fiscal. */
function EscolherModelo({
  id,
  produtos,
  modelo,
  onEscolher,
}: {
  id: string;
  produtos: ItemDeEstoque[];
  modelo: ItemDeEstoque | null;
  onEscolher: (p: ItemDeEstoque | null) => void;
}) {
  const [termo, setTermo] = useState('');
  const achados = useMemo(() => {
    const t = semAcento(termo.trim());
    if (t.length < 2) return [];
    return produtos.filter((p) => semAcento(p.descricao).includes(t)).slice(0, 8);
  }, [termo, produtos]);

  return (
    <>
      <label className="rotulo" htmlFor={id}>
        Parecido com (modelo)
      </label>
      {modelo ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-tinta-200 bg-papel px-3 py-2">
          <span className="text-sm text-tinta-800">
            {modelo.descricao}
            <span className="num ml-2 text-xs text-tinta-400">{modelo.produtoId}</span>
          </span>
          <button type="button" onClick={() => onEscolher(null)} className="btn btn-sutil btn-p">
            Trocar
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            className="campo"
            placeholder="Digite o nome de um produto parecido"
            autoComplete="off"
          />
          {achados.length > 0 && (
            <div className="mt-2 max-h-44 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100 bg-papel">
              {achados.map((p) => (
                <button
                  key={p.produtoId}
                  type="button"
                  onClick={() => {
                    onEscolher(p);
                    setTermo('');
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-50"
                >
                  <span className="text-tinta-800">{p.descricao}</span>
                  <span className="num ml-2 text-xs text-tinta-400">{p.produtoId}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * Cadastrar um produto novo no IXC.
 *
 * O cadastro de produto do IXC pede o que ninguém sabe de cabeça — NCM,
 * classificação fiscal, subgrupo, tributação. Em vez de perguntar isso aqui, a
 * tela pede um produto **parecido** que já existe: é dele que saem esses
 * campos, já certos. Aqui se escolhe só nome, unidade e preço.
 */
export function NovoProduto({
  produtos,
  onFechar,
  onCriado,
}: {
  /** Os produtos do estoque, para escolher o modelo. */
  produtos: ItemDeEstoque[];
  onFechar: () => void;
  onCriado: (produtoId: number) => void;
}) {
  const qc = useQueryClient();
  const opcoes = useOpcoes();
  const [descricao, setDescricao] = useState('');
  const [preco, setPreco] = useState('');
  const [unidadeId, setUnidadeId] = useState('');
  const [modelo, setModelo] = useState<ItemDeEstoque | null>(null);

  function escolherModelo(p: ItemDeEstoque | null) {
    setModelo(p);
    if (!p) return;
    // A unidade do modelo é o palpite mais provável para o produto novo.
    const u = opcoes.data?.unidades.find((x) => x.sigla === p.unidade);
    if (u && !unidadeId) setUnidadeId(String(u.id));
  }

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post<ProdutoNoIxc>('/almoxarifado/produtos', {
          descricao: descricao.trim(),
          precoBase: Number(preco || 0),
          unidadeId: Number(unidadeId),
          modeloId: modelo!.produtoId,
        })
      ).data,
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
      onCriado(p.id);
    },
  });

  const valido = descricao.trim().length >= 2 && !!unidadeId && !!modelo;

  return (
    <Janela titulo="Novo produto no IXC" onFechar={onFechar}>
      {opcoes.isError && <Aviso tom="erro">{mensagemErro(opcoes.error)}</Aviso>}

      <EscolherModelo
        id="novo-modelo"
        produtos={produtos}
        modelo={modelo}
        onEscolher={escolherModelo}
      />
      <p className="ajuda">
        Do modelo saem subgrupo, tipo, NCM, classificação fiscal, tributação e contas
        contábeis — o que o IXC exige e ninguém sabe de cabeça.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="novo-nome">
            Nome do produto novo
          </label>
          <input
            id="novo-nome"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value.slice(0, 100))}
            className="campo"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="novo-unidade">
            Unidade
          </label>
          <select
            id="novo-unidade"
            value={unidadeId}
            onChange={(e) => setUnidadeId(e.target.value)}
            className="campo"
          >
            <option value="">Escolha…</option>
            {opcoes.data?.unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.sigla} — {u.descricao}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="novo-preco">
            Preço base (R$)
          </label>
          <CampoDinheiro id="novo-preco" valor={preco} onChange={setPreco} />
        </div>
      </div>

      {criar.isError && <Aviso tom="erro">{mensagemErro(criar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => criar.mutate()}
          disabled={!valido || criar.isPending}
          className="btn btn-primario"
        >
          {criar.isPending ? 'Cadastrando no IXC…' : 'Cadastrar no IXC'}
        </button>
      </div>
    </Janela>
  );
}
