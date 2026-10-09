import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento, useTermoAdiado } from '../../lib/busca';
import type { ConfiguracaoNaTela, PapelDaConta, Selecao } from './tipos';

const PAPEIS: Array<{ valor: PapelDaConta; rotulo: string }> = [
  { valor: 'extrato', rotulo: 'Conta do banco (extrato)' },
  { valor: 'aplicacao', rotulo: 'Aplicação financeira' },
  { valor: 'maquininha', rotulo: 'Maquininha de cartão' },
  { valor: 'caixa', rotulo: 'Caixa (dinheiro)' },
  { valor: 'ignorar', rotulo: 'Não entra' },
];

const RECORTES: Array<{ chave: 'lucros' | 'doacoes' | 'link'; titulo: string }> = [
  { chave: 'lucros', titulo: '13 · Distribuição de lucros' },
  { chave: 'link', titulo: '14 · Compra de link' },
  { chave: 'doacoes', titulo: '18 · Doações' },
];

interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/**
 * Os ajustes da contabilidade: o que cada conta do IXC é, e o que conta como
 * lucro, link e doação. Escolhe-se uma vez; os meses seguintes já usam.
 */
export function AjustesDaContabilidade() {
  const qc = useQueryClient();
  const { hash } = useLocation();
  const [papeis, setPapeis] = useState<Record<string, PapelDaConta>>({});
  const [selecoes, setSelecoes] = useState<Partial<Record<'lucros' | 'doacoes' | 'link', Selecao>>>({});
  const [inativas, setInativas] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cfg = useQuery({
    queryKey: ['contabilidade', 'configuracao'],
    queryFn: async () => (await api.get<ConfiguracaoNaTela>('/contabilidade/configuracao')).data,
  });

  // Quem chega pelo "Ajustar" de um item cai na seção dele.
  useEffect(() => {
    if (!cfg.data || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [cfg.data, hash]);

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = cfg.data!;
      return api.put('/contabilidade/configuracao', {
        papelDasContas: Object.fromEntries(dados.contas.map((c) => [String(c.id), papeis[c.id] ?? c.papel])),
        lucros: limpa(selecoes.lucros ?? dados.lucros),
        doacoes: limpa(selecoes.doacoes ?? dados.doacoes),
        link: limpa(selecoes.link ?? dados.link),
      });
    },
    onSuccess: () => {
      setFeito(true);
      setPapeis({});
      setSelecoes({});
      void qc.invalidateQueries({ queryKey: ['contabilidade'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  if (cfg.isLoading) return <Pagina><Carregando /></Pagina>;
  if (cfg.isError || !cfg.data) {
    return (
      <Pagina>
        <Aviso tom="erro">{mensagemErro(cfg.error)}</Aviso>
      </Pagina>
    );
  }

  const dados = cfg.data;
  // Conta inativa some, como em toda tela nova: só aparece a pedido.
  const contas = dados.contas.filter((c) => inativas || c.ativa);
  const mudou = Object.keys(papeis).length > 0 || Object.keys(selecoes).length > 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contabilidade"
        titulo="Ajustes"
        acoes={
          <button
            type="button"
            className="btn btn-primario"
            disabled={salvar.isPending}
            onClick={() => {
              setErro(null);
              setFeito(false);
              salvar.mutate();
            }}
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        }
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {feito && !mudou && <Aviso tom="pago">Ajustes salvos. Os meses abertos usam na próxima leitura.</Aviso>}

      <div id="contas">
        <Bloco
          titulo="Contas do IXC"
          className="mb-5"
          acao={
            <button type="button" className="btn btn-p btn-sutil" onClick={() => setInativas((v) => !v)}>
              {inativas ? 'Esconder inativas' : 'Mostrar inativas'}
            </button>
          }
        >
          <ul className="space-y-2">
            {contas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold text-tinta-900">{c.nome}</span>
                  {!c.ativa && (
                    <span className="ml-2">
                      <Selo pequeno>inativa</Selo>
                    </span>
                  )}
                </span>
                <select
                  className="campo w-full sm:w-64"
                  value={papeis[c.id] ?? c.papel}
                  onChange={(e) => setPapeis((p) => ({ ...p, [c.id]: e.target.value as PapelDaConta }))}
                >
                  {PAPEIS.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      {p.rotulo}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Bloco>
      </div>

      {RECORTES.map((r) => (
        <div key={r.chave} id={r.chave}>
          <EscolhaDoRecorte
            titulo={r.titulo}
            selecao={selecoes[r.chave] ?? dados[r.chave]}
            sugerida={!selecoes[r.chave] && !!dados[r.chave].sugerida}
            dados={dados}
            onMudar={(s) => setSelecoes((atual) => ({ ...atual, [r.chave]: s }))}
          />
        </div>
      ))}
    </Pagina>
  );
}

function limpa(s: Selecao) {
  return { categorias: s.categorias, planos: s.planos, fornecedores: s.fornecedores };
}

function EscolhaDoRecorte({
  titulo,
  selecao,
  sugerida,
  dados,
  onMudar,
}: {
  titulo: string;
  selecao: Selecao;
  sugerida: boolean;
  dados: ConfiguracaoNaTela;
  onMudar: (s: Selecao) => void;
}) {
  const [buscaPlano, setBuscaPlano] = useState('');
  const [buscaFornecedor, setBuscaFornecedor] = useState('');
  const termoFornecedor = useTermoAdiado(buscaFornecedor);

  const planos = useMemo(() => {
    const termo = semAcento(buscaPlano.trim());
    if (termo.length < 2) return [];
    return dados.planoDeContas
      .filter((p) => !selecao.planos.includes(p.id) && semAcento(p.nome).includes(termo))
      .slice(0, 12);
  }, [buscaPlano, dados.planoDeContas, selecao.planos]);

  const fornecedores = useQuery({
    queryKey: ['fornecedores-ixc', termoFornecedor],
    queryFn: async () => (await api.get<FornecedorIxc[]>('/fornecedores-ixc', { params: { busca: termoFornecedor } })).data,
    enabled: termoFornecedor.length >= 2,
    retry: 0,
  });

  const nomeDoPlano = (id: number) => dados.planoDeContas.find((p) => p.id === id)?.nome ?? `Conta ${id}`;
  const nomeDaCategoria = (id: string) => dados.categorias.find((c) => c.id === id)?.nome ?? id;
  const livres = dados.categorias.filter((c) => !selecao.categorias.includes(c.id));

  return (
    <Bloco titulo={titulo} className="mb-5" acao={sugerida ? <Selo tom="info">sugerido pelo nome</Selo> : undefined}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0">
          <p className="rotulo">Plano de contas do IXC</p>
          <Escolhidos
            itens={selecao.planos.map((id) => ({ chave: String(id), nome: nomeDoPlano(id) }))}
            onTirar={(chave) => onMudar({ ...selecao, planos: selecao.planos.filter((p) => String(p) !== chave) })}
          />
          <input
            className="campo mt-2"
            placeholder="Buscar conta…"
            value={buscaPlano}
            onChange={(e) => setBuscaPlano(e.target.value)}
          />
          <Sugestoes
            itens={planos.map((p) => ({ chave: String(p.id), nome: p.nome }))}
            onEscolher={(chave) => {
              onMudar({ ...selecao, planos: [...selecao.planos, Number(chave)] });
              setBuscaPlano('');
            }}
          />
        </div>

        <div className="min-w-0">
          <p className="rotulo">Categorias do sistema</p>
          <Escolhidos
            itens={selecao.categorias.map((id) => ({ chave: id, nome: nomeDaCategoria(id) }))}
            onTirar={(chave) => onMudar({ ...selecao, categorias: selecao.categorias.filter((c) => c !== chave) })}
          />
          <select
            className="campo mt-2"
            value=""
            onChange={(e) => e.target.value && onMudar({ ...selecao, categorias: [...selecao.categorias, e.target.value] })}
          >
            <option value="">Acrescentar categoria…</option>
            {livres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <p className="rotulo">Fornecedores</p>
          <Escolhidos
            itens={selecao.fornecedores.map((f) => ({ chave: String(f.id), nome: f.nome }))}
            onTirar={(chave) => onMudar({ ...selecao, fornecedores: selecao.fornecedores.filter((f) => String(f.id) !== chave) })}
          />
          <input
            className="campo mt-2"
            placeholder="Buscar fornecedor…"
            value={buscaFornecedor}
            onChange={(e) => setBuscaFornecedor(e.target.value)}
          />
          <Sugestoes
            itens={(termoFornecedor.length >= 2 ? (fornecedores.data ?? []) : [])
              .filter((f) => !selecao.fornecedores.some((x) => x.id === f.idFornecedor))
              .slice(0, 12)
              .map((f) => ({ chave: String(f.idFornecedor), nome: f.nome }))}
            onEscolher={(chave) => {
              const f = fornecedores.data?.find((x) => String(x.idFornecedor) === chave);
              if (f) onMudar({ ...selecao, fornecedores: [...selecao.fornecedores, { id: f.idFornecedor, nome: f.nome }] });
              setBuscaFornecedor('');
            }}
          />
        </div>
      </div>
    </Bloco>
  );
}

function Escolhidos({ itens, onTirar }: { itens: Array<{ chave: string; nome: string }>; onTirar: (chave: string) => void }) {
  if (itens.length === 0) return <p className="text-sm text-tinta-400">Nenhum</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {itens.map((i) => (
        <button key={i.chave} type="button" className="btn btn-p btn-ok" title="Tirar" onClick={() => onTirar(i.chave)}>
          {i.nome} ✕
        </button>
      ))}
    </div>
  );
}

function Sugestoes({ itens, onEscolher }: { itens: Array<{ chave: string; nome: string }>; onEscolher: (chave: string) => void }) {
  if (itens.length === 0) return null;
  return (
    <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-tinta-100">
      {itens.map((i) => (
        <li key={i.chave}>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-tinta-800 hover:bg-tinta-50"
            onClick={() => onEscolher(i.chave)}
          >
            {i.nome}
          </button>
        </li>
      ))}
    </ul>
  );
}
