import { useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useMemo, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useBuscaNaTela, useFiltrados } from '../../lib/busca';
import { formatData } from '../../lib/format';
import type { ComodatoNaTela, ItemEmComodato } from '../../lib/types';
import { quantidade } from './ProdutoNoIxc';

/** A situação do contrato no IXC, em palavras. */
const STATUS_DO_CONTRATO: Record<string, string> = {
  A: 'ativo',
  I: 'inativo',
  D: 'desistiu',
  N: 'negativado',
  P: 'pré-contrato',
};

/* A busca passa por cliente, endereço, série, MAC e produto de uma vez — é por
   qualquer um deles que se procura uma ONU. */
const CAMPOS_DA_BUSCA = (i: ItemEmComodato) => [
  i.produto,
  i.cliente,
  i.endereco,
  i.numeroSerie,
  i.mac,
  i.patrimonio,
  i.plano,
  i.contratoId,
];

/**
 * Quantas peças um produto aberto desenha de uma vez.
 *
 * A ONU mais comum passa de 2.800 peças, e a casa toda de 14 mil: desenhar
 * todas de uma vez eram mais de 160 mil elementos na página, e segundos de tela
 * parada. Quem procura uma peça procura pela busca; o "mostrar mais" fica para
 * quem quer passar o olho.
 */
const PECAS_POR_VEZ = 30;

const NENHUM: ItemEmComodato[] = [];

/**
 * O que está em comodato — emprestado a cliente — e onde.
 *
 * Lido do IXC, e só lido: o comodato nasce na OS de instalação e é baixado no
 * contrato, lá. Esta aba responde o que o IXC responde mal: **quanto** de cada
 * equipamento está fora de casa, e **com quem** — pelo nome do cliente, pelo
 * endereço, pelo número de série ou pelo MAC.
 *
 * O contrato inativo com peça em comodato ganha destaque: é equipamento da
 * empresa na casa de quem já não é cliente, e é o primeiro que vale buscar.
 */
export function Comodato() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<number | null>(null);

  const lista = useQuery({
    queryKey: ['almoxarifado', 'comodatos'],
    queryFn: async () => (await api.get<ComodatoNaTela>('/almoxarifado/comodatos')).data,
    staleTime: 10 * 60_000,
  });

  const dados = lista.data;

  /* A busca é aqui: a lista inteira já veio. Ela anda um passo atrás do campo
     (ver `useBuscaNaTela`) — é o que deixa a tecla e o leitor de código de
     barras escreverem sem esperar a lista. */
  const { termo, atualizando } = useBuscaNaTela(busca);
  const buscando = !!termo.texto;
  const itens = useFiltrados(dados?.itens ?? NENHUM, CAMPOS_DA_BUSCA, termo);

  const porProduto = useMemo(() => {
    const grupos = new Map<number, GrupoDoComodato>();
    for (const i of itens) {
      const g = grupos.get(i.produtoId) ?? { produtoId: i.produtoId, produto: i.produto, itens: [], quantidade: 0, contratos: 0 };
      g.itens.push(i);
      g.quantidade += i.quantidade;
      grupos.set(i.produtoId, g);
    }
    for (const g of grupos.values()) g.contratos = new Set(g.itens.map((i) => i.contratoId)).size;
    return [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade);
  }, [itens]);

  // Os cartões contam a casa toda, e não a busca: só mudam quando o IXC é lido de novo.
  const resumo = useMemo(() => {
    const todos = dados?.itens ?? NENHUM;
    return {
      pecas: todos.reduce((s, i) => s + i.quantidade, 0),
      contratos: new Set(todos.map((i) => i.contratoId)).size,
      inativos: todos.filter((i) => i.contratoStatus && i.contratoStatus !== 'A').length,
    };
  }, [dados]);
  const { pecas, contratos, inativos } = resumo;

  // A lista não se redesenha com a tecla, só com o termo adiado.
  const listaDesenhada = useMemo(
    () => (
      <ul className="lista-dividida border-t border-tinta-200">
        {porProduto.map((g) => (
          <ProdutoEmComodato
            key={g.produtoId}
            grupo={g}
            // Buscando, todo grupo com achado abre: o que se procura está dentro.
            expandido={aberto === g.produtoId || buscando}
            onAlternar={setAberto}
          />
        ))}
      </ul>
    ),
    [porProduto, aberto, buscando],
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Comodato"
        descricao="O que está emprestado a cliente, e com quem. Vem do IXC: o comodato nasce na OS de instalação e é baixado no contrato, lá."
        acoes={
          <button
            type="button"
            onClick={() => {
              void api
                .get('/almoxarifado/comodatos', { params: { recarregar: 1 } })
                .finally(() =>
                  qc.invalidateQueries({ queryKey: ['almoxarifado', 'comodatos'] }),
                );
            }}
            disabled={lista.isFetching}
            className="btn btn-neutro"
          >
            {lista.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
          </button>
        }
      />

      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

      <div className="surgir surgir-1 mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        <Indicador acento rotulo="Peças em comodato" valor={dados ? quantidade(pecas) : '—'} />
        <Indicador rotulo="Contratos com peça" valor={dados ? contratos : '—'} />
        <Indicador
          rotulo="Produtos diferentes"
          valor={dados ? dados.porProduto.length : '—'}
        />
        <Indicador
          rotulo="Em contrato não ativo"
          valor={dados ? inativos : '—'}
          detalhe="equipamento com quem já não é cliente"
          alerta={inativos > 0 ? 'vale buscar' : undefined}
        />
      </div>

      <Bloco
        titulo={`${porProduto.length} ${porProduto.length === 1 ? 'produto' : 'produtos'}`}
        semPadding
        acao={
          dados && (
            <span className="text-[11px] text-tinta-400">
              lido do IXC às{' '}
              {new Date(dados.lidoEm).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )
        }
      >
        <div className="px-3.5 py-3 md:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, endereço, série, MAC ou produto…"
            className="campo"
            autoComplete="off"
          />
        </div>

        {lista.isLoading && <Carregando texto="Lendo o comodato no IXC…" />}

        {!lista.isLoading && porProduto.length === 0 && (
          <Vazio titulo={buscando ? 'Nada com esse termo' : 'Nada em comodato'}>
            {buscando
              ? 'Nenhuma peça em comodato bate com a busca.'
              : 'O IXC não devolveu peça nenhuma emprestada a cliente.'}
          </Vazio>
        )}

        {/* Esmaecida enquanto está atrás do campo: o que se vê é da busca anterior. */}
        <div className={atualizando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {listaDesenhada}
        </div>
      </Bloco>
    </Pagina>
  );
}

interface GrupoDoComodato {
  produtoId: number;
  produto: string;
  itens: ItemEmComodato[];
  quantidade: number;
  contratos: number;
}

const ProdutoEmComodato = memo(function ProdutoEmComodato({
  grupo: g,
  expandido,
  onAlternar,
}: {
  grupo: GrupoDoComodato;
  expandido: boolean;
  onAlternar: (alternar: (aberto: number | null) => number | null) => void;
}) {
  const [quantas, setQuantas] = useState(PECAS_POR_VEZ);
  const faltam = g.itens.length - quantas;
  return (
    <li>
      <button
        type="button"
        onClick={() => onAlternar((a) => (a === g.produtoId ? null : g.produtoId))}
        aria-expanded={expandido}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-brand-500/5 md:px-5"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-tinta-900">{g.produto}</span>
          <span className="block text-xs text-tinta-400">{g.contratos} contrato(s)</span>
        </span>
        <span className="valor text-[16px]">{quantidade(g.quantidade)}</span>
        <span className="text-lg text-tinta-300" aria-hidden>
          {expandido ? '▾' : '›'}
        </span>
      </button>

      {expandido && (
        <ul className="lista-dividida border-t border-tinta-100 bg-tinta-50/60">
          {g.itens.slice(0, quantas).map((i) => (
            <PecaEmComodato key={i.id} item={i} />
          ))}
          {faltam > 0 && (
            <li className="px-3.5 py-2.5 md:px-8">
              <button
                type="button"
                onClick={() => setQuantas((q) => q + PECAS_POR_VEZ * 4)}
                className="btn btn-p btn-sutil"
              >
                Mostrar mais {Math.min(faltam, PECAS_POR_VEZ * 4)} — faltam {faltam}
              </button>
              <span className="ml-2 text-[12px] text-tinta-400">
                ou procure pelo cliente, série ou MAC
              </span>
            </li>
          )}
        </ul>
      )}
    </li>
  );
});

function PecaEmComodato({ item }: { item: ItemEmComodato }) {
  const status = item.contratoStatus ? STATUS_DO_CONTRATO[item.contratoStatus] : null;
  const naoAtivo = !!item.contratoStatus && item.contratoStatus !== 'A';
  return (
    <li className="px-3.5 py-2.5 md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-medium text-tinta-800">{item.cliente}</span>
        <span className="num text-xs text-tinta-500">
          {quantidade(item.quantidade)} · contrato {item.contratoId}
        </span>
      </div>
      {item.endereco && <div className="text-[13px] text-tinta-600">{item.endereco}</div>}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tinta-400">
        {naoAtivo && (
          <Selo pequeno tom="atencao">
            contrato {status ?? item.contratoStatus}
          </Selo>
        )}
        {item.plano && <span>{item.plano}</span>}
        {item.numeroSerie && <span className="num">série {item.numeroSerie}</span>}
        {item.mac && <span className="num">MAC {item.mac}</span>}
        {item.patrimonio && <span className="num">patrimônio {item.patrimonio}</span>}
        {item.desde && <span>desde {formatData(item.desde)}</span>}
        {item.almoxarifado && <span>saiu de {item.almoxarifado}</span>}
      </div>
    </li>
  );
}
