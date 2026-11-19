import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CampoDeData } from '../../components/CampoDeData';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';
import { Aviso, Bloco, CabecalhoPagina, CampoDinheiro, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useCelular } from '../../lib/celular';
import { formatBRL, hojeEmBrasilia } from '../../lib/format';

/**
 * Tarifas e rentabilidade dos bancos, lançadas no IXC em lote.
 *
 * O que se fazia em Contabilidade > Lançamentos contábeis, um por um, dia por
 * dia: a linha do banco e a da conta 240. Aqui se digita só banco, tipo, dia e
 * valor; a lista vai ao IXC uma linha por vez, e cada uma é relida lá antes de
 * sair da lista (`tarifas.service.ts` na API). O mesmo dia, banco, tipo e
 * valor não entra duas vezes: nem na lista, nem no IXC.
 */

type Tipo = 'tarifa' | 'rentabilidade';

interface Banco {
  id: number;
  nome: string;
}

interface TarifaNoIxc {
  idMae: number;
  banco: number;
  dia: string;
  tipo: Tipo;
  valor: number;
  historico: string;
  fechado: boolean;
  podeApagar: boolean;
}

interface Pendente {
  chave: string;
  banco: number;
  dia: string;
  tipo: Tipo;
  valor: number;
}

type Resultado =
  | { situacao: 'lancado' | 'ja-existia'; lancamento: TarifaNoIxc }
  | { situacao: 'conferir'; idMae: number; problemas: string[] };

const NOME_DO_TIPO: Record<Tipo, string> = { tarifa: 'Tarifa', rentabilidade: 'Rentabilidade' };
const RASCUNHO = 'contabilidade.tarifas.rascunho';
const ULTIMA_ESCOLHA = 'contabilidade.tarifas.escolha';

function ler<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(chave);
    return v ? (JSON.parse(v) as T) : padrao;
  } catch {
    return padrao;
  }
}

function guardar(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: a lista vive só nesta aba */
  }
}

function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** "2026-11-01" → "01/11". */
function diaCurto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

const cents = (v: number) => Math.round(v * 100);

function mesmo(a: Omit<Pendente, 'chave'>, b: Omit<Pendente, 'chave'>): boolean {
  return a.banco === b.banco && a.dia === b.dia && a.tipo === b.tipo && cents(a.valor) === cents(b.valor);
}

export function TarifasDosBancos() {
  const qc = useQueryClient();
  const celular = useCelular();
  const hoje = hojeEmBrasilia();
  const escolha = ler<{ banco?: number; tipo?: Tipo }>(ULTIMA_ESCOLHA, {});

  const [banco, setBanco] = useState<number | null>(escolha.banco ?? null);
  const [tipo, setTipo] = useState<Tipo>(escolha.tipo ?? 'tarifa');
  const [dia, setDia] = useState(hoje);
  const [valor, setValor] = useState('');
  const [pendentes, setPendentes] = useState<Pendente[]>(() => ler<Pendente[]>(RASCUNHO, []));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<{ tom: 'atencao' | 'erro' | 'pago'; texto: string } | null>(null);
  const [lancando, setLancando] = useState<string | null>(null);
  const [rodada, setRodada] = useState(0);
  const campoValor = useRef<HTMLDivElement>(null);

  useEffect(() => guardar(RASCUNHO, pendentes), [pendentes]);
  useEffect(() => {
    if (banco) guardar(ULTIMA_ESCOLHA, { banco, tipo });
  }, [banco, tipo]);

  const bancos = useQuery({
    queryKey: ['contabilidade', 'tarifas', 'bancos'],
    queryFn: async () => (await api.get<Banco[]>('/contabilidade/tarifas/bancos')).data,
    staleTime: 10 * 60_000,
  });

  // Sem banco escolhido (ou com um que saiu do cadastro), o primeiro.
  useEffect(() => {
    const lista = bancos.data ?? [];
    if (lista.length > 0 && !lista.some((b) => b.id === banco)) setBanco(lista[0].id);
  }, [bancos.data, banco]);

  const mes = (dia || hoje).slice(0, 7);
  const lancadas = useQuery({
    queryKey: ['contabilidade', 'tarifas', mes],
    queryFn: async () =>
      (
        await api.get<TarifaNoIxc[]>('/contabilidade/tarifas', {
          params: { de: `${mes}-01`, ate: ultimoDiaDoMes(mes) },
        })
      ).data,
  });

  const nomeDoBanco = (id: number) => bancos.data?.find((b) => b.id === id)?.nome ?? `Conta ${id}`;
  const doBanco = useMemo(
    () => (lancadas.data ?? []).filter((t) => t.banco === banco).sort((a, b) => b.dia.localeCompare(a.dia) || b.idMae - a.idMae),
    [lancadas.data, banco],
  );
  const noIxc = (p: Omit<Pendente, 'chave'>) => (lancadas.data ?? []).some((t) => mesmo(t, p));

  function adicionar() {
    setAviso(null);
    const v = Number(valor);
    if (!banco || !dia || !(v > 0)) return;
    if (dia > hoje) {
      setAviso({ tom: 'atencao', texto: 'O dia ainda não chegou.' });
      return;
    }
    const nova = { banco, dia, tipo, valor: v };
    if (pendentes.some((p) => mesmo(p, nova))) {
      setAviso({ tom: 'atencao', texto: `${diaCurto(dia)} · ${formatBRL(v)} já está na lista.` });
      return;
    }
    if (noIxc(nova)) {
      setAviso({ tom: 'atencao', texto: `${diaCurto(dia)} · ${formatBRL(v)} já está no IXC.` });
      return;
    }
    setPendentes((ps) => [...ps, { ...nova, chave: `${Date.now()}-${Math.random()}` }]);
    // O próximo é quase sempre o dia seguinte, no mesmo banco e tipo.
    const proximo = diaSeguinte(dia);
    if (proximo <= hoje) setDia(proximo);
    setValor('');
    setRodada((r) => r + 1);
  }

  // O campo de valor nasce de novo a cada lançamento (a máscara guarda os
  // dígitos por dentro), e o foco volta a ele antes da próxima tecla.
  useLayoutEffect(() => {
    if (rodada > 0 && !celular) campoValor.current?.querySelector('input')?.focus();
  }, [rodada, celular]);

  async function lancarTudo() {
    setAviso(null);
    setErros({});
    let lancados = 0;
    let jaEstavam = 0;
    for (const p of pendentes) {
      setLancando(p.chave);
      try {
        const { data } = await api.post<Resultado>('/contabilidade/tarifas', {
          banco: p.banco,
          dia: p.dia,
          tipo: p.tipo,
          valor: p.valor,
        });
        if (data.situacao === 'conferir') {
          setErros({ [p.chave]: `Confira no IXC (lançamento ${data.idMae}): ${data.problemas.join('; ')}.` });
          setAviso({ tom: 'erro', texto: 'Parei: um lançamento não ficou como devia no IXC.' });
          break;
        }
        if (data.situacao === 'lancado') lancados++;
        else jaEstavam++;
        setPendentes((ps) => ps.filter((x) => x.chave !== p.chave));
      } catch (e) {
        setErros({ [p.chave]: mensagemErro(e) });
        setAviso({ tom: 'erro', texto: 'Parei no lançamento marcado — os de cima já estão no IXC.' });
        break;
      }
    }
    setLancando(null);
    if (lancados || jaEstavam) {
      const partes = [
        lancados ? `${lancados} lançad${lancados > 1 ? 'os' : 'o'} no IXC` : '',
        jaEstavam ? `${jaEstavam} já estava${jaEstavam > 1 ? 'm' : ''} lá` : '',
      ].filter(Boolean);
      setAviso((a) => (a?.tom === 'erro' ? a : { tom: 'pago', texto: `${partes.join(' · ')}.` }));
    }
    void qc.invalidateQueries({ queryKey: ['contabilidade', 'tarifas'] });
  }

  const apagar = useMutation({
    mutationFn: async (t: TarifaNoIxc) => (await api.delete(`/contabilidade/tarifas/${t.idMae}`)).data,
    onSuccess: () => {
      setAviso(null);
      void qc.invalidateQueries({ queryKey: ['contabilidade', 'tarifas'] });
    },
    onError: (e) => setAviso({ tom: 'erro', texto: mensagemErro(e) }),
  });

  const total = pendentes.reduce((s, p) => s + p.valor, 0);
  const totais = doBanco.reduce(
    (s, t) => ({ ...s, [t.tipo]: s[t.tipo] + t.valor }),
    { tarifa: 0, rentabilidade: 0 } as Record<Tipo, number>,
  );

  if (bancos.isLoading) {
    return (
      <Pagina>
        <Carregando />
      </Pagina>
    );
  }
  if (bancos.isError) {
    return (
      <Pagina>
        <Aviso tom="erro">{mensagemErro(bancos.error)}</Aviso>
      </Pagina>
    );
  }

  return (
    <Pagina>
      <CabecalhoPagina secao="Contabilidade" titulo="Tarifas e rentabilidade" />

      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}

      <Bloco titulo="Novo lançamento" className="mb-5">
        {/* No celular o passo a passo recomeça a cada lançamento; no
            computador o formulário fica, e o foco volta ao valor. */}
        <FormularioEmPassos key={celular ? rodada : 0}>
          <form
            className="grid max-w-xs grid-cols-1 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              adicionar();
            }}
          >
            <div className="min-w-0">
              <label className="rotulo" htmlFor="tarifa-banco">
                Banco
              </label>
              <select
                id="tarifa-banco"
                className="campo"
                value={banco ?? ''}
                onChange={(e) => setBanco(Number(e.target.value))}
              >
                {(bancos.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className="rotulo" htmlFor="tarifa-tipo">
                Tipo
              </label>
              <select
                id="tarifa-tipo"
                className="campo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as Tipo)}
              >
                <option value="tarifa">Tarifa</option>
                <option value="rentabilidade">Rentabilidade</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="rotulo" htmlFor="tarifa-dia">
                Dia
              </label>
              <CampoDeData id="tarifa-dia" valor={dia} onChange={setDia} max={hoje} />
            </div>
            <div className="min-w-0" ref={campoValor} data-passo-falta={Number(valor) > 0 ? undefined : 'Digite o valor.'}>
              <label className="rotulo" htmlFor="tarifa-valor">
                Valor
              </label>
              <CampoDinheiro key={rodada} id="tarifa-valor" valor={valor} onChange={setValor} />
            </div>
            <div>
              <button
                type="submit"
                className="btn btn-primario"
                disabled={!banco || !dia || !(Number(valor) > 0) || lancando !== null}
              >
                Adicionar
              </button>
            </div>
          </form>
        </FormularioEmPassos>
      </Bloco>

      {pendentes.length > 0 && (
        <Bloco
          titulo={`A lançar (${pendentes.length})`}
          semPadding
          className="mb-5"
          acao={<span className="text-sm font-semibold tabular-nums text-tinta-700">{formatBRL(total)}</span>}
        >
          <ul>
            {pendentes.map((p) => (
              <li key={p.chave} className="linha px-3.5 py-2 md:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="w-12 shrink-0 tabular-nums text-tinta-600">{diaCurto(p.dia)}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-tinta-800">
                    <span>
                      {nomeDoBanco(p.banco)} · {NOME_DO_TIPO[p.tipo]}
                    </span>
                    {noIxc(p) && <Selo tom="atencao" pequeno>Já no IXC</Selo>}
                    {lancando === p.chave && <Selo tom="info" ponto pequeno>Lançando</Selo>}
                  </span>
                  <span className="w-24 shrink-0 text-right font-semibold tabular-nums text-tinta-900">{formatBRL(p.valor)}</span>
                  <button
                    type="button"
                    className="btn btn-sutil btn-p"
                    disabled={lancando !== null}
                    onClick={() => {
                      setPendentes((ps) => ps.filter((x) => x.chave !== p.chave));
                      setErros((es) => {
                        const { [p.chave]: _, ...resto } = es;
                        return resto;
                      });
                    }}
                    aria-label="Tirar da lista"
                  >
                    Tirar
                  </button>
                </div>
                {erros[p.chave] && <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{erros[p.chave]}</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-fio px-3.5 py-3 md:px-5">
            <button type="button" className="btn btn-pagar" disabled={lancando !== null} onClick={() => void lancarTudo()}>
              {lancando !== null
                ? 'Lançando…'
                : `Lançar ${pendentes.length} no IXC`}
            </button>
          </div>
        </Bloco>
      )}

      <Bloco
        titulo={`No IXC · ${banco ? nomeDoBanco(banco) : ''} · ${nomeDoMes(mes)}`}
        semPadding
        acao={
          doBanco.length > 0 ? (
            <span className="text-xs tabular-nums text-tinta-600">
              Tarifas {formatBRL(totais.tarifa)}
              {totais.rentabilidade > 0 && <> · Rentabilidade {formatBRL(totais.rentabilidade)}</>}
            </span>
          ) : undefined
        }
      >
        {lancadas.isLoading ? (
          <Carregando />
        ) : lancadas.isError ? (
          <div className="p-4">
            <Aviso tom="erro">{mensagemErro(lancadas.error)}</Aviso>
          </div>
        ) : doBanco.length === 0 ? (
          <Vazio titulo="Nada lançado neste mês" />
        ) : (
          <ul>
            {doBanco.map((t) => (
              <li key={t.idMae} className="linha flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-sm md:px-5">
                <span className="w-12 shrink-0 tabular-nums text-tinta-600">{diaCurto(t.dia)}</span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-tinta-800">
                  <span>
                    {NOME_DO_TIPO[t.tipo]}
                    {!/^(tarifas|rentabilidade)$/i.test(t.historico) && (
                      <span className="text-tinta-500"> · {t.historico}</span>
                    )}
                  </span>
                  {!t.fechado && <Selo tom="erro" pequeno>Conferir</Selo>}
                </span>
                <span className="w-24 shrink-0 text-right font-semibold tabular-nums text-tinta-900">{formatBRL(t.valor)}</span>
                {t.podeApagar ? (
                  <button
                    type="button"
                    className="btn btn-alerta btn-p"
                    disabled={apagar.isPending || lancando !== null}
                    onClick={() => {
                      if (
                        confirm(
                          `Apagar do IXC a ${NOME_DO_TIPO[t.tipo].toLowerCase()} de ${formatBRL(t.valor)} do dia ${diaCurto(t.dia)} (${nomeDoBanco(t.banco)})?`,
                        )
                      ) {
                        apagar.mutate(t);
                      }
                    }}
                  >
                    {apagar.isPending && apagar.variables?.idMae === t.idMae ? 'Apagando…' : 'Apagar'}
                  </button>
                ) : (
                  <span className="w-[58px] shrink-0" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Bloco>
    </Pagina>
  );
}
