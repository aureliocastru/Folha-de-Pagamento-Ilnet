import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import { STATUS_LABEL, STATUS_TOM, TIPO_LABEL } from '../../lib/status';
import type {
  ContaPagar,
  Paginado,
  ResultadoLote,
  ResultadoSincronizacao,
  ResumoSincronizacao,
  StatusContaPagar,
} from '../../lib/types';

const STATUS_FILTROS: (StatusContaPagar | 'todos')[] = [
  'todos',
  'AGUARDANDO_APROVACAO',
  'AGUARDANDO_PAGAMENTO',
  'PAGO',
  'REPROVADO',
  'CANCELADO',
  'ERRO',
];

/** As quatro paradas de uma conta, do jeito que acontecem. */
const ETAPAS = [
  ['Salvar', 'a conta nasce no IXC'],
  ['Aprovar', 'auditoria libera'],
  ['Pagar', 'ModoBank, na tela do IXC'],
  ['Conferir', 'o banco confirma aqui'],
];

/**
 * Dá para mudar de ideia nos dois sentidos: reprovada volta a ser aprovada e
 * vice-versa, do mesmo jeito que na auditoria do IXC. Só o pagamento
 * confirmado pelo banco é ponto final — e conta que nunca chegou ao IXC não
 * tem o que auditar.
 */
function podeAprovar(c: ContaPagar): boolean {
  if (c.idFnApagarIxc === null || c.status === 'PAGO') return false;
  return c.status !== 'AGUARDANDO_PAGAMENTO' && c.status !== 'APROVADO';
}

function podeReprovar(c: ContaPagar): boolean {
  if (c.idFnApagarIxc === null || c.status === 'PAGO') return false;
  return c.status !== 'REPROVADO';
}

/** Conta paga é histórico: some do IXC só estornando por lá. */
function podeExcluir(c: ContaPagar): boolean {
  return c.status !== 'PAGO';
}

function soma(contas: ContaPagar[]): number {
  return contas.reduce((s, c) => s + Number(c.valor), 0);
}

/** O que dizer depois de conferir uma conta no IXC. */
function resumoDaVerificacao(r: ResultadoSincronizacao): string {
  if (r.removida) {
    return 'Essa conta não existe mais no IXC — foi apagada daqui também.';
  }
  if (r.mudouStatus && r.conta) {
    return `O IXC mudou a situação: agora está "${STATUS_LABEL[r.conta.status]}".`;
  }
  return 'Nada mudou no IXC: a conta segue como está.';
}

/**
 * O saldo de uma ação em massa. Quem ficou de fora aparece com nome e motivo:
 * lote que "quase todo" deu certo sem dizer o que sobrou é o jeito mais rápido
 * de alguém achar que pagou quem não pagou.
 */
function resumoDoLote(r: ResultadoLote, verbo: string): string {
  const partes = [`${r.sucesso} de ${r.total} conta(s) ${verbo}.`];
  if (r.falhas.length > 0) {
    const mostradas = r.falhas
      .slice(0, 3)
      .map((f) => `${f.beneficiario} (${f.erro})`)
      .join('; ');
    const resto =
      r.falhas.length > 3 ? ` e mais ${r.falhas.length - 3}` : '';
    partes.push(`Ficaram de fora: ${mostradas}${resto}.`);
  }
  return partes.join(' ');
}

export function ContasPagar() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusContaPagar | 'todos'>('todos');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<string[]>([]);
  /** O que está digitado; a consulta sai sozinha quando a mão para. */
  const [busca, setBusca] = useState('');
  // Some da seleção quem sumiu da lista: aprovar em massa o resultado de uma
  // busca que não está mais na tela é o que esta linha existe para impedir.
  const buscaAtiva = useTermoAdiado(busca, () => setSelecao([]));

  const lista = useQuery({
    queryKey: ['contas-pagar', status, buscaAtiva],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (status !== 'todos') params.status = status;
      if (buscaAtiva) params.busca = buscaAtiva;
      return (await api.get<Paginado<ContaPagar>>('/contas-pagar', { params }))
        .data;
    },
  });

  const itens = lista.data?.itens ?? [];
  // A seleção vive presa ao que está na tela: mudou o filtro ou a lista, o que
  // não aparece mais sai da seleção — ninguém aprova em massa às cegas.
  const selecionadas = itens.filter((c) => selecao.includes(c.id));

  function alternar(id: string) {
    setSelecao((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['contas-pagar'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const acao = useMutation({
    mutationFn: async (args: { id: string; op: string; motivo?: string }) => {
      const url = `/contas-pagar/${args.id}/${args.op}`;
      return (await api.post(url, args.motivo ? { motivo: args.motivo } : {}))
        .data;
    },
    onSuccess: (d, args) => {
      const nomes: Record<string, string> = {
        aprovar: 'Conta aprovada — no IXC também.',
        reprovar: 'Conta reprovada — no IXC também.',
        enviar: 'Conta reenviada ao IXC.',
      };
      setFeedback(
        args.op === 'sincronizar'
          ? resumoDaVerificacao(d as ResultadoSincronizacao)
          : (nomes[args.op] ?? 'Pronto.'),
      );
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/contas-pagar/${id}`)).data,
    onSuccess: () => {
      setFeedback('Conta apagada aqui e no IXC.');
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const lote = useMutation({
    mutationFn: async (args: {
      op: 'aprovar-lote' | 'reprovar-lote' | 'excluir-lote';
      ids: string[];
      motivo?: string;
      verbo: string;
    }) =>
      (
        await api.post<ResultadoLote>(`/contas-pagar/${args.op}`, {
          ids: args.ids,
          ...(args.motivo ? { motivo: args.motivo } : {}),
        })
      ).data,
    onSuccess: (r, args) => {
      setFeedback(resumoDoLote(r, args.verbo));
      // O que falhou continua marcado: é o que ainda pede decisão.
      setSelecao(r.falhas.map((f) => f.id));
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const sincronizarTudo = useMutation({
    mutationFn: async () =>
      (
        await api.post<ResumoSincronizacao>(
          '/contas-pagar/sincronizar-pendentes',
        )
      ).data,
    onSuccess: (d) => {
      const partes = [`${d.verificadas} conta(s) verificadas no IXC`];
      if (d.pagas > 0) partes.push(`${d.pagas} o banco acabou de confirmar`);
      const outras = d.atualizadas - d.pagas;
      if (outras > 0) partes.push(`${outras} mudaram de situação lá`);
      if (d.removidas > 0) {
        partes.push(`${d.removidas} não existem mais lá e saíram daqui`);
      }
      if (partes.length === 1) partes.push('nada mudou');
      setFeedback(`${partes.join(' — ')}.`);
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  function aprovar(c: ContaPagar) {
    const mudandoDeIdeia = c.status !== 'AGUARDANDO_APROVACAO';
    const motivo = prompt(
      mudandoDeIdeia
        ? `Voltar atrás e aprovar a conta de ${c.beneficiarioNome}. Motivo:`
        : 'Motivo da aprovação:',
      'Aprovado',
    );
    if (motivo !== null) acao.mutate({ id: c.id, op: 'aprovar', motivo });
  }

  function reprovar(c: ContaPagar) {
    const mudandoDeIdeia = c.status !== 'AGUARDANDO_APROVACAO';
    const motivo = prompt(
      mudandoDeIdeia
        ? `Voltar atrás e reprovar a conta de ${c.beneficiarioNome}. Motivo:`
        : 'Motivo da reprovação:',
      'Reprovado',
    );
    if (motivo) acao.mutate({ id: c.id, op: 'reprovar', motivo });
  }

  function apagar(c: ContaPagar) {
    const ok = confirm(
      `Apagar a conta de ${c.beneficiarioNome} — ${formatBRL(c.valor)}?\n\n` +
        (c.idFnApagarIxc
          ? 'Ela sai daqui e o lançamento é apagado no IXC. Não dá para desfazer.'
          : 'Ela nunca chegou ao IXC, então só sai daqui.'),
    );
    if (ok) excluir.mutate(c.id);
  }

  // --- Em massa: age só sobre as selecionadas que aceitam aquela ação ---
  function aprovarSelecionadas() {
    const alvos = selecionadas.filter(podeAprovar);
    if (alvos.length === 0) return;
    const motivo = prompt(
      `Aprovar ${alvos.length} conta(s), ${formatBRL(soma(alvos))} no total. Motivo:`,
      'Aprovado',
    );
    if (motivo === null) return;
    lote.mutate({
      op: 'aprovar-lote',
      ids: alvos.map((c) => c.id),
      motivo,
      verbo: 'aprovadas',
    });
  }

  function reprovarSelecionadas() {
    const alvos = selecionadas.filter(podeReprovar);
    if (alvos.length === 0) return;
    const motivo = prompt(
      `Reprovar ${alvos.length} conta(s), ${formatBRL(soma(alvos))} no total. Motivo:`,
      'Reprovado',
    );
    if (!motivo) return;
    lote.mutate({
      op: 'reprovar-lote',
      ids: alvos.map((c) => c.id),
      motivo,
      verbo: 'reprovadas',
    });
  }

  function excluirSelecionadas() {
    const alvos = selecionadas.filter(podeExcluir);
    if (alvos.length === 0) return;
    const noIxc = alvos.filter((c) => c.idFnApagarIxc !== null).length;
    const ok = confirm(
      `Apagar ${alvos.length} conta(s), ${formatBRL(soma(alvos))} no total?\n\n` +
        `${noIxc} delas também serão apagadas no IXC. Não dá para desfazer.`,
    );
    if (!ok) return;
    lote.mutate({
      op: 'excluir-lote',
      ids: alvos.map((c) => c.id),
      verbo: 'apagadas',
    });
  }

  const total = itens.reduce((s, c) => s + Number(c.valor), 0);
  const todasMarcadas = itens.length > 0 && selecionadas.length === itens.length;
  // Cada ação vale para um pedaço da seleção: dá para marcar tudo e ainda
  // assim ver quantas realmente aceitam aprovar, reprovar ou sumir.
  const podemAprovar = selecionadas.filter(podeAprovar).length;
  const podemReprovar = selecionadas.filter(podeReprovar).length;
  const podemExcluir = selecionadas.filter(podeExcluir).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a pagar"
        titulo="Pagamentos no IXC"
        descricao="Cada conta nasce aqui, passa pela auditoria e só vira dinheiro quando o banco confirma. O que você faz nesta tela vale no IXC — e o que mudar lá volta no botão Verificar."
        acoes={
          <button
            onClick={() => sincronizarTudo.mutate()}
            disabled={sincronizarTudo.isPending}
            className="btn btn-acao"
          >
            {sincronizarTudo.isPending
              ? 'Verificando…'
              : 'Verificar pagamentos no IXC'}
          </button>
        }
      />

      {feedback && <Aviso tom="marca">{feedback}</Aviso>}

      <Bloco className="surgir surgir-1 mb-6">
        <ol className="flex flex-wrap gap-x-8 gap-y-4">
          {ETAPAS.map(([nome, oque], i) => (
            <li key={nome} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-barra font-display text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-tinta-800">
                  {nome}
                </div>
                <div className="text-xs text-tinta-400">{oque}</div>
              </div>
            </li>
          ))}
        </ol>
      </Bloco>

      <div className="surgir surgir-2 mb-4 flex flex-wrap items-center gap-2">
        {/* Sem botão de buscar: a lista acompanha o que se digita. */}
        <div className="flex w-full max-w-md gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, apelido ou CPF…"
            className="campo"
          />
          {busca && (
            <button
              type="button"
              onClick={() => {
                setBusca('');
                setSelecao([]);
              }}
              className="btn btn-sutil shrink-0"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {buscaAtiva && (
        <p className="surgir mb-3 text-sm text-tinta-500">
          Pagamentos de <strong className="text-tinta-800">{buscaAtiva}</strong>
          {lista.data ? ` — ${lista.data.total} encontrado(s)` : ''}
        </p>
      )}

      <div className="surgir surgir-2 mb-4 flex flex-wrap gap-2">
        {STATUS_FILTROS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s);
              setSelecao([]);
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              status === s
                ? 'bg-barra text-white'
                : 'border border-tinta-200 bg-papel text-tinta-600 hover:border-tinta-300'
            }`}
          >
            {s === 'todos' ? 'Todas' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {selecionadas.length > 0 && (
        <div className="surgir sticky top-3 z-20 mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-barra px-4 py-3 text-sm text-white shadow-lg">
          <span className="font-semibold">
            {selecionadas.length} selecionada(s)
            <span className="valor ml-2 font-normal text-white/70">
              {formatBRL(soma(selecionadas))}
            </span>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <BotaoLote
              onClick={aprovarSelecionadas}
              quantidade={podemAprovar}
              ocupado={lote.isPending}
              className="bg-brand-500 text-barra hover:bg-brand-400"
            >
              Aprovar
            </BotaoLote>
            <BotaoLote
              onClick={reprovarSelecionadas}
              quantidade={podemReprovar}
              ocupado={lote.isPending}
              className="bg-white/10 text-rose-200 hover:bg-white/20"
            >
              Reprovar
            </BotaoLote>
            <BotaoLote
              onClick={excluirSelecionadas}
              quantidade={podemExcluir}
              ocupado={lote.isPending}
              className="bg-rose-600 text-white hover:bg-rose-500"
            >
              Excluir
            </BotaoLote>
            <button
              onClick={() => setSelecao([])}
              className="btn btn-p border border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
            >
              Limpar
            </button>
          </div>
        </div>
      )}

      <Bloco className="surgir surgir-3" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th w-9">
                  <input
                    type="checkbox"
                    className="accent-brand-600"
                    aria-label="Selecionar todas as contas da página"
                    checked={todasMarcadas}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selecionadas.length > 0 && !todasMarcadas;
                      }
                    }}
                    onChange={() =>
                      setSelecao(todasMarcadas ? [] : itens.map((c) => c.id))
                    }
                  />
                </th>
                <th className="th">Beneficiário</th>
                <th className="th">Tipo</th>
                <th className="th">Comp.</th>
                <th className="th">Emissão</th>
                <th className="th text-right">Valor</th>
                <th className="th text-center">Situação</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && (
                <tr>
                  <td colSpan={8}>
                    <Carregando />
                  </td>
                </tr>
              )}
              {itens.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <Vazio titulo="Nenhuma conta nesta situação">
                      As contas aparecem aqui depois que você gera a folha.
                    </Vazio>
                  </td>
                </tr>
              )}
              {itens.map((c) => (
                <tr
                  key={c.id}
                  className={`linha ${
                    selecao.includes(c.id) ? 'linha-marcada' : ''
                  }`}
                >
                  <td className="td">
                    <input
                      type="checkbox"
                      className="accent-brand-600"
                      aria-label={`Selecionar a conta de ${c.beneficiarioNome}`}
                      checked={selecao.includes(c.id)}
                      onChange={() => alternar(c.id)}
                    />
                  </td>
                  <td className="td">
                    <div className="font-medium text-tinta-900">
                      {c.beneficiarioNome}
                    </div>
                    <div className="mt-0.5 max-w-md text-xs text-tinta-400">
                      {c.observacao}
                    </div>
                    {c.erro && (
                      <div className="mt-1 text-xs text-rose-600">{c.erro}</div>
                    )}
                  </td>
                  <td className="td text-tinta-500">{TIPO_LABEL[c.tipo]}</td>
                  <td className="td num text-tinta-500">
                    {c.competencia ?? '—'}
                  </td>
                  <td className="td num text-tinta-500">
                    {formatData(c.dataEmissao)}
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(c.valor)}</span>
                  </td>
                  <td className="td text-center">
                    <Selo tom={STATUS_TOM[c.status]} ponto>
                      {STATUS_LABEL[c.status]}
                    </Selo>
                  </td>
                  <td className="td text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {podeAprovar(c) && (
                        <button
                          onClick={() => aprovar(c)}
                          className="btn btn-pagar btn-p"
                        >
                          Aprovar
                        </button>
                      )}
                      {podeReprovar(c) && (
                        <button
                          onClick={() => reprovar(c)}
                          className="btn btn-p border border-rose-200 text-rose-600 hover:bg-rose-50"
                        >
                          Reprovar
                        </button>
                      )}
                      {(c.status === 'ERRO' || c.status === 'RASCUNHO') && (
                        <button
                          onClick={() => acao.mutate({ id: c.id, op: 'enviar' })}
                          className="btn btn-p bg-amber-500 text-white hover:bg-amber-600"
                        >
                          Reenviar
                        </button>
                      )}
                      {c.idFnApagarIxc !== null && (
                        <button
                          onClick={() =>
                            acao.mutate({ id: c.id, op: 'sincronizar' })
                          }
                          title="Traz do IXC o que mudou por lá: pagamento, aprovação, reprovação ou exclusão"
                          className="btn btn-neutro btn-p"
                        >
                          Verificar
                        </button>
                      )}
                      {podeExcluir(c) && (
                        <button
                          onClick={() => apagar(c)}
                          disabled={excluir.isPending}
                          title="Apaga aqui e no IXC"
                          className="btn btn-perigo btn-p"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {itens.length > 0 && (
          <div className="flex items-center justify-between border-t border-tinta-100 px-5 py-3.5 text-sm">
            <span className="text-tinta-500 num">
              {itens.length} de {lista.data?.total} conta(s)
            </span>
            <span className="text-tinta-500">
              Soma da página{' '}
              <strong className="valor ml-1 text-[15px]">
                {formatBRL(total)}
              </strong>
            </span>
          </div>
        )}
      </Bloco>
    </Pagina>
  );
}

/**
 * Botão da barra de seleção. Mostra quantas contas a ação realmente pega —
 * marcar 10 e aprovar 7 é normal (o resto já está pago ou aprovado), mas
 * precisa estar escrito antes do clique, não depois.
 */
function BotaoLote({
  onClick,
  quantidade,
  ocupado,
  className,
  children,
}: {
  onClick: () => void;
  quantidade: number;
  ocupado: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={quantidade === 0 || ocupado}
      title={quantidade === 0 ? 'Nenhuma das selecionadas aceita esta ação' : undefined}
      className={`btn btn-p disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {ocupado ? 'Aplicando…' : `${children} (${quantidade})`}
    </button>
  );
}
