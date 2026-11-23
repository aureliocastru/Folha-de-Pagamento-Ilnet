import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CampoDeData } from '../../components/CampoDeData';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';
import { Aviso, CampoDinheiro, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  formatBRL,
  formatData,
  hojeEmBrasilia,
  medidorLimpo,
  medidorNumero,
  numeroDigitado,
  soFracao,
} from '../../lib/format';

export interface ItemDaRevisao {
  id: string;
  descricao: string;
  quantidade: number;
  /** De cada unidade; nulo quando não se sabe. */
  preco: number | null;
  total: number | null;
}

export interface Revisao {
  id: string;
  titulo: string;
  data: string;
  medidor: number | null;
  oficina: string | null;
  observacao: string | null;
  itens: ItemDaRevisao[];
  total: number;
}

export const chaveDasRevisoes = (veiculoId: string) => ['veiculos', 'revisoes', veiculoId];

const quantidadeEscrita = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Quanto vale a linha, em centavos — a mesma conta que o servidor faz. */
const totalDaLinha = (quantidade: number, preco: number) => Math.round(quantidade * preco * 100) / 100;

/**
 * A aba das revisões: cada uma com o que se trocou e se pôs, a quantidade e o
 * preço. Pedido do dono (23/11/2026): "a revisão da Hilux de 70 mil km, quero
 * deixar anotado o que foi trocado, colocado, a quantidade e preço, só pra
 * deixar registrado". Não paga nada e não mexe na lista de itens.
 */
export function AbaDasRevisoes({
  revisoes,
  carregando,
  med,
  onNova,
  onEditar,
}: {
  revisoes: Revisao[];
  carregando: boolean;
  med: (n: number) => string;
  onNova: () => void;
  onEditar: (r: Revisao) => void;
}) {
  // A mais recente já vem aberta: é a que se vai ler.
  const [escolhida, setEscolhida] = useState<string | null | undefined>(undefined);
  const aberta = escolhida === undefined ? (revisoes[0]?.id ?? null) : escolhida;

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={onNova} className="btn btn-primario">
          + Nova revisão
        </button>
      </div>

      {carregando ? (
        <p className="py-6 text-center text-sm text-tinta-500">Carregando…</p>
      ) : revisoes.length === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-500">Nenhuma revisão anotada.</p>
      ) : (
        <ul className="space-y-2.5">
          {revisoes.map((r) => (
            <CartaoDaRevisao
              key={r.id}
              revisao={r}
              med={med}
              aberta={aberta === r.id}
              onAbrir={() => setEscolhida(aberta === r.id ? null : r.id)}
              onEditar={() => onEditar(r)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function CartaoDaRevisao({
  revisao: r,
  med,
  aberta,
  onAbrir,
  onEditar,
}: {
  revisao: Revisao;
  med: (n: number) => string;
  aberta: boolean;
  onAbrir: () => void;
  onEditar: () => void;
}) {
  const onde = [formatData(r.data), r.medidor != null ? med(r.medidor) : null, r.oficina].filter(Boolean).join(' · ');
  return (
    <li className="rounded-2xl border border-tinta-100 p-3.5">
      <button
        type="button"
        onClick={onAbrir}
        aria-expanded={aberta}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block break-words font-semibold text-tinta-900">{r.titulo}</span>
          <span className="block break-words text-xs text-tinta-500">{onde}</span>
        </span>
        <span className="shrink-0 text-right">
          {r.total > 0 && <span className="valor block">{formatBRL(r.total)}</span>}
          <span className="block text-xs text-tinta-500">
            {r.itens.length} {r.itens.length === 1 ? 'item' : 'itens'}
          </span>
        </span>
      </button>

      {aberta && (
        <>
          {r.itens.length > 0 && (
            <ul className="mt-2.5 space-y-1.5 rounded-xl bg-realce p-2.5 text-[13px]">
              {r.itens.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-tinta-800">
                    {i.descricao}
                    <span className="block text-xs text-tinta-500">
                      {quantidadeEscrita(i.quantidade)}
                      {i.preco != null && ` × ${formatBRL(i.preco)}`}
                    </span>
                  </span>
                  <span className="num shrink-0 text-tinta-800">
                    {i.total != null ? formatBRL(i.total) : <span className="text-tinta-400">sem preço</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.observacao && <p className="mt-2 break-words text-xs text-tinta-500">{r.observacao}</p>}
          <div className="mt-2.5 flex justify-end">
            <button type="button" onClick={onEditar} className="btn btn-neutro btn-p">
              Editar
            </button>
          </div>
        </>
      )}
    </li>
  );
}

/** Uma linha do formulário: tudo texto enquanto se digita. */
interface Linha {
  chave: string;
  descricao: string;
  /** "6,5" — como se digita. */
  quantidade: string;
  /** Canônico do `CampoDinheiro`: "39.90", ou "" quando não se sabe. */
  preco: string;
}

let sequencia = 0;
const linhaNova = (parcial: Partial<Linha> = {}): Linha => ({
  chave: `l${++sequencia}`,
  descricao: '',
  quantidade: '1',
  preco: '',
  ...parcial,
});

/** A linha em branco que sobra no fim do formulário não é uma linha. */
const emBranco = (l: Linha) => !l.descricao.trim() && !l.preco && (l.quantidade === '1' || !l.quantidade);

const quantidadeDe = (l: Linha) => numeroDigitado(l.quantidade);
const quantidadeValida = (l: Linha) => Number.isFinite(quantidadeDe(l)) && quantidadeDe(l) > 0;

/** Uma revisão nova, ou mudar uma que já está anotada. */
export function JanelaDaRevisao({
  veiculoId,
  revisao,
  unidade,
  medidorAtual,
  onFechar,
  onPronto,
}: {
  veiculoId: string;
  revisao: Revisao | null;
  unidade: 'km' | 'h';
  medidorAtual: number | null;
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const qc = useQueryClient();
  const horas = unidade === 'h';
  const [titulo, setTitulo] = useState(revisao?.titulo ?? '');
  const [data, setData] = useState(revisao?.data ?? hojeEmBrasilia());
  const [medidor, setMedidor] = useState(
    revisao?.medidor != null ? (horas ? revisao.medidor.toFixed(1) : String(Math.round(revisao.medidor))) : '',
  );
  const [oficina, setOficina] = useState(revisao?.oficina ?? '');
  const [observacao, setObservacao] = useState(revisao?.observacao ?? '');
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    revisao && revisao.itens.length > 0
      ? revisao.itens.map((i) =>
          linhaNova({
            descricao: i.descricao,
            quantidade: String(i.quantidade).replace('.', ','),
            preco: i.preco != null ? i.preco.toFixed(2) : '',
          }),
        )
      : [linhaNova()],
  );

  const usadas = linhas.filter((l) => !emBranco(l));
  const problemaDasLinhas = usadas.some((l) => !l.descricao.trim())
    ? 'Toda linha precisa dizer o que foi trocado.'
    : usadas.some((l) => !quantidadeValida(l))
      ? 'Toda linha precisa de uma quantidade maior que zero.'
      : null;
  const total = usadas.reduce((soma, l) => {
    const q = quantidadeDe(l);
    return l.preco && Number.isFinite(q) ? soma + totalDaLinha(q, Number(l.preco)) : soma;
  }, 0);
  const valido = titulo.trim().length >= 2 && !!data && !problemaDasLinhas;

  const mudar = (chave: string, campos: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...campos } : l)));

  /** O que a conferência do celular mostra no passo das linhas. */
  const resumo = usadas
    .map((l) => {
      const q = quantidadeDe(l);
      const t = l.preco && Number.isFinite(q) ? ` = ${formatBRL(totalDaLinha(q, Number(l.preco)))}` : '';
      return `${l.quantidade || '?'} × ${l.descricao.trim() || '?'}${t}`;
    })
    .join('; ');

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        titulo: titulo.trim(),
        data,
        medidor: medidor ? medidorNumero(medidor) : null,
        oficina: oficina.trim() || null,
        observacao: observacao.trim() || null,
        itens: usadas.map((l) => ({
          descricao: l.descricao.trim(),
          quantidade: quantidadeDe(l),
          preco: l.preco ? Number(l.preco) : null,
        })),
      };
      if (revisao) await api.patch(`/veiculos/revisoes/${revisao.id}`, corpo);
      else await api.post(`/veiculos/${veiculoId}/revisoes`, corpo);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveDasRevisoes(veiculoId) });
      onPronto(`${titulo.trim()}: ${revisao ? 'salva' : 'anotada'}.`);
    },
  });

  const apagar = useMutation({
    mutationFn: async () => api.delete(`/veiculos/revisoes/${revisao!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveDasRevisoes(veiculoId) });
      onPronto(`${revisao!.titulo} saiu das revisões.`);
    },
  });

  return (
    <Janela titulo={revisao ? `Editar — ${revisao.titulo}` : 'Nova revisão'} onFechar={onFechar}>
      <FormularioEmPassos ativo={!revisao}>
        <div className="grid max-w-2xl grid-cols-1 gap-3">
          <div data-passo-falta={titulo.trim().length >= 2 ? undefined : 'Dê um nome à revisão.'}>
            <label className="rotulo" htmlFor="revisao-titulo">
              Nome da revisão
            </label>
            <input
              id="revisao-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="campo"
              placeholder="Revisão dos 70 mil km"
              autoComplete="off"
              maxLength={120}
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="revisao-data">
              Quando foi
            </label>
            <CampoDeData id="revisao-data" valor={data} onChange={setData} className="campo" max={hojeEmBrasilia()} />
          </div>
          <div>
            <label className="rotulo" htmlFor="revisao-medidor">
              {horas ? 'Horímetro na revisão (opcional)' : 'Km do painel na revisão (opcional)'}
            </label>
            <input
              id="revisao-medidor"
              value={medidor}
              onChange={(e) => setMedidor(medidorLimpo(e.target.value, horas))}
              inputMode={horas ? 'decimal' : 'numeric'}
              className="campo num"
              placeholder={medidorAtual == null ? '' : horas ? medidorAtual.toFixed(1) : String(Math.round(medidorAtual))}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="revisao-oficina">
              Onde foi feita (opcional)
            </label>
            <input
              id="revisao-oficina"
              value={oficina}
              onChange={(e) => setOficina(e.target.value)}
              className="campo"
              placeholder="Concessionária, oficina…"
              autoComplete="off"
              maxLength={120}
            />
          </div>

          <div data-passo="O que foi trocado" data-passo-valor={resumo} data-passo-falta={problemaDasLinhas ?? undefined}>
            <p className="rotulo">O que foi trocado ou posto</p>
            <ul className="space-y-2">
              {linhas.map((l, n) => (
                /*
                 * No celular a linha tem dois andares (o que foi, e quanto
                 * custou); no computador cabe tudo numa fila só, e uma revisão
                 * de doze itens não vira uma rolagem de mil pixels.
                 */
                <li key={l.chave} className="rounded-xl border border-tinta-200 p-2.5 sm:flex sm:items-center sm:gap-2 sm:py-2">
                  <div className="flex items-center gap-2 sm:contents">
                    <input
                      value={l.descricao}
                      onChange={(e) => mudar(l.chave, { descricao: e.target.value })}
                      className="campo min-w-0 flex-1 sm:order-1"
                      placeholder="Óleo 5W30, filtro de ar, mão de obra…"
                      aria-label={`O que foi trocado — linha ${n + 1}`}
                      autoComplete="off"
                      maxLength={120}
                    />
                    <button
                      type="button"
                      onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((x) => x.chave !== l.chave) : [linhaNova()]))}
                      aria-label={`Tirar a linha ${n + 1}`}
                      title="Tirar esta linha"
                      className="btn btn-neutro shrink-0 px-2.5 sm:order-6"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:contents">
                    <input
                      value={l.quantidade}
                      onChange={(e) => mudar(l.chave, { quantidade: soFracao(e.target.value) })}
                      inputMode="decimal"
                      className="campo num w-20 sm:order-2 sm:w-16"
                      placeholder="Qtd"
                      aria-label={`Quantidade — linha ${n + 1}`}
                      autoComplete="off"
                    />
                    <span aria-hidden className="text-tinta-400 sm:order-3">
                      ×
                    </span>
                    <div className="w-32 sm:order-4 sm:w-28">
                      <CampoDinheiro
                        valor={l.preco}
                        onChange={(v) => mudar(l.chave, { preco: v })}
                        placeholder="Preço de cada"
                      />
                    </div>
                    <span className="num ml-auto text-sm text-tinta-700 sm:order-5 sm:w-28 sm:text-right">
                      {l.preco && quantidadeValida(l) && `= ${formatBRL(totalDaLinha(quantidadeDe(l), Number(l.preco)))}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setLinhas((ls) => [...ls, linhaNova()])}
                className="btn btn-neutro btn-p"
              >
                + Adicionar linha
              </button>
              {total > 0 && (
                <span className="text-sm text-tinta-600">
                  Total <span className="valor">{formatBRL(total)}</span>
                </span>
              )}
            </div>
            {problemaDasLinhas && <p className="mt-2 text-[13px] text-amber-700 dark:text-amber-300">{problemaDasLinhas}</p>}
          </div>

          <div>
            <label className="rotulo" htmlFor="revisao-obs">
              Observação (opcional)
            </label>
            <input
              id="revisao-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo"
              placeholder="Garantia, próxima revisão, o que ficou para depois…"
              autoComplete="off"
              maxLength={500}
            />
          </div>
        </div>

        {(salvar.isError || apagar.isError) && (
          <div data-aviso>
            <Aviso tom="erro">{mensagemErro(salvar.error ?? apagar.error)}</Aviso>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {revisao && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Apagar "${revisao.titulo}"? As linhas dela vão junto.`)) apagar.mutate();
              }}
              disabled={apagar.isPending}
              className="btn btn-sutil mr-auto text-rose-600 dark:text-rose-300"
            >
              Apagar a revisão
            </button>
          )}
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => salvar.mutate()}
            disabled={!valido || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando…' : revisao ? 'Salvar' : 'Anotar a revisão'}
          </button>
        </div>
      </FormularioEmPassos>
    </Janela>
  );
}
