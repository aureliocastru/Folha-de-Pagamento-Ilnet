import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CampoComSugestoes } from '../../components/CampoComSugestoes';
import { CampoDeData } from '../../components/CampoDeData';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';
import { Aviso, Carregando, Janela, Selo, type Tom } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData, formatMedidor, medidorLimpo, medidorNumero } from '../../lib/format';

type Estado = 'VENCIDO' | 'PERTO' | 'EM_DIA' | 'SEM_REGISTRO' | 'SEM_MEDIDOR';

interface Situacao {
  estado: Estado;
  usado: number | null;
  faltaMedidor: number | null;
  venceComMedidor: number | null;
  faltaDias: number | null;
  venceEm: string | null;
}

interface Troca {
  id: string;
  medidor: number | null;
  data: string;
  observacao: string | null;
}

interface Item {
  id: string;
  nome: string;
  intervaloMedidor: number | null;
  intervaloMeses: number | null;
  ultimaTrocaMedidor: number | null;
  ultimaTrocaEm: string | null;
  observacao: string | null;
  situacao: Situacao;
  trocas: Troca[];
}

interface Manutencao {
  veiculo: { id: string; apelido: string; tipo: string };
  unidade: 'km' | 'h';
  medidorAtual: number | null;
  medidorEm: string | null;
  itens: Item[];
  resumo: { vencidos: number; perto: number; semRegistro: number };
  nomesConhecidos: string[];
}

/** O que cada situação diz, e em que cor. */
const ESTADOS: Record<Estado, { rotulo: string; tom: Tom; barra: string }> = {
  VENCIDO: { rotulo: 'vencido', tom: 'erro', barra: 'bg-rose-500' },
  PERTO: { rotulo: 'perto de vencer', tom: 'atencao', barra: 'bg-amber-500' },
  EM_DIA: { rotulo: 'em dia', tom: 'pago', barra: 'bg-emerald-500' },
  SEM_REGISTRO: { rotulo: 'sem a última troca', tom: 'neutro', barra: 'bg-tinta-300' },
  SEM_MEDIDOR: { rotulo: 'sem km de agora', tom: 'neutro', barra: 'bg-tinta-300' },
};

const chave = (veiculoId: string) => ['veiculos', 'manutencao', veiculoId];

/**
 * A manutenção de um veículo: o que se troca, quando foi a última vez e quanto
 * falta.
 *
 * Pedido do dono (23/09/2026): "controlar a vida útil de peças, como pneus,
 * correia, óleo… já deixa preenchido a km média… e sempre que eu abastecer,
 * já atualiza". A lista já vem pronta pelo tipo do veículo, o km de agora é o
 * do último abastecimento, e o que precisa de atenção fica no alto. Trocou? Um
 * toque em "Troquei agora" e a conta recomeça do km de hoje.
 */
export function ManutencaoDoVeiculo({ veiculoId, onFechar }: { veiculoId: string; onFechar: () => void }) {
  const qc = useQueryClient();
  const [trocando, setTrocando] = useState<Item | null>(null);
  const [editando, setEditando] = useState<Item | 'novo' | null>(null);
  const [historico, setHistorico] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const dados = useQuery({
    queryKey: chave(veiculoId),
    queryFn: async () => (await api.get<Manutencao>(`/veiculos/${veiculoId}/manutencao`)).data,
  });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: chave(veiculoId) });
    // A lista da frota traz o selo de "vencido": acompanha.
    void qc.invalidateQueries({ queryKey: ['veiculos'], exact: false });
  };

  const troqueiAgora = useMutation({
    mutationFn: async (item: Item) => {
      await api.post(`/veiculos/manutencao/${item.id}/trocas`, {});
      return item;
    },
    onSuccess: (item) => {
      setFeito(`${item.nome}: troca registrada hoje.`);
      atualizar();
    },
  });

  const desfazer = useMutation({
    mutationFn: async (trocaId: string) => api.delete(`/veiculos/manutencao/trocas/${trocaId}`),
    onSuccess: atualizar,
  });

  const completar = useMutation({
    mutationFn: async () =>
      (await api.post<{ adicionados: number }>(`/veiculos/${veiculoId}/manutencao/padrao`)).data,
    onSuccess: (r) => {
      setFeito(
        r.adicionados > 0
          ? `${r.adicionados} item(ns) da lista padrão voltaram.`
          : 'A lista padrão já está toda aqui.',
      );
      atualizar();
    },
  });

  const d = dados.data;
  const unidade = d?.unidade ?? 'km';
  const med = (n: number) => `${formatMedidor(n, unidade === 'h')} ${unidade}`;

  if (trocando && d) {
    return (
      <JanelaDaTroca
        item={trocando}
        manutencao={d}
        onFechar={() => setTrocando(null)}
        onPronto={(msg) => {
          setTrocando(null);
          setFeito(msg);
          atualizar();
        }}
      />
    );
  }
  if (editando && d) {
    return (
      <JanelaDoItem
        veiculoId={veiculoId}
        item={editando === 'novo' ? null : editando}
        manutencao={d}
        onFechar={() => setEditando(null)}
        onPronto={(msg) => {
          setEditando(null);
          setFeito(msg);
          atualizar();
        }}
      />
    );
  }

  return (
    <Janela titulo={`Manutenção — ${d?.veiculo.apelido ?? ''}`} onFechar={onFechar}>
      {dados.isLoading ? (
        <Carregando />
      ) : dados.isError || !d ? (
        <Aviso tom="erro">{mensagemErro(dados.error)}</Aviso>
      ) : (
        <>
          {/* O km de agora: é dele que sai tudo o que vem abaixo. */}
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-tinta-50 p-4">
            <div>
              <p className="eyebrow">{unidade === 'h' ? 'Horímetro agora' : 'Km agora'}</p>
              {d.medidorAtual != null ? (
                <>
                  <p className="valor mt-1 text-2xl">{med(d.medidorAtual)}</p>
                  <p className="mt-0.5 text-xs text-tinta-500">
                    {d.medidorEm
                      ? `do abastecimento de ${formatData(d.medidorEm)} — cada abastecimento novo atualiza`
                      : 'da última troca registrada'}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-tinta-600">
                  Ainda sem {unidade === 'h' ? 'horímetro' : 'km'}: ele vem do abastecimento. Lance um, e
                  a conta de cada item começa.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.resumo.vencidos > 0 && <Selo tom="erro">{d.resumo.vencidos} vencido(s)</Selo>}
              {d.resumo.perto > 0 && <Selo tom="atencao">{d.resumo.perto} perto</Selo>}
              {d.resumo.vencidos === 0 && d.resumo.perto === 0 && d.resumo.semRegistro < d.itens.length && (
                <Selo tom="pago">tudo em dia</Selo>
              )}
            </div>
          </div>

          {feito && (
            <Aviso tom="pago" acao={<button className="btn btn-sutil btn-p" onClick={() => setFeito(null)}>ok</button>}>
              {feito}
            </Aviso>
          )}
          {(troqueiAgora.isError || desfazer.isError || completar.isError) && (
            <Aviso tom="erro">
              {mensagemErro(troqueiAgora.error ?? desfazer.error ?? completar.error)}
            </Aviso>
          )}

          {d.resumo.semRegistro > 0 && (
            <p className="mb-4 rounded-xl border border-dashed border-tinta-200 p-3 text-[13px] text-tinta-600">
              <strong className="text-tinta-800">Para começar:</strong> em cada item, diga quando foi a
              última troca em <em>Outra data</em>. Não sabe? <em>Troquei agora</em> começa a contar de hoje.
            </p>
          )}

          {d.itens.length === 0 ? (
            <p className="py-6 text-center text-sm text-tinta-500">Nenhum item. Adicione o que este veículo troca.</p>
          ) : (
            <ul className="space-y-2.5">
              {d.itens.map((i) => (
                <LinhaDoItem
                  key={i.id}
                  item={i}
                  med={med}
                  historicoAberto={historico === i.id}
                  onHistorico={() => setHistorico((h) => (h === i.id ? null : i.id))}
                  onTroqueiAgora={() => troqueiAgora.mutate(i)}
                  ocupado={troqueiAgora.isPending && troqueiAgora.variables?.id === i.id}
                  onOutraData={() => setTrocando(i)}
                  onEditar={() => setEditando(i)}
                  onDesfazer={(t) => desfazer.mutate(t)}
                />
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-tinta-100 pt-4">
            <button type="button" onClick={() => setEditando('novo')} className="btn btn-neutro">
              + Adicionar item
            </button>
            <button
              type="button"
              onClick={() => completar.mutate()}
              disabled={completar.isPending}
              className="btn btn-sutil btn-p"
              title="Traz de volta o que falta da lista padrão deste tipo de veículo, sem repetir o que já está aqui"
            >
              {completar.isPending ? 'Trazendo…' : 'Trazer a lista padrão'}
            </button>
          </div>
        </>
      )}
    </Janela>
  );
}

function LinhaDoItem({
  item: i,
  med,
  historicoAberto,
  onHistorico,
  onTroqueiAgora,
  ocupado,
  onOutraData,
  onEditar,
  onDesfazer,
}: {
  item: Item;
  med: (n: number) => string;
  historicoAberto: boolean;
  onHistorico: () => void;
  onTroqueiAgora: () => void;
  ocupado: boolean;
  onOutraData: () => void;
  onEditar: () => void;
  onDesfazer: (trocaId: string) => void;
}) {
  const s = i.situacao;
  const e = ESTADOS[s.estado];
  const usado = Math.min(1, Math.max(0, s.usado ?? 0));

  return (
    <li
      className={`rounded-2xl border p-3.5 ${
        s.estado === 'VENCIDO'
          ? 'border-rose-200 dark:border-rose-500/30'
          : s.estado === 'PERTO'
            ? 'border-amber-200 dark:border-amber-500/30'
            : 'border-tinta-100'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-tinta-900">{i.nome}</p>
          <p className="text-xs text-tinta-500">{intervalo(i, med)}</p>
        </div>
        <Selo pequeno tom={e.tom}>
          {e.rotulo}
        </Selo>
      </div>

      {s.usado != null && (
        <div
          className="mt-2.5 h-2 overflow-hidden rounded-full bg-tinta-100"
          role="progressbar"
          aria-valuenow={Math.round(usado * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${Math.round((s.usado ?? 0) * 100)}% da vida útil`}
        >
          <div className={`h-full rounded-full ${e.barra}`} style={{ width: `${Math.max(3, usado * 100)}%` }} />
        </div>
      )}

      <p className={`mt-2 text-sm ${s.estado === 'VENCIDO' ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-tinta-700'}`}>
        {oQueFalta(i, med)}
      </p>
      {(i.ultimaTrocaEm || i.ultimaTrocaMedidor != null) && (
        <p className="text-xs text-tinta-500">
          Última troca: {i.ultimaTrocaEm ? formatData(i.ultimaTrocaEm) : 'data não informada'}
          {i.ultimaTrocaMedidor != null && ` com ${med(i.ultimaTrocaMedidor)}`}
        </p>
      )}
      {i.observacao && <p className="text-xs text-tinta-500">{i.observacao}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onTroqueiAgora} disabled={ocupado} className="btn btn-primario btn-p">
          {ocupado ? 'Registrando…' : 'Troquei agora'}
        </button>
        <button type="button" onClick={onOutraData} className="btn btn-neutro btn-p">
          Outra data
        </button>
        <button type="button" onClick={onEditar} className="btn btn-sutil btn-p">
          Editar
        </button>
        {i.trocas.length > 0 && (
          <button type="button" onClick={onHistorico} className="btn btn-sutil btn-p ml-auto">
            {historicoAberto ? 'Fechar histórico' : `Histórico (${i.trocas.length})`}
          </button>
        )}
      </div>

      {historicoAberto && (
        <ul className="mt-2.5 space-y-1 rounded-xl bg-tinta-50 p-2.5 text-[13px]">
          {i.trocas.map((t, n) => {
            const anterior = i.trocas[n + 1];
            const durou =
              anterior && t.medidor != null && anterior.medidor != null ? t.medidor - anterior.medidor : null;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-tinta-700">
                  <span className="num">{formatData(t.data)}</span>
                  {t.medidor != null && <> · {med(t.medidor)}</>}
                  {durou != null && durou > 0 && (
                    <span className="text-tinta-400"> · durou {med(durou)}</span>
                  )}
                  {t.observacao && <span className="text-tinta-500"> · {t.observacao}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Desfazer esta troca? A anterior volta a ser a última.')) onDesfazer(t.id);
                  }}
                  className="text-xs text-rose-600 hover:underline dark:text-rose-300"
                >
                  desfazer
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** "A cada 10.000 km ou 12 meses". */
function intervalo(i: Pick<Item, 'intervaloMedidor' | 'intervaloMeses'>, med: (n: number) => string): string {
  const partes = [
    i.intervaloMedidor ? med(i.intervaloMedidor) : null,
    i.intervaloMeses ? `${i.intervaloMeses} ${i.intervaloMeses === 1 ? 'mês' : 'meses'}` : null,
  ].filter(Boolean);
  return `Troca a cada ${partes.join(' ou ')}`;
}

/** A frase de quanto falta — ou de quanto passou. */
function oQueFalta(i: Item, med: (n: number) => string): string {
  const s = i.situacao;
  if (s.estado === 'SEM_REGISTRO') return 'Falta dizer quando foi a última troca.';
  const partes: string[] = [];
  if (s.faltaMedidor != null) {
    partes.push(
      s.faltaMedidor >= 0
        ? `Faltam ${med(s.faltaMedidor)} (troca com ${med(s.venceComMedidor ?? 0)})`
        : `Passou ${med(-s.faltaMedidor)} da troca (era com ${med(s.venceComMedidor ?? 0)})`,
    );
  } else if (s.venceComMedidor != null) {
    partes.push(`Troca com ${med(s.venceComMedidor)} — falta o km de agora, que vem do abastecimento`);
  }
  // Vencido pelo km, o prazo que ainda sobra no calendário só confunde.
  const vencidoPeloKm = s.faltaMedidor != null && s.faltaMedidor < 0;
  if (s.faltaDias != null && s.venceEm && !(vencidoPeloKm && s.faltaDias >= 0)) {
    partes.push(
      s.faltaDias >= 0
        ? `${partes.length ? 'ou até' : 'Até'} ${formatData(s.venceEm)} (${dias(s.faltaDias)})`
        : `venceu em ${formatData(s.venceEm)}, há ${dias(-s.faltaDias)}`,
    );
  }
  return partes.join(' · ') || 'Em dia.';
}

function dias(n: number): string {
  if (n === 0) return 'hoje';
  if (n < 60) return `${n} dia${n === 1 ? '' : 's'}`;
  const meses = Math.round(n / 30.4);
  return `${meses} meses`;
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A troca em outra data, ou com outro km — a de meses atrás, para começar a lista. */
function JanelaDaTroca({
  item,
  manutencao: d,
  onFechar,
  onPronto,
}: {
  item: Item;
  manutencao: Manutencao;
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const horas = d.unidade === 'h';
  const [medidor, setMedidor] = useState(
    d.medidorAtual != null ? (horas ? d.medidorAtual.toFixed(1) : String(Math.round(d.medidorAtual))) : '',
  );
  const [data, setData] = useState(hojeISO());
  const [observacao, setObservacao] = useState('');

  const salvar = useMutation({
    mutationFn: async () =>
      api.post(`/veiculos/manutencao/${item.id}/trocas`, {
        medidor: medidor ? medidorNumero(medidor) : null,
        data,
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => onPronto(`${item.nome}: troca de ${formatData(data)} registrada.`),
  });

  return (
    <Janela titulo={`Troca — ${item.nome}`} onFechar={onFechar}>
      <FormularioEmPassos>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="troca-data">
              Quando foi
            </label>
            <CampoDeData id="troca-data" valor={data} onChange={setData} className="campo" />
          </div>
          <div>
            <label className="rotulo" htmlFor="troca-medidor">
              {horas ? 'Horímetro na troca' : 'Km do painel na troca'}
            </label>
            <input
              id="troca-medidor"
              value={medidor}
              onChange={(e) => setMedidor(medidorLimpo(e.target.value, horas))}
              inputMode={horas ? 'decimal' : 'numeric'}
              className="campo num"
              placeholder={horas ? '1252.6' : '120500'}
              autoComplete="off"
            />
            <p className="ajuda">Não sabe o {horas ? 'horímetro' : 'km'}? Deixe em branco: conta só o tempo.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="troca-obs">
              Observação (opcional)
            </label>
            <input
              id="troca-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo"
              placeholder="Marca, oficina, o que foi feito"
              autoComplete="off"
            />
          </div>
        </div>

        {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => salvar.mutate()}
            disabled={!data || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando…' : 'Registrar a troca'}
          </button>
        </div>
      </FormularioEmPassos>
    </Janela>
  );
}

/** Um item novo, ou mudar o nome e o intervalo de um que existe. */
function JanelaDoItem({
  veiculoId,
  item,
  manutencao: d,
  onFechar,
  onPronto,
}: {
  veiculoId: string;
  item: Item | null;
  manutencao: Manutencao;
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const horas = d.unidade === 'h';
  const [nome, setNome] = useState(item?.nome ?? '');
  const [intervaloMedidor, setIntervaloMedidor] = useState(
    item?.intervaloMedidor ? String(item.intervaloMedidor) : '',
  );
  const [intervaloMeses, setIntervaloMeses] = useState(item?.intervaloMeses ? String(item.intervaloMeses) : '');
  const [observacao, setObservacao] = useState(item?.observacao ?? '');

  const nMedidor = Number(intervaloMedidor) || null;
  const nMeses = Number(intervaloMeses) || null;
  const valido = nome.trim().length >= 2 && (nMedidor != null || nMeses != null);

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        nome: nome.trim(),
        intervaloMedidor: nMedidor,
        intervaloMeses: nMeses,
        observacao: observacao.trim() || (item ? null : undefined),
      };
      if (item) await api.patch(`/veiculos/manutencao/${item.id}`, corpo);
      else await api.post(`/veiculos/${veiculoId}/manutencao`, corpo);
    },
    onSuccess: () => onPronto(item ? `${nome.trim()}: salvo.` : `${nome.trim()} entrou na lista.`),
  });

  const apagar = useMutation({
    mutationFn: async () => api.delete(`/veiculos/manutencao/${item!.id}`),
    onSuccess: () => onPronto(`${item!.nome} saiu da lista.`),
  });

  return (
    <Janela titulo={item ? `Editar — ${item.nome}` : 'Novo item de manutenção'} onFechar={onFechar}>
      <FormularioEmPassos>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2" data-passo-falta={nome.trim().length >= 2 ? undefined : 'Diga o que é.'}>
            <label className="rotulo" htmlFor="item-nome">
              O que é
            </label>
            <CampoComSugestoes
              id="item-nome"
              value={nome}
              onChange={setNome}
              sugestoes={d.nomesConhecidos}
              placeholder="Óleo do motor, pneus, correia…"
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="item-medidor">
              {horas ? 'Troca a cada (horas)' : 'Troca a cada (km)'}
            </label>
            <input
              id="item-medidor"
              value={intervaloMedidor}
              onChange={(e) => setIntervaloMedidor(e.target.value.replace(/\D/g, '').slice(0, 7))}
              inputMode="numeric"
              className="campo num"
              placeholder={horas ? '250' : '10000'}
              autoComplete="off"
            />
          </div>
          <div
            data-passo-falta={
              nMedidor != null || nMeses != null
                ? undefined
                : `Diga de quanto em quanto se troca: em ${horas ? 'horas' : 'km'}, em meses, ou nos dois.`
            }
          >
            <label className="rotulo" htmlFor="item-meses">
              Ou a cada (meses)
            </label>
            <input
              id="item-meses"
              value={intervaloMeses}
              onChange={(e) => setIntervaloMeses(e.target.value.replace(/\D/g, '').slice(0, 3))}
              inputMode="numeric"
              className="campo num"
              placeholder="12"
              autoComplete="off"
            />
            <p className="ajuda">O que chegar primeiro vence. Deixe em branco o que não se aplica.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="item-obs">
              Observação (opcional)
            </label>
            <input
              id="item-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo"
              placeholder="Qual óleo, medida do pneu…"
              autoComplete="off"
            />
          </div>
        </div>

        {(salvar.isError || apagar.isError) && (
          <Aviso tom="erro">{mensagemErro(salvar.error ?? apagar.error)}</Aviso>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {item && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Tirar "${item.nome}" da lista? O histórico de trocas dele vai junto.`)) {
                  apagar.mutate();
                }
              }}
              disabled={apagar.isPending}
              className="btn btn-sutil mr-auto text-rose-600 dark:text-rose-300"
            >
              Tirar da lista
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
            {salvar.isPending ? 'Salvando…' : item ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </FormularioEmPassos>
    </Janela>
  );
}
