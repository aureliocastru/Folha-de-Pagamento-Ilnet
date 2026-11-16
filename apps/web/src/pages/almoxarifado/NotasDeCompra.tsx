import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CampoDeData } from '../../components/CampoDeData';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';
import {
  Aviso,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import {
  dividirEmParcelas,
  hojeIso,
  lerQuantidade,
  type NotaDeCompra,
} from '../../lib/notas-de-compra';
import type { OpcoesDoEstoque } from '../../lib/types';

/**
 * As notas fiscais de compra: o almoxarife lança a nota quando o material
 * chega. Os produtos entram no estoque do IXC na hora (uma compra de Entradas
 * › Compras); as parcelas ficam esperando a confirmação do Contas a Pagar.
 */
export function NotasDeCompra() {
  const [lancando, setLancando] = useState(false);
  const [feita, setFeita] = useState<NotaDeCompra | null>(null);
  const [aberta, setAberta] = useState<NotaDeCompra | null>(null);
  const [desfeita, setDesfeita] = useState<string | null>(null);

  const notas = useQuery({
    queryKey: ['almoxarifado', 'notas'],
    queryFn: async () => (await api.get<NotaDeCompra[]>('/almoxarifado/notas')).data,
  });

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Notas fiscais"
        acoes={
          <button onClick={() => setLancando(true)} className="btn btn-primario">
            Lançar nota
          </button>
        }
      />

      {feita && (
        <Aviso
          tom={feita.itens.every((i) => i.entrou) ? 'pago' : 'atencao'}
          acao={
            <button onClick={() => setFeita(null)} className="btn btn-sutil btn-p">
              Fechar
            </button>
          }
        >
          {resumoDoLancamento(feita)}
        </Aviso>
      )}

      {desfeita && (
        <Aviso
          tom="pago"
          acao={
            <button onClick={() => setDesfeita(null)} className="btn btn-sutil btn-p">
              Fechar
            </button>
          }
        >
          {desfeita}
        </Aviso>
      )}

      {notas.isError && <Aviso tom="erro">{mensagemErro(notas.error)}</Aviso>}

      {notas.isLoading ? (
        <Carregando />
      ) : (notas.data ?? []).length === 0 ? (
        <Vazio titulo="Nenhuma nota lançada">Lance a primeira nota.</Vazio>
      ) : (
        <div className="lista-cartoes">
          {(notas.data ?? []).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setAberta(n)}
              className="cartao-item block w-full text-left"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <div className="font-semibold text-tinta-900">{n.fornecedor.nome}</div>
                  <div className="num text-xs text-tinta-500">
                    NF {n.numeroNota} · {formatData(n.dataEmissao)} · {n.itens.length} produto
                    {n.itens.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="valor">{formatBRL(n.valorTotal)}</div>
                  <SeloDaSituacao nota={n} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {lancando && (
        <LancarNota
          onFechar={() => setLancando(false)}
          onLancada={(nota) => {
            setLancando(false);
            setFeita(nota);
          }}
        />
      )}

      {aberta && (
        <Janela titulo={`NF ${aberta.numeroNota}`} onFechar={() => setAberta(null)} media>
          <DetalheDaNota nota={aberta} />
          <DesfazerNota
            nota={aberta}
            onFechar={() => setAberta(null)}
            onDesfeita={() => {
              setAberta(null);
              setFeita(null);
              setDesfeita(`Nota ${aberta.numeroNota} desfeita: saiu do estoque e do IXC.`);
            }}
          />
        </Janela>
      )}
    </Pagina>
  );
}

function resumoDoLancamento(n: NotaDeCompra): string {
  const entraram = n.itens.filter((i) => i.entrou).length;
  const partes = [
    `Nota ${n.numeroNota} lançada: ${entraram} de ${n.itens.length} produto(s) no estoque (compra #${n.entradaId} no IXC).`,
  ];
  const recusados = n.itens.filter((i) => !i.entrou);
  if (recusados.length > 0) {
    partes.push(
      `O IXC recusou: ${recusados.map((i) => `${i.descricao} (${i.motivo})`).join('; ')}.`,
    );
  }
  if (n.compraAberta) partes.push(`A compra ficou aberta no IXC — ${n.compraAberta}.`);
  if (n.situacao === 'AGUARDANDO') {
    partes.push(
      `${n.parcelas.length} parcela(s) esperando a confirmação do Contas a Pagar.`,
    );
  }
  return partes.join(' ');
}

export function SeloDaSituacao({ nota }: { nota: NotaDeCompra }) {
  if (nota.situacao === 'AGUARDANDO') {
    return (
      <Selo pequeno tom="atencao">
        aguardando o financeiro
      </Selo>
    );
  }
  if (nota.situacao === 'CONFIRMADA') {
    return (
      <Selo pequeno tom="pago">
        contas criadas
      </Selo>
    );
  }
  if (nota.situacao === 'RECUSADA') {
    return (
      <Selo pequeno tom="neutro" titulo={nota.motivoDaRecusa ?? undefined}>
        sem conta (recusada)
      </Selo>
    );
  }
  return (
    <Selo pequeno tom="neutro">
      sem conta a pagar
    </Selo>
  );
}

/** Os produtos e as parcelas de uma nota — o mesmo nas duas telas. */
export function DetalheDaNota({ nota }: { nota: NotaDeCompra }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="font-semibold text-tinta-900">{nota.fornecedor.nome}</div>
        <div className="num text-xs text-tinta-500">
          NF {nota.numeroNota} · emitida em {formatData(nota.dataEmissao)} · lançada por{' '}
          {nota.lancadaPor} · compra #{nota.entradaId} no IXC · {nota.almoxarifado}
        </div>
      </div>

      <div className="overflow-x-auto rolagem-fina">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Produto</th>
              <th className="th text-right">Quantidade</th>
              <th className="th text-right">Unitário</th>
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {nota.itens.map((i) => (
              <tr key={i.produtoId} className="linha">
                <td className="td">
                  {i.descricao}
                  {!i.entrou && (
                    <div className="text-xs text-rose-600">não entrou no IXC: {i.motivo}</div>
                  )}
                </td>
                <td className="td num text-right">
                  {i.quantidade} {i.unidade}
                </td>
                <td className="td num text-right">{formatBRL(i.valorUnitario)}</td>
                <td className="td num text-right">
                  {formatBRL(Math.round(i.quantidade * i.valorUnitario * 100) / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between border-t border-tinta-200 pt-3">
        <span className="text-tinta-600">Total da nota</span>
        <strong className="valor">{formatBRL(nota.valorTotal)}</strong>
      </div>

      {nota.parcelas.length > 0 && (
        <div>
          <div className="rotulo">Parcelas</div>
          <ul className="space-y-0.5">
            {nota.parcelas.map((p, n) => (
              <li key={n} className="num flex justify-between gap-3 text-tinta-700">
                <span>
                  {n + 1}/{nota.parcelas.length} · vence em {formatData(p.vencimento)}
                  {p.idFnApagar ? ` · título ${p.idFnApagar}` : ''}
                </span>
                <span>{formatBRL(p.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Desfazer a nota: apaga do IXC as contas a pagar que ela gerou, os produtos
 * e a compra. Pede um segundo toque, dizendo o que vai sair.
 */
function DesfazerNota({
  nota,
  onFechar,
  onDesfeita,
}: {
  nota: NotaDeCompra;
  onFechar: () => void;
  onDesfeita: () => void;
}) {
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const contas = nota.parcelas.filter((p) => p.idFnApagar).length;

  const desfazer = useMutation({
    mutationFn: async () => api.post(`/almoxarifado/notas/${nota.id}/desfazer`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['almoxarifado'] });
      void qc.invalidateQueries({ queryKey: ['notas-de-compra'] });
      void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
      onDesfeita();
    },
    // O que o IXC recusou pode ter deixado a nota pela metade: a lista relê.
    onError: () => void qc.invalidateQueries({ queryKey: ['almoxarifado', 'notas'] }),
  });

  return (
    <div className="mt-5 border-t border-tinta-200 pt-4">
      {confirmando && (
        <p className="mb-3 text-sm text-tinta-700">
          Sai do estoque: {nota.itens.filter((i) => i.entrou).length} produto(s), com a compra #
          {nota.entradaId} do IXC.
          {contas > 0 && ` Sai do Contas a Pagar: ${contas} conta(s).`}
        </p>
      )}
      {desfazer.isError && (
        <p className="mb-3 text-sm text-rose-600">{mensagemErro(desfazer.error)}</p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {confirmando ? (
          <>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={desfazer.isPending}
              className="btn btn-neutro"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => desfazer.mutate()}
              disabled={desfazer.isPending}
              className="btn btn-alerta"
            >
              {desfazer.isPending ? 'Desfazendo no IXC…' : 'Desfazer mesmo'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirmando(true)} className="btn btn-alerta mr-auto">
              Desfazer nota
            </button>
            <button type="button" onClick={onFechar} className="btn btn-neutro">
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lançar
// ---------------------------------------------------------------------------

interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
}

interface LinhaDeProduto {
  chave: string;
  produto: { id: number; descricao: string; unidade: string | null } | null;
  quantidade: string;
  /** Como o `CampoDinheiro` o dá: "12.50" ou "". */
  valorUnitario: string;
}

const ALMOX_LEMBRADO = 'almoxarifado.nota.almox';

function novaLinha(): LinhaDeProduto {
  return {
    chave: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    produto: null,
    quantidade: '',
    valorUnitario: '',
  };
}

function LancarNota({
  onFechar,
  onLancada,
}: {
  onFechar: () => void;
  onLancada: (nota: NotaDeCompra) => void;
}) {
  const qc = useQueryClient();
  const [fornecedor, setFornecedor] = useState<{ id: number; nome: string } | null>(null);
  const [numeroNota, setNumeroNota] = useState('');
  const [dataEmissao, setDataEmissao] = useState(hojeIso());
  const [almoxId, setAlmoxId] = useState('');
  const [linhas, setLinhas] = useState<LinhaDeProduto[]>([novaLinha()]);
  /** Quantas parcelas: 0 = a nota não gera conta a pagar. */
  const [quantas, setQuantas] = useState(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hojeIso());
  const [parcelas, setParcelas] = useState<Array<{ vencimento: string; valor: string }>>([]);

  const opcoes = useQuery({
    queryKey: ['almoxarifado', 'produtos', 'opcoes'],
    queryFn: async () =>
      (await api.get<OpcoesDoEstoque>('/almoxarifado/produtos/opcoes')).data,
    staleTime: 5 * 60 * 1000,
  });
  const almoxarifados = useMemo(
    () => (opcoes.data?.almoxarifados ?? []).filter((a) => a.ativo),
    [opcoes.data],
  );

  // O almoxarifado já vem escolhido: o da última nota, ou o da casa.
  useEffect(() => {
    if (almoxId || almoxarifados.length === 0) return;
    let lembrado: string | null = null;
    try {
      lembrado = localStorage.getItem(ALMOX_LEMBRADO);
    } catch {
      // Sem armazenamento, vale o padrão.
    }
    const padrao =
      almoxarifados.find((a) => String(a.id) === lembrado) ??
      almoxarifados.find((a) => a.nome.trim().toUpperCase() === 'ILNET') ??
      almoxarifados[0];
    setAlmoxId(String(padrao.id));
  }, [almoxId, almoxarifados]);

  const total = useMemo(
    () =>
      Math.round(
        linhas.reduce((s, l) => {
          const q = lerQuantidade(l.quantidade);
          const v = Number(l.valorUnitario || 0);
          return s + (Number.isFinite(q) ? Math.round(q * v * 100) / 100 : 0);
        }, 0) * 100,
      ) / 100,
    [linhas],
  );

  // As parcelas se refazem quando muda o que as define; o que se acertou à
  // mão numa delas vale até lá.
  useEffect(() => {
    setParcelas(dividirEmParcelas(total, quantas, primeiroVencimento));
  }, [total, quantas, primeiroVencimento]);

  const somaDasParcelas =
    Math.round(parcelas.reduce((s, p) => s + Number(p.valor || 0), 0) * 100) / 100;
  const parcelasFecham = quantas === 0 || Math.abs(somaDasParcelas - total) < 0.005;

  const linhasProntas = linhas.filter((l) => l.produto);
  const falta = !fornecedor
    ? 'Escolha o fornecedor.'
    : !numeroNota.trim()
      ? 'Falta o número da nota.'
      : linhasProntas.length === 0
        ? 'Escolha pelo menos um produto.'
        : linhasProntas.some((l) => !(lerQuantidade(l.quantidade) > 0))
          ? 'Cada produto precisa da quantidade.'
          : linhasProntas.some((l) => l.valorUnitario === '')
            ? 'Cada produto precisa do valor.'
            : quantas > 0 && !(total > 0)
              ? 'Nota de valor zero não tem parcela: escolha "Sem conta a pagar".'
              : !parcelasFecham
                ? `As parcelas somam ${formatBRL(somaDasParcelas)}, e a nota, ${formatBRL(total)}.`
                : quantas > 0 && parcelas.some((p) => !p.vencimento)
                  ? 'Cada parcela precisa do vencimento.'
                  : null;

  const lancar = useMutation({
    mutationFn: async () =>
      (
        await api.post<NotaDeCompra>('/almoxarifado/notas', {
          fornecedorId: fornecedor!.id,
          fornecedorNome: fornecedor!.nome,
          numeroNota: numeroNota.trim(),
          dataEmissao,
          almoxId: Number(almoxId),
          itens: linhasProntas.map((l) => ({
            produtoId: l.produto!.id,
            quantidade: lerQuantidade(l.quantidade),
            valorUnitario: Number(l.valorUnitario),
          })),
          parcelas:
            quantas === 0
              ? []
              : parcelas.map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor) })),
        })
      ).data,
    onSuccess: (nota) => {
      try {
        localStorage.setItem(ALMOX_LEMBRADO, almoxId);
      } catch {
        // Só não lembra da próxima vez.
      }
      void qc.invalidateQueries({ queryKey: ['almoxarifado'] });
      onLancada(nota);
    },
  });

  function mudarLinha(chave: string, parte: Partial<LinhaDeProduto>) {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...parte } : l)));
  }

  return (
    <Janela titulo="Lançar nota fiscal" onFechar={onFechar} media>
      <FormularioEmPassos>
        <div className="grid max-w-2xl grid-cols-1 gap-3">
          <EscolherFornecedor fornecedor={fornecedor} onEscolher={setFornecedor} />

          <div>
            <label className="rotulo" htmlFor="nota-numero">
              Nº da nota fiscal
            </label>
            <input
              id="nota-numero"
              value={numeroNota}
              onChange={(e) => setNumeroNota(e.target.value.slice(0, 40))}
              className="campo num"
              inputMode="numeric"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="rotulo" htmlFor="nota-emissao">
              Data de emissão
            </label>
            <CampoDeData
              id="nota-emissao"
              valor={dataEmissao}
              max={hojeIso()}
              onChange={(v) => v && setDataEmissao(v)}
            />
          </div>

          {almoxarifados.length > 1 && (
            <div>
              <label className="rotulo" htmlFor="nota-almox">
                Entra em qual almoxarifado
              </label>
              <select
                id="nota-almox"
                value={almoxId}
                onChange={(e) => setAlmoxId(e.target.value)}
                className="campo"
              >
                {almoxarifados.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 max-w-2xl" data-passo="Produtos">
          <div className="rotulo">Produtos da nota</div>
          <div className="space-y-2">
            {linhas.map((l) => (
              <LinhaDoProduto
                key={l.chave}
                linha={l}
                jaEscolhidos={linhas.filter((x) => x.produto).map((x) => x.produto!.id)}
                onMudar={(parte) => mudarLinha(l.chave, parte)}
                onTirar={
                  linhas.length > 1
                    ? () => setLinhas((atual) => atual.filter((x) => x.chave !== l.chave))
                    : undefined
                }
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setLinhas((atual) => [...atual, novaLinha()])}
              className="btn btn-ferramenta btn-p"
            >
              + Outro produto
            </button>
            <span className="text-sm text-tinta-600">
              Total da nota <strong className="valor ml-1">{formatBRL(total)}</strong>
            </span>
          </div>
        </div>

        <div className="mt-5 grid max-w-2xl grid-cols-1 gap-3" data-passo="Pagamento">
          <div>
            <label className="rotulo" htmlFor="nota-parcelas">
              Pagamento
            </label>
            <select
              id="nota-parcelas"
              value={quantas}
              onChange={(e) => setQuantas(Number(e.target.value))}
              className="campo"
            >
              <option value={0}>Sem conta a pagar</option>
              <option value={1}>1 parcela</option>
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n} parcelas
                </option>
              ))}
            </select>
          </div>

          {quantas > 0 && (
            <div>
              <label className="rotulo" htmlFor="nota-vencimento">
                {quantas === 1 ? 'Vencimento' : 'Vencimento da primeira'}
              </label>
              <CampoDeData
                id="nota-vencimento"
                valor={primeiroVencimento}
                onChange={(v) => v && setPrimeiroVencimento(v)}
              />
            </div>
          )}

          {quantas > 1 && parcelas.length > 0 && (
            <div>
              <div className="rotulo">Parcelas</div>
              <div className="space-y-2">
                {parcelas.map((p, n) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className="num w-10 shrink-0 text-xs text-tinta-500">
                      {n + 1}/{parcelas.length}
                    </span>
                    <CampoDeData
                      valor={p.vencimento}
                      onChange={(v) =>
                        v &&
                        setParcelas((atual) =>
                          atual.map((x, i) => (i === n ? { ...x, vencimento: v } : x)),
                        )
                      }
                    />
                    <CampoDinheiro
                      valor={p.valor}
                      onChange={(v) =>
                        setParcelas((atual) =>
                          atual.map((x, i) => (i === n ? { ...x, valor: v } : x)),
                        )
                      }
                      className="campo num w-32 shrink-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {lancar.isError && (
          <div className="mt-4">
            <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>
          </div>
        )}

        <div
          className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-tinta-200 pt-4"
          data-passo-falta={falta ?? undefined}
        >
          {falta && <span className="mr-auto text-xs text-tinta-500">{falta}</span>}
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => lancar.mutate()}
            disabled={!!falta || lancar.isPending || !almoxId}
            className="btn btn-primario"
          >
            {lancar.isPending ? 'Lançando no IXC…' : 'Lançar nota'}
          </button>
        </div>
      </FormularioEmPassos>
    </Janela>
  );
}

function EscolherFornecedor({
  fornecedor,
  onEscolher,
}: {
  fornecedor: { id: number; nome: string } | null;
  onEscolher: (f: { id: number; nome: string } | null) => void;
}) {
  const [termo, setTermo] = useState('');
  const busca = useAtrasado(termo.trim());
  const fornecedores = useQuery({
    queryKey: ['almoxarifado', 'fornecedores', busca],
    queryFn: async () =>
      (await api.get<FornecedorIxc[]>('/almoxarifado/fornecedores', { params: { busca } })).data,
    enabled: !fornecedor && busca.length >= 2,
  });

  return (
    <div>
      <label className="rotulo" htmlFor="nota-fornecedor">
        Fornecedor
      </label>
      {fornecedor ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-tinta-200 px-3 py-1.5">
          <span className="text-sm text-tinta-800">{fornecedor.nome}</span>
          <button type="button" onClick={() => onEscolher(null)} className="btn btn-ferramenta btn-p">
            Trocar
          </button>
        </div>
      ) : (
        <>
          <input
            id="nota-fornecedor"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            className="campo"
            placeholder="Nome ou CNPJ"
            autoComplete="off"
            required
          />
          {fornecedores.isLoading && <p className="ajuda">Procurando…</p>}
          {fornecedores.isError && (
            <p className="mt-1 text-xs text-rose-600">{mensagemErro(fornecedores.error)}</p>
          )}
          {fornecedores.data && fornecedores.data.length === 0 && (
            <p className="ajuda">Nenhum fornecedor com esse nome.</p>
          )}
          {fornecedores.data && fornecedores.data.length > 0 && (
            <div className="mt-1 max-h-44 overflow-y-auto rolagem-fina rounded-xl border border-tinta-200">
              {fornecedores.data.map((f) => (
                <button
                  key={f.idFornecedor}
                  type="button"
                  onClick={() => {
                    onEscolher({ id: f.idFornecedor, nome: f.nome });
                    setTermo('');
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-100"
                >
                  {f.nome}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ProdutoAchado {
  produtoId: number;
  descricao: string;
  patrimonio: boolean;
}

/** Um produto da nota: procurar pelo nome ou código, quantidade e valor. */
function LinhaDoProduto({
  linha,
  jaEscolhidos,
  onMudar,
  onTirar,
}: {
  linha: LinhaDeProduto;
  jaEscolhidos: number[];
  onMudar: (parte: Partial<LinhaDeProduto>) => void;
  onTirar?: () => void;
}) {
  const [termo, setTermo] = useState('');
  const busca = useAtrasado(termo.trim());
  const achados = useQuery({
    queryKey: ['almoxarifado', 'conferencia', 'produtos', busca],
    queryFn: async () =>
      (
        await api.get<ProdutoAchado[]>('/almoxarifado/conferencia/produtos', {
          params: { busca },
        })
      ).data,
    enabled: !linha.produto && busca.length >= 2,
  });

  // O valor já vem com o preço do cadastro: na maior parte das notas é ele.
  const escolher = useMutation({
    mutationFn: async (p: ProdutoAchado) => {
      const detalhe = await api
        .get<{ precoBase: number; unidade: string | null }>(`/almoxarifado/produtos/${p.produtoId}`)
        .then((r) => r.data)
        .catch(() => null);
      return { p, detalhe };
    },
    onSuccess: ({ p, detalhe }) => {
      onMudar({
        produto: { id: p.produtoId, descricao: p.descricao, unidade: detalhe?.unidade ?? null },
        valorUnitario:
          linha.valorUnitario || (detalhe && detalhe.precoBase > 0 ? detalhe.precoBase.toFixed(2) : ''),
      });
      setTermo('');
    },
  });

  if (!linha.produto) {
    const lista = (achados.data ?? []).filter((p) => !jaEscolhidos.includes(p.produtoId));
    return (
      <div className="rounded-xl border border-tinta-200 p-2">
        <div className="flex items-center gap-2">
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            className="campo"
            placeholder="Procurar o produto pelo nome ou código"
            autoComplete="off"
          />
          {onTirar && (
            <button type="button" onClick={onTirar} className="btn btn-alerta btn-p shrink-0">
              Tirar
            </button>
          )}
        </div>
        {(achados.isLoading || escolher.isPending) && <p className="ajuda">Procurando…</p>}
        {achados.data && lista.length === 0 && <p className="ajuda">Nenhum produto com esse nome.</p>}
        {lista.length > 0 && !escolher.isPending && (
          <div className="mt-1 max-h-44 overflow-y-auto rolagem-fina rounded-xl border border-tinta-200">
            {lista.map((p) => (
              <button
                key={p.produtoId}
                type="button"
                onClick={() => escolher.mutate(p)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-100"
              >
                {p.descricao}
                <span className="num ml-2 text-xs text-tinta-400">{p.produtoId}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const q = lerQuantidade(linha.quantidade);
  const totalDaLinha = Number.isFinite(q)
    ? Math.round(q * Number(linha.valorUnitario || 0) * 100) / 100
    : 0;

  return (
    <div className="rounded-xl border border-tinta-200 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold text-tinta-900">
          {linha.produto.descricao}
          <span className="num ml-2 text-xs font-normal text-tinta-400">{linha.produto.id}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onMudar({ produto: null })}
            className="btn btn-ferramenta btn-p"
          >
            Trocar
          </button>
          {onTirar && (
            <button type="button" onClick={onTirar} className="btn btn-alerta btn-p">
              Tirar
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-tinta-500">
          Quantidade{linha.produto.unidade ? ` (${linha.produto.unidade})` : ''}
          <input
            value={linha.quantidade}
            onChange={(e) => onMudar({ quantidade: e.target.value.replace(/[^\d.,]/g, '') })}
            className="campo num mt-0.5 w-28"
            inputMode="decimal"
            autoComplete="off"
          />
        </label>
        <label className="text-xs text-tinta-500">
          Valor de cada
          <CampoDinheiro
            valor={linha.valorUnitario}
            onChange={(v) => onMudar({ valorUnitario: v })}
            className="campo num mt-0.5 w-32"
            placeholder="0,00"
          />
        </label>
        <span className="num ml-auto pb-1.5 text-sm text-tinta-700">{formatBRL(totalDaLinha)}</span>
      </div>
    </div>
  );
}

/** O valor, meio segundo depois de a pessoa parar de digitar. */
function useAtrasado(valor: string): string {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), 350);
    return () => clearTimeout(t);
  }, [valor]);
  return atrasado;
}
