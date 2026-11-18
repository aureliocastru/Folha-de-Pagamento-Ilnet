import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import { quantidade } from './ProdutoNoIxc';

type Situacao = 'conferido' | 'ok' | 'suspeito';

interface PrecoNaTela {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  preco: number;
  valor: number;
  ultimaCompra: { valor: number; dia: string | null } | null;
  custoMedio: number | null;
  situacao: Situacao;
  motivo: string | null;
  sugestao: number | null;
  conferidoPor: string | null;
  conferidoEm: string | null;
}

interface PrecosNaTela {
  itens: PrecoNaTela[];
  valorConfiavel: number;
  valorSuspeito: number;
  suspeitos: number;
  conferidos: number;
  lidoEm: string;
}

const CHAVE = ['almoxarifado', 'precos-do-estoque'];

/**
 * O preço de cada produto do estoque — um só, o preço base do IXC. Gravar
 * aqui grava lá, e o Estoque e a Contabilidade passam a usar o novo.
 */
export function PrecosDoEstoque() {
  const cliente = useQueryClient();
  const [busca, setBusca] = useState('');
  const [soSuspeitos, setSoSuspeitos] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);

  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api.get<PrecosNaTela>('/almoxarifado/precos-do-estoque')).data,
  });
  const reler = useMutation({
    mutationFn: async () =>
      (await api.get<PrecosNaTela>('/almoxarifado/precos-do-estoque', { params: { recarregar: 1 } })).data,
    onSuccess: (d) => cliente.setQueryData(CHAVE, d),
  });
  const mudou = () => {
    void cliente.invalidateQueries({ queryKey: CHAVE });
    void cliente.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
  };

  const dados = lista.data;
  const termo = semAcento(busca.trim());
  const mostrados = (dados?.itens ?? []).filter(
    (i) =>
      (!soSuspeitos || i.situacao === 'suspeito') &&
      (!termo || combina([i.descricao, String(i.produtoId)], termo)),
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Preços do estoque"
        acoes={
          <button type="button" onClick={() => reler.mutate()} disabled={reler.isPending} className="btn btn-neutro">
            {reler.isPending ? 'Lendo o IXC…' : 'Atualizar do IXC'}
          </button>
        }
      />

      <div className="space-y-4">
        {dados && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Indicador rotulo="Valor do almoxarifado" valor={formatBRL(dados.valorConfiavel)} acento />
            <Indicador
              rotulo="Preços a corrigir"
              valor={dados.suspeitos}
              detalhe={dados.suspeitos > 0 ? `${formatBRL(dados.valorSuspeito)} fora do valor` : undefined}
              alerta={dados.suspeitos > 0 ? 'confira' : undefined}
              onClick={() => setSoSuspeitos((v) => !v)}
              aberto={soSuspeitos}
            />
            <Indicador rotulo="Conferidos" valor={dados.conferidos} />
          </div>
        )}

        <Bloco titulo={dados ? `${mostrados.length} ${mostrados.length === 1 ? 'produto' : 'produtos'}` : 'Produtos'}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código do produto…"
              className="campo min-w-0 flex-1 basis-56"
              autoComplete="off"
              aria-label="Buscar produto"
            />
            <button
              type="button"
              onClick={() => setSoSuspeitos((v) => !v)}
              className={`btn btn-p ${soSuspeitos ? 'btn-ferramenta' : 'btn-neutro'}`}
              aria-pressed={soSuspeitos}
            >
              Só os a corrigir
            </button>
          </div>

          {lista.isLoading && <Carregando texto="Lendo os preços no IXC…" />}
          {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}
          {dados && mostrados.length === 0 && <Vazio titulo="Nenhum produto com isso" />}

          {mostrados.length > 0 && (
            <div className="-mx-3.5 md:-mx-5">
              <div className="hidden border-b border-fio md:grid md:grid-cols-[minmax(0,2.4fr)_90px_110px_120px_120px_290px] md:gap-3 md:px-5">
                <div className="th px-0">Produto</div>
                <div className="th px-0 text-right">Tem</div>
                <div className="th px-0 text-right">Preço</div>
                <div className="th px-0 text-right">Última compra</div>
                <div className="th px-0 text-right">Valor</div>
                <div className="th px-0 text-right">Ação</div>
              </div>
              {mostrados.map((i) => (
                <LinhaDoPreco
                  key={i.produtoId}
                  item={i}
                  aberta={editando === i.produtoId}
                  onAbrir={() => setEditando(i.produtoId)}
                  onFechar={() => setEditando(null)}
                  onMudou={mudou}
                />
              ))}
            </div>
          )}
        </Bloco>
      </div>
    </Pagina>
  );
}

function LinhaDoPreco({
  item,
  aberta,
  onAbrir,
  onFechar,
  onMudou,
}: {
  item: PrecoNaTela;
  aberta: boolean;
  onAbrir: () => void;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [valor, setValor] = useState('');
  const gravar = useMutation({
    mutationFn: async (preco?: number) =>
      (await api.patch<{ preco: number }>(`/almoxarifado/precos-do-estoque/${item.produtoId}`, preco === undefined ? {} : { preco }))
        .data,
    onSuccess: () => {
      onFechar();
      onMudou();
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(valor);
    if (n >= 0.1) gravar.mutate(n);
  };
  const suspeito = item.situacao === 'suspeito';

  return (
    <div
      className={`linha flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-1.5 text-sm md:grid md:grid-cols-[minmax(0,2.4fr)_90px_110px_120px_120px_290px] md:px-5 ${
        aberta ? 'bg-brand-500/10 outline outline-2 -outline-offset-2 outline-brand-500' : ''
      }`}
    >
      <div className="min-w-0 basis-full md:basis-auto">
        <div className="truncate font-semibold text-tinta-800" title={item.descricao}>
          {item.descricao}
        </div>
        {suspeito && item.motivo && <div className="text-xs text-amber-600">{item.motivo}</div>}
        {item.situacao === 'conferido' && item.conferidoPor && (
          <div className="text-xs text-tinta-500">
            conferido por {item.conferidoPor}
            {item.conferidoEm ? ` em ${formatData(item.conferidoEm.slice(0, 10))}` : ''}
          </div>
        )}
      </div>
      <div className="num text-xs text-tinta-500 md:text-right md:text-sm md:text-tinta-700">
        {quantidade(item.quantidade)} {item.unidade ?? ''}
      </div>
      <div className={`num md:text-right ${suspeito ? 'font-semibold text-amber-600' : 'text-tinta-900'}`}>
        {formatBRL(item.preco)}
      </div>
      <div className="num text-xs text-tinta-500 md:text-right md:text-sm">
        {item.ultimaCompra ? (
          <span title={item.ultimaCompra.dia ? `em ${formatData(item.ultimaCompra.dia)}` : undefined}>
            <span className="md:hidden">compra </span>
            {formatBRL(item.ultimaCompra.valor)}
          </span>
        ) : (
          <span className="hidden md:inline">—</span>
        )}
      </div>
      <div className={`num md:text-right ${suspeito ? 'text-tinta-500 line-through' : 'font-semibold text-tinta-900'}`}>
        {formatBRL(item.valor)}
      </div>
      <div className="ml-auto md:ml-0">
        {aberta ? (
          <form onSubmit={enviar} className="flex flex-wrap items-center justify-end gap-2 md:flex-nowrap">
            <CampoDinheiro valor={valor} onChange={setValor} className="campo num w-32" />
            <button type="submit" className="btn btn-ok btn-p" disabled={gravar.isPending || !(Number(valor) >= 0.1)}>
              {gravar.isPending ? 'Gravando…' : 'Gravar'}
            </button>
            <button type="button" className="btn btn-neutro btn-p" onClick={onFechar} disabled={gravar.isPending}>
              Cancelar
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {suspeito && item.sugestao !== null && (
              <button
                type="button"
                onClick={() => gravar.mutate(item.sugestao!)}
                disabled={gravar.isPending}
                className="btn btn-ok btn-p"
              >
                Usar {formatBRL(item.sugestao)}
              </button>
            )}
            {suspeito && item.preco >= 0.1 && (
              <button
                type="button"
                onClick={() => gravar.mutate(undefined)}
                disabled={gravar.isPending}
                className="btn btn-neutro btn-p"
                title="O preço de hoje está certo"
              >
                Está certo
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setValor(item.preco >= 0.1 ? String(item.preco) : '');
                gravar.reset();
                onAbrir();
              }}
              className="btn btn-ferramenta btn-p"
            >
              Editar
            </button>
            {item.situacao === 'conferido' && (
              <Selo tom="pago" pequeno>
                conferido
              </Selo>
            )}
          </div>
        )}
      </div>
      {gravar.isError && (
        <div className="basis-full text-xs text-rose-500 md:col-span-6">{mensagemErro(gravar.error)}</div>
      )}
    </div>
  );
}
