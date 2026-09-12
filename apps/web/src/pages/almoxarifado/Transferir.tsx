import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Vazio,
} from '../../components/ui';
import { IconeLixeira, IconeLupa, IconeMais } from '../../components/icones';
import { api, mensagemErro } from '../../lib/api';
import { semAcento } from '../../lib/busca';
import type {
  AlmoxarifadoCadastro,
  AndamentoDaTransferencia,
  ConteudoDoAlmoxarifado,
  PatrimonioDoAlmoxarifado,
  PecaAchada,
} from '../../lib/types';
import { quantidade } from './ProdutoNoIxc';
import {
  Andamento,
  FicamDeFora,
  identificacao,
  normalizarCodigo,
  pecaDoCodigo,
  useAndamento,
  useConteudo,
} from './transferencia-comum';

/** Quantas linhas a lista da origem mostra de uma vez — a busca estreita o resto. */
const MOSTRAR_ATE = 150;

/** Produto que vai pela quantidade; o `motivo` só vem no patrimônio sem peça. */
type ProdutoDaOrigem = ConteudoDoAlmoxarifado['moviveis'][number] & { motivo?: string };

/** "2,5", "2.5" e "1.250,5" → número. Vazio ou inválido → NaN. */
function numeroDigitado(texto: string): number {
  const t = texto.trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

/**
 * Transferir entre almoxarifados — a "Transferência entre Almoxarifados" do
 * IXC, feita aqui.
 *
 * Escolhe-se de onde sai e para onde vai; o que vai entra na lista **bipando**
 * (ou digitando) o MAC, o número patrimonial ou a série da peça, ou
 * procurando pelo nome. Produto comum entra com a quantidade que se quiser;
 * patrimônio, peça por peça. "Transferir" grava tudo numa transferência só
 * no IXC — é lá que fica o registro.
 */
export function Transferir() {
  const qc = useQueryClient();
  const [de, setDe] = useState('');
  const [para, setPara] = useState('');
  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState<{ texto: string; ruim: boolean } | null>(null);
  /** produtoId → quantidade digitada. */
  const [produtos, setProdutos] = useState<Record<number, string>>({});
  const [pecas, setPecas] = useState<Set<number>>(new Set());
  const [observacao, setObservacao] = useState('');
  /** A janela que mostra o que vai e para onde, antes de gravar no IXC. */
  const [confirmando, setConfirmando] = useState(false);
  /** A transferência acompanhada — a gravada agora, ou a do "tentar de novo". */
  const [aberta, setAberta] = useState<AndamentoDaTransferencia | null>(null);
  const transferenciaId = aberta?.id ?? null;
  const campoDeBusca = useRef<HTMLInputElement>(null);

  const almoxarifados = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados'],
    queryFn: async () =>
      (await api.get<AlmoxarifadoCadastro[]>('/almoxarifado/almoxarifados')).data,
  });
  const liberados = (almoxarifados.data ?? []).filter((a) => a.liberado);
  const destinos = liberados.filter((a) => a.ativo && String(a.id) !== de);

  const conteudo = useConteudo(de ? Number(de) : null);
  const c = conteudo.data;
  /** Produto que vai pela quantidade — o comum e o patrimônio sem peça cadastrada. */
  const produtosDaOrigem: ProdutoDaOrigem[] = useMemo(
    () => (c ? [...c.moviveis, ...c.semPeca] : []),
    [c],
  );

  const terminou = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'conteudo'] });
  }, [qc]);
  const andamento = useAndamento(transferenciaId, terminou);

  function limparLista() {
    setProdutos({});
    setPecas(new Set());
  }

  function trocarOrigem(v: string) {
    setDe(v);
    if (v === para) setPara('');
    limparLista();
    setAviso(null);
    setBusca('');
  }

  function porProduto(produtoId: number, saldo: number) {
    setProdutos((p) => ({ ...p, [produtoId]: String(saldo).replace('.', ',') }));
  }

  function porPeca(p: PatrimonioDoAlmoxarifado) {
    setPecas((s) => new Set(s).add(p.patrimonioId));
  }

  function tirarProduto(produtoId: number) {
    setProdutos((p) => {
      const n = { ...p };
      delete n[produtoId];
      return n;
    });
  }

  function tirarPeca(patrimonioId: number) {
    setPecas((s) => {
      const n = new Set(s);
      n.delete(patrimonioId);
      return n;
    });
  }

  function porTudo(conteudoDaOrigem: ConteudoDoAlmoxarifado) {
    setProdutos(
      Object.fromEntries(
        produtosDaOrigem.map((m) => [m.produtoId, String(m.saldo).replace('.', ',')]),
      ),
    );
    setPecas(new Set(conteudoDaOrigem.patrimonios.map((p) => p.patrimonioId)));
  }

  /**
   * A peça achada no IXC entra na lista, e a origem dela vira a origem da
   * transferência — é o que faz a tela começar pelo fim: bipa-se a ONU sem
   * saber de cabeça em que van ela está.
   */
  function biparAchada(achada: PecaAchada) {
    if (!achada.podeMover) {
      setAviso({
        texto:
          `${achada.descricao} está em ${achada.almoxarifado || 'lugar nenhum'}, mas não dá para ` +
          `transferir daqui: ${achada.impedimento}.`,
        ruim: true,
      });
      return;
    }
    const origemNova = String(achada.almoxId);
    if (origemNova !== de) {
      // A lista era do almoxarifado anterior; nada dela vale na origem nova.
      setDe(origemNova);
      if (origemNova === para) setPara('');
      setProdutos({});
      setPecas(new Set([achada.patrimonioId]));
    } else {
      setPecas((s) => new Set(s).add(achada.patrimonioId));
    }
    setBusca('');
    setAviso({
      texto: `Entrou: ${achada.descricao} — sai de ${achada.almoxarifado}. Escolha para onde vai.`,
      ruim: false,
    });
  }

  const acharNoIxc = useMutation({
    mutationFn: async (codigo: string) =>
      (
        await api.get<PecaAchada>('/almoxarifado/patrimonios/onde', { params: { codigo } })
      ).data,
    onSuccess: biparAchada,
    onError: (e) => setAviso({ texto: mensagemErro(e), ruim: true }),
  });

  /** Enter no campo: se é o código de uma peça, ela entra na hora — é o leitor bipando. */
  function aoBipar() {
    if (!busca.trim() || acharNoIxc.isPending) return;
    /* Sem origem escolhida — ou com o código de uma peça que não está nela —
       quem responde é o IXC: ele diz de qual almoxarifado ela sai. */
    if (!c) {
      acharNoIxc.mutate(busca.trim());
      return;
    }
    const peca = pecaDoCodigo(c.patrimonios, busca);
    if (peca) {
      if (pecas.has(peca.patrimonioId)) {
        setAviso({ texto: `${peca.descricao} (${identificacao(peca)}) já está na lista.`, ruim: true });
      } else {
        porPeca(peca);
        setAviso({ texto: `Entrou: ${peca.descricao} — ${identificacao(peca)}`, ruim: false });
      }
      setBusca('');
      return;
    }
    const soUmProduto = filtrados.produtos.length === 1 && filtrados.pecas.length === 0;
    if (soUmProduto) {
      const m = filtrados.produtos[0];
      porProduto(m.produtoId, m.saldo);
      setAviso({ texto: `Entrou: ${m.descricao} — ${quantidade(m.saldo)} ${m.unidadeSigla}`, ruim: false });
      setBusca('');
      return;
    }
    /* Não é nada que esteja nesta origem: pode ser peça de outro
       almoxarifado, e é o IXC que sabe de qual. */
    if (normalizarCodigo(busca).length >= 3 && filtrados.pecas.length === 0 && filtrados.produtos.length === 0) {
      acharNoIxc.mutate(busca.trim());
    }
  }

  const filtrados = useMemo(() => {
    if (!c) return { produtos: [], pecas: [] };
    const t = semAcento(busca.trim());
    const cod = normalizarCodigo(busca);
    if (!t) return { produtos: produtosDaOrigem, pecas: c.patrimonios };
    return {
      produtos: produtosDaOrigem.filter(
        (m) => semAcento(m.descricao).includes(t) || String(m.produtoId) === busca.trim(),
      ),
      pecas: c.patrimonios.filter(
        (p) =>
          semAcento(p.descricao).includes(t) ||
          (cod.length >= 2 &&
            [p.mac, p.numeroPatrimonial, p.numeroSerie].some((x) =>
              normalizarCodigo(x).includes(cod),
            )),
      ),
    };
  }, [c, produtosDaOrigem, busca]);

  // A lista, conferida contra o que a origem tem.
  const naLista = useMemo(() => {
    if (!c) return { produtos: [], pecas: [], problemas: 0 };
    const linhas = Object.entries(produtos).flatMap(([id, qtd]) => {
      const m = produtosDaOrigem.find((x) => x.produtoId === Number(id));
      if (!m) return [];
      const n = numeroDigitado(qtd);
      const problema = !(n > 0) ? 'quantidade inválida' : n > m.saldo + 1e-9 ? `só tem ${quantidade(m.saldo)}` : null;
      return [{ m, qtd, n, problema }];
    });
    const escolhidas = c.patrimonios.filter((p) => pecas.has(p.patrimonioId));
    return {
      produtos: linhas,
      pecas: escolhidas,
      problemas: linhas.filter((l) => l.problema).length,
    };
  }, [c, produtosDaOrigem, produtos, pecas]);
  const itensNaLista = naLista.produtos.length + naLista.pecas.length;
  const nomeDe = liberados.find((a) => String(a.id) === de)?.descricao ?? '';
  const nomePara = destinos.find((a) => String(a.id) === para)?.descricao ?? '';

  const transferir = useMutation({
    mutationFn: async () =>
      (
        await api.post<AndamentoDaTransferencia>('/almoxarifado/transferencias', {
          de: Number(de),
          para: Number(para),
          observacao: observacao.trim() || undefined,
          produtos: naLista.produtos.map((l) => ({ produtoId: l.m.produtoId, quantidade: l.n })),
          patrimonios: naLista.pecas.map((p) => p.patrimonioId),
        })
      ).data,
    onSuccess: setAberta,
  });
  const acompanhada = andamento.data?.id === transferenciaId ? andamento.data : aberta;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Transferir"
        descricao="A transferência entre almoxarifados do IXC, mais simples: escolha de onde sai e para onde vai, bipe ou procure o que vai — MAC, nº patrimonial ou série para ONU e roteador — e grave. Fica tudo salvo no IXC."
      />

      <Bloco titulo="Bipe a peça, e escolha para onde vai">
        {/*
          A busca fica aqui em cima, antes dos dois campos e sempre à vista: é
          por ela que a tela começa. Bipada uma ONU, o IXC diz de qual
          almoxarifado ela sai e o "Sai de" se marca sozinho — resta escolher o
          destino. Escolhendo a origem à mão, o mesmo campo filtra a lista dela.
        */}
        <div className="mb-3">
          <label className="rotulo" htmlFor="transf-busca">
            Peça ou produto
          </label>
          {/* O botão faz o que o Enter faz: no celular, onde o teclado esconde
              a tela e o "ir" some, é ele quem procura. */}
          <div className="flex gap-2">
            <input
              id="transf-busca"
              ref={campoDeBusca}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  aoBipar();
                }
              }}
              className="campo min-w-0 flex-1"
              placeholder="Bipe ou digite MAC, nº patrimonial, série — ou o nome do produto"
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              onClick={aoBipar}
              disabled={!busca.trim() || acharNoIxc.isPending}
              className="btn btn-pagar shrink-0"
              title="Procurar a peça no IXC"
            >
              <IconeLupa />
              Procurar
            </button>
          </div>
          <p className="ajuda">
            {acharNoIxc.isPending
              ? 'Procurando a peça no IXC…'
              : 'Bipando uma peça, o almoxarifado de onde ela sai é marcado sozinho.'}
          </p>
        </div>

        {aviso && (
          <p
            className={`mb-3 text-[13px] ${
              aviso.ruim
                ? 'text-rose-600 dark:text-rose-300'
                : 'text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {aviso.texto}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="transf-de">
              Sai de
            </label>
            <select
              id="transf-de"
              value={de}
              onChange={(e) => trocarOrigem(e.target.value)}
              className="campo"
              disabled={almoxarifados.isLoading}
            >
              <option value="">Escolha…</option>
              {liberados.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.descricao}
                  {a.ativo ? '' : ' (inativo)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="transf-para">
              Vai para
            </label>
            <select
              id="transf-para"
              value={para}
              onChange={(e) => setPara(e.target.value)}
              className="campo"
              disabled={!de}
            >
              <option value="">Escolha…</option>
              {destinos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.descricao}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/*
          Concluir fica aqui em cima, junto do destino, e não no fim da página:
          a lista do que vai tem quinhentas linhas de rolagem, e terminar a
          transferência não pode depender de chegar ao fim delas.
        */}
        {itensNaLista > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-tinta-200 pt-3">
            <p className="text-[13px] text-tinta-600">
              <strong>{itensNaLista}</strong> {itensNaLista === 1 ? 'item' : 'itens'} na lista
              {nomeDe && ` — sai de ${nomeDe}`}
              {nomePara && `, vai para ${nomePara}`}
              {naLista.problemas > 0 && (
                <span className="text-rose-600 dark:text-rose-300">
                  {' '}
                  · {naLista.problemas} com quantidade a acertar
                </span>
              )}
            </p>
            <button
              type="button"
              disabled={
                !para || itensNaLista === 0 || naLista.problemas > 0 || transferir.isPending
              }
              onClick={() => setConfirmando(true)}
              className="btn btn-primario"
            >
              {transferir.isPending
                ? 'Abrindo a transferência…'
                : !para
                  ? 'Escolha para onde vai'
                  : `Transferir ${itensNaLista} ${itensNaLista === 1 ? 'item' : 'itens'}`}
            </button>
          </div>
        )}

        {(almoxarifados.data ?? []).some((a) => !a.liberado) && (
          <p className="ajuda mt-2">
            Almoxarifado de técnico que não aparece aqui ainda não está liberado para o sistema —
            libere na aba Almoxarifados.
          </p>
        )}
      </Bloco>

      {de && (
        // grid-cols-1 é minmax(0, 1fr): sem ele a coluna cresce até o
        // conteúdo mais largo, e no celular passava da tela.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Bloco titulo={nomeDe ? `O que tem em ${nomeDe}` : 'O que tem'}>
            {conteudo.isLoading && <Carregando texto="Lendo no IXC o que tem nele…" />}
            {conteudo.isError && <Aviso tom="erro">{mensagemErro(conteudo.error)}</Aviso>}

            {c && (
              <>
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => porTudo(c)}
                    disabled={produtosDaOrigem.length + c.patrimonios.length === 0}
                    className="btn btn-neutro shrink-0"
                  >
                    Pôr tudo
                  </button>
                </div>

                {produtosDaOrigem.length + c.patrimonios.length === 0 ? (
                  <Vazio titulo="Nada para transferir">
                    {c.deFora.length > 0
                      ? 'Só tem o que não vai por transferência (abaixo).'
                      : 'Este almoxarifado está vazio no IXC.'}
                  </Vazio>
                ) : (
                  <ListaDaOrigem
                    produtos={filtrados.produtos}
                    pecas={filtrados.pecas}
                    naLista={(k) =>
                      k.tipo === 'produto' ? k.id in produtos : pecas.has(k.id)
                    }
                    onPorProduto={(m) => porProduto(m.produtoId, m.saldo)}
                    onPorPeca={(p) => porPeca(p)}
                    onTirarProduto={(m) => tirarProduto(m.produtoId)}
                    onTirarPeca={(p) => tirarPeca(p.patrimonioId)}
                  />
                )}

                {c.deFora.length > 0 && <FicamDeFora itens={c.deFora} />}
              </>
            )}
          </Bloco>

          <Bloco
            titulo={`Vai na transferência (${itensNaLista})`}
            acao={
              itensNaLista > 0 && (
                <button type="button" onClick={limparLista} className="btn btn-sutil btn-p">
                  Limpar
                </button>
              )
            }
          >
            {itensNaLista === 0 ? (
              <p className="text-sm text-tinta-400">
                Bipe uma peça ou toque em + num item da esquerda.
              </p>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                {naLista.produtos.map((l) => (
                  <div
                    key={`m${l.m.produtoId}`}
                    className="flex items-center gap-2 border-b border-tinta-100 px-3 py-1.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-tinta-800">{l.m.descricao}</div>
                      <div className="text-[11px] text-tinta-400">
                        tem {quantidade(l.m.saldo)} {l.m.unidadeSigla}
                        {l.problema && (
                          <span className="ml-1 text-rose-600 dark:text-rose-300">
                            · {l.problema}
                          </span>
                        )}
                      </div>
                    </div>
                    <input
                      value={l.qtd}
                      onChange={(e) =>
                        setProdutos((p) => ({
                          ...p,
                          [l.m.produtoId]: e.target.value.replace(/[^\d.,]/g, ''),
                        }))
                      }
                      inputMode="decimal"
                      className="campo num w-24 py-1 text-right"
                      aria-label={`Quantidade de ${l.m.descricao}`}
                    />
                    <span className="w-8 text-[11px] text-tinta-400">{l.m.unidadeSigla}</span>
                    <Tirar onClick={() => tirarProduto(l.m.produtoId)} />
                  </div>
                ))}
                {naLista.pecas.map((p) => (
                  <div
                    key={`p${p.patrimonioId}`}
                    className="flex items-center gap-2 border-b border-tinta-100 px-3 py-1.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-tinta-800">{p.descricao}</div>
                      <div className="truncate text-[11px] text-tinta-400">{identificacao(p)}</div>
                    </div>
                    <Tirar onClick={() => tirarPeca(p.patrimonioId)} />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3">
              <label className="rotulo" htmlFor="transf-obs">
                Observação (vai para o IXC)
              </label>
              <input
                id="transf-obs"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value.slice(0, 200))}
                className="campo"
                placeholder="Ex.: kit da van da equipe 2"
                autoComplete="off"
              />
            </div>

            {transferir.isError && <Aviso tom="erro">{mensagemErro(transferir.error)}</Aviso>}

            {/* O de concluir é o de cima; aqui embaixo fica só o atalho para
                quem acabou de mexer na lista e não quer rolar de volta. */}
            {itensNaLista > 0 && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={
                    !para || naLista.problemas > 0 || transferir.isPending
                  }
                  onClick={() => setConfirmando(true)}
                  className="btn btn-primario"
                >
                  {transferir.isPending
                    ? 'Abrindo a transferência…'
                    : !para
                      ? 'Escolha para onde vai'
                      : `Transferir ${itensNaLista} ${itensNaLista === 1 ? 'item' : 'itens'}`}
                </button>
              </div>
            )}
          </Bloco>
        </div>
      )}

      {confirmando && (
        <Janela titulo="Confere antes de gravar no IXC" onFechar={() => setConfirmando(false)}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="selo bg-tinta-100 text-tinta-600">{nomeDe}</span>
            <span className="text-tinta-400" aria-hidden>
              →
            </span>
            <span className="selo bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {nomePara}
            </span>
          </div>

          <div className="rolagem-fina max-h-[22rem] overflow-y-auto rounded-xl border border-tinta-100">
            {naLista.produtos.map((l) => (
              <div
                key={`c-m${l.m.produtoId}`}
                className="flex items-baseline justify-between gap-3 border-b border-tinta-100 px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-[13px] text-tinta-800">{l.m.descricao}</span>
                <span className="valor whitespace-nowrap text-[13px]">
                  {quantidade(l.n)} {l.m.unidadeSigla}
                </span>
              </div>
            ))}
            {naLista.pecas.map((p) => (
              <div
                key={`c-p${p.patrimonioId}`}
                className="flex items-baseline justify-between gap-3 border-b border-tinta-100 px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-[13px] text-tinta-800">
                  {p.descricao}
                  <span className="block truncate text-[11px] text-tinta-400">
                    {identificacao(p)}
                  </span>
                </span>
                <span className="valor whitespace-nowrap text-[13px]">1 {p.unidadeSigla}</span>
              </div>
            ))}
          </div>

          {observacao.trim() && (
            <p className="ajuda mt-2">Observação, que vai para o IXC: "{observacao.trim()}"</p>
          )}
          <p className="ajuda mt-2">
            Grava uma transferência só no IXC. Para desfazer, só movendo de volta.
          </p>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="btn btn-neutro"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={transferir.isPending}
              onClick={() => {
                setConfirmando(false);
                transferir.mutate();
              }}
              className="btn btn-pagar"
            >
              {transferir.isPending
                ? 'Abrindo a transferência…'
                : `Transferir ${itensNaLista} ${itensNaLista === 1 ? 'item' : 'itens'}`}
            </button>
          </div>
        </Janela>
      )}

      {acompanhada && (
        <Janela
          titulo="Transferência"
          onFechar={() => {
            if (acompanhada.status === 'rodando') return;
            setAberta(null);
            transferir.reset();
            limparLista();
            setObservacao('');
            setAviso(null);
            campoDeBusca.current?.focus();
          }}
        >
          <Andamento
            a={acompanhada}
            erro={andamento.error}
            onNova={setAberta}
            onFechar={() => {
              setAberta(null);
              transferir.reset();
              limparLista();
              setObservacao('');
              setAviso(null);
            }}
          />
        </Janela>
      )}
    </Pagina>
  );
}

function ListaDaOrigem({
  produtos,
  pecas,
  naLista,
  onPorProduto,
  onPorPeca,
  onTirarProduto,
  onTirarPeca,
}: {
  produtos: ProdutoDaOrigem[];
  pecas: PatrimonioDoAlmoxarifado[];
  naLista: (k: { tipo: 'produto' | 'peca'; id: number }) => boolean;
  onPorProduto: (m: ProdutoDaOrigem) => void;
  onPorPeca: (p: PatrimonioDoAlmoxarifado) => void;
  onTirarProduto: (m: ProdutoDaOrigem) => void;
  onTirarPeca: (p: PatrimonioDoAlmoxarifado) => void;
}) {
  const total = produtos.length + pecas.length;
  if (total === 0) return <p className="text-sm text-tinta-400">Nada com esse termo.</p>;
  const produtosMostrados = produtos.slice(0, MOSTRAR_ATE);
  const pecasMostradas = pecas.slice(0, Math.max(0, MOSTRAR_ATE - produtosMostrados.length));

  return (
    <div className="max-h-[28rem] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
      {produtosMostrados.map((m) => (
        <LinhaDaOrigem
          key={`m${m.produtoId}`}
          nome={m.descricao}
          detalhe={
            `${quantidade(m.saldo)} ${m.unidadeSigla}` +
            (m.motivo ? ' · patrimônio sem peça cadastrada, vai pela quantidade' : '')
          }
          jaNaLista={naLista({ tipo: 'produto', id: m.produtoId })}
          onPor={() => onPorProduto(m)}
          onTirar={() => onTirarProduto(m)}
        />
      ))}
      {pecasMostradas.map((p) => (
        <LinhaDaOrigem
          key={`p${p.patrimonioId}`}
          nome={p.descricao}
          detalhe={identificacao(p)}
          jaNaLista={naLista({ tipo: 'peca', id: p.patrimonioId })}
          onPor={() => onPorPeca(p)}
          onTirar={() => onTirarPeca(p)}
        />
      ))}
      {total > MOSTRAR_ATE && (
        <p className="px-3 py-2 text-[12px] text-tinta-400">
          Mostrando {MOSTRAR_ATE} de {total} — digite para achar o resto.
        </p>
      )}
    </div>
  );
}

/**
 * Uma linha do que a origem tem, com o botão do que fazer com ela.
 *
 * Verde põe, vermelho tira, e os dois são botão com nome escrito: um "+" e um
 * "×" de dez pixels são alvo de mira no computador e de sorte no celular, que
 * é onde esta tela é usada — com a caixa numa das mãos.
 */
function LinhaDaOrigem({
  nome,
  detalhe,
  jaNaLista,
  onPor,
  onTirar,
}: {
  nome: string;
  detalhe: string;
  jaNaLista: boolean;
  onPor: () => void;
  onTirar: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-tinta-100 px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-tinta-800">{nome}</div>
        <div className="truncate text-[11px] text-tinta-400">{detalhe}</div>
      </div>
      {jaNaLista ? (
        <Tirar onClick={onTirar} />
      ) : (
        <button
          type="button"
          onClick={onPor}
          className="btn btn-pagar shrink-0"
          aria-label={`Pôr ${nome} na lista`}
        >
          <IconeMais />
          Pôr
        </button>
      )}
    </div>
  );
}

/** Tirar da lista: vermelho, com o nome escrito, do tamanho de um dedo. */
function Tirar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-perigo shrink-0"
      aria-label="Tirar da lista"
    >
      <IconeLixeira />
      Tirar
    </button>
  );
}
