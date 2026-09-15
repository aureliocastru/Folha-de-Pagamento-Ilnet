import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FotoDaNota } from '../../components/FotoDaNota';
import { FotoDoPonto } from '../../components/PainelDePontos';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Indicador,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import { NovaDespesa } from './NovaDespesa';

type TipoVeiculo = 'MOTO' | 'CARRO' | 'CAMINHONETE' | 'CAMINHAO' | 'MAQUINA' | 'OUTRO';

const TIPOS: Array<{ valor: TipoVeiculo; rotulo: string }> = [
  { valor: 'MOTO', rotulo: 'Moto' },
  { valor: 'CARRO', rotulo: 'Carro' },
  { valor: 'CAMINHONETE', rotulo: 'Caminhonete' },
  { valor: 'CAMINHAO', rotulo: 'Caminhão' },
  { valor: 'MAQUINA', rotulo: 'Máquina' },
  { valor: 'OUTRO', rotulo: 'Outro' },
];

const rotuloDoTipo = (t: TipoVeiculo) => TIPOS.find((x) => x.valor === t)?.rotulo ?? t;

interface VeiculoNaLista {
  id: string;
  apelido: string;
  tipo: TipoVeiculo;
  placa: string | null;
  modelo: string | null;
  ano: number | null;
  observacao: string | null;
  ativo: boolean;
  responsavel: { id: string; nome: string } | null;
  gasto: number;
  emAberto: number;
  quantidade: number;
  ultimoGasto: string | null;
  combustivel: number;
  abastecimentos: number;
  abastecimentosAConferir: number;
  ultimoKm: number | null;
}

interface Abastecimento {
  id: string;
  /** Null = na conferência: o valor da nota ainda não foi posto. */
  valor: number | null;
  km: number;
  data: string;
  lancadoPor: string;
  temFoto: boolean;
  conferidoPor: string | null;
}

interface AbastecimentoAConferir extends Abastecimento {
  veiculo: { id: string; apelido: string; placa: string | null };
}

interface Ficha {
  veiculo: VeiculoNaLista;
  gastos: Array<{
    contaId: string;
    idFnApagarIxc: number | null;
    fornecedor: string;
    observacao: string;
    valor: number;
    vencimento: string;
    situacao: 'paga' | 'em aberto' | 'nao enviada' | 'cancelada';
    categoria: { id: string; nome: string; grupo: { id: string; nome: string } | null } | null;
  }>;
  porCategoria: Array<{ nome: string; valor: number }>;
  combustivel: {
    total: number;
    quantidade: number;
    aConferir: number;
    ultimoKm: number | null;
    kmRodados: number | null;
    custoPorKm: number | null;
  };
  abastecimentos: Abastecimento[];
}

const km = (n: number) => `${n.toLocaleString('pt-BR')} km`;

/** "Honda CG 160 · 2022 · ABC1D23" — o que distingue duas motos iguais. */
function identificacao(v: Pick<VeiculoNaLista, 'tipo' | 'modelo' | 'ano' | 'placa'>): string {
  return [rotuloDoTipo(v.tipo), v.modelo, v.ano, v.placa].filter(Boolean).join(' · ');
}

/**
 * Veículos — a frota e o que cada um já custou.
 *
 * Duas somas por veículo, lado a lado e nunca misturadas: **peças e serviços**,
 * que são as contas a pagar lançadas com o veículo marcado, e **combustível**,
 * que é o que quem anda com ele lança pelo portal do CPF. O combustível é
 * controle — o posto manda a fatura da semana, com desconto, e é ela que se
 * paga —, então somá-lo às contas contaria o mesmo dinheiro duas vezes.
 */
export function Veiculos() {
  const [cadastrando, setCadastrando] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['veiculos', 'todos'],
    queryFn: async () => (await api.get<VeiculoNaLista[]>('/veiculos')).data,
  });

  const veiculos = lista.data ?? [];
  const ativos = veiculos.filter((v) => v.ativo);
  const totalGasto = veiculos.reduce((s, v) => s + v.gasto, 0);
  const totalCombustivel = veiculos.reduce((s, v) => s + v.combustivel, 0);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Veículos"
        titulo="A frota"
        descricao="Quanto cada veículo já custou em peça e serviço, e quanto se abasteceu nele."
        acoes={
          <button onClick={() => setCadastrando(true)} className="btn btn-primario">
            Cadastrar veículo
          </button>
        }
      />

      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

      <ConferenciaDeAbastecimentos onAbrirVeiculo={setAbertoId} />

      {veiculos.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3">
          <Indicador
            rotulo="Veículos"
            valor={ativos.length}
            detalhe={
              veiculos.length > ativos.length
                ? `${veiculos.length - ativos.length} desligado(s)`
                : 'na frota'
            }
          />
          <Indicador
            rotulo="Peças e serviços"
            valor={formatBRL(totalGasto)}
            detalhe="contas lançadas com o veículo marcado"
            acento
          />
          <Indicador
            rotulo="Combustível"
            valor={formatBRL(totalCombustivel)}
            detalhe="abastecimentos lançados no portal"
          />
        </div>
      )}

      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando />
        ) : veiculos.length === 0 ? (
          <Vazio titulo="Nenhum veículo cadastrado">
            Cadastre as motos, os carros e as máquinas. Depois, no "Lançar conta",
            dá para marcar em qual deles foi o gasto.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Veículo</th>
                  <th className="th">Responsável</th>
                  <th className="th text-right">Peças e serviços</th>
                  <th className="th text-right">Combustível</th>
                </tr>
              </thead>
              <tbody>
                {veiculos.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setAbertoId(v.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAbertoId(v.id);
                      }
                    }}
                    title={`Abrir a ficha de ${v.apelido}`}
                    className={`linha cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${
                      v.ativo ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="td">
                      <span className="block font-display text-base font-semibold leading-tight text-tinta-900">
                        {v.apelido}
                        <span className="ml-1.5 font-sans font-normal text-tinta-300">&rsaquo;</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-tinta-400">{identificacao(v)}</span>
                      {!v.ativo && (
                        <span className="mt-1 inline-block">
                          <Selo pequeno tom="neutro">
                            desligado
                          </Selo>
                        </span>
                      )}
                    </td>
                    <td className="td text-tinta-600">
                      {v.responsavel?.nome ?? <span className="text-tinta-400">—</span>}
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <span className="valor">{formatBRL(v.gasto)}</span>
                      <span className="block text-xs text-tinta-400">
                        {v.quantidade} lançamento(s)
                        {v.emAberto > 0 && ` · ${formatBRL(v.emAberto)} em aberto`}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <span className="valor">{formatBRL(v.combustivel)}</span>
                      <span className="block text-xs text-tinta-400">
                        {v.abastecimentos} abastecimento(s)
                        {v.ultimoKm != null && ` · ${km(v.ultimoKm)}`}
                      </span>
                      {v.abastecimentosAConferir > 0 && (
                        <span className="block text-xs font-semibold text-amber-600 dark:text-amber-300">
                          {v.abastecimentosAConferir} a conferir
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {cadastrando && <FormularioDoVeiculo onFechar={() => setCadastrando(false)} />}
      {abertoId && <FichaDoVeiculo id={abertoId} onFechar={() => setAbertoId(null)} />}
    </Pagina>
  );
}

/**
 * A conferência: os abastecimentos que chegaram só com o km e a foto, de todos
 * os veículos, esperando o valor da nota.
 *
 * Fica no alto da aba, e só aparece quando há o que conferir. Nada aqui paga
 * nada: o valor é controle — o dinheiro sai pela fatura do posto.
 */
function ConferenciaDeAbastecimentos({ onAbrirVeiculo }: { onAbrirVeiculo: (id: string) => void }) {
  const fila = useQuery({
    queryKey: ['veiculos', 'a-conferir'],
    queryFn: async () =>
      (await api.get<AbastecimentoAConferir[]>('/veiculos/abastecimentos/a-conferir')).data,
  });

  const itens = fila.data ?? [];
  if (itens.length === 0) return null;

  return (
    <div className="mb-4">
      <Bloco titulo={`Conferência de abastecimentos · ${itens.length}`} semPadding>
        <p className="px-4 pt-3 text-xs text-tinta-500 sm:px-5">
          Lançados só com o km e a foto da nota. Abra a foto, leia o valor e salve — é
          controle, nada é pago por aqui.
        </p>
        <ul className="lista-dividida mt-2">
          {itens.map((a) => (
            <LinhaAConferir key={a.id} abastecimento={a} onAbrirVeiculo={onAbrirVeiculo} />
          ))}
        </ul>
      </Bloco>
    </div>
  );
}

function LinhaAConferir({
  abastecimento: a,
  onAbrirVeiculo,
}: {
  abastecimento: AbastecimentoAConferir;
  onAbrirVeiculo: (id: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onAbrirVeiculo(a.veiculo.id)}
          className="block text-left font-display text-base font-semibold text-tinta-900 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {a.veiculo.apelido}
          {a.veiculo.placa && (
            <span className="ml-1.5 text-xs font-normal text-tinta-400">{a.veiculo.placa}</span>
          )}
        </button>
        <span className="block text-sm text-tinta-700">{km(a.km)}</span>
        <span className="block text-[11px] text-tinta-400">
          {dataEHora(a.data)} · {a.lancadoPor}
        </span>
        {a.temFoto && <FotoDoAbastecimento id={a.id} />}
      </span>
      <ValorDaNota abastecimento={a} />
    </li>
  );
}

/** O campo de pôr (ou corrigir) o valor lido na nota. */
function ValorDaNota({ abastecimento }: { abastecimento: Abastecimento }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(
    abastecimento.valor != null ? abastecimento.valor.toFixed(2) : '',
  );

  const salvar = useMutation({
    mutationFn: async () => {
      await api.patch(`/veiculos/abastecimentos/${abastecimento.id}`, { valor: Number(valor) });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['veiculos'] }),
  });

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        <CampoDinheiro
          valor={valor}
          onChange={setValor}
          className="campo num w-32 py-1.5 text-right"
          placeholder="valor da nota"
        />
        <button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={!(Number(valor) > 0) || salvar.isPending}
          className="btn btn-primario btn-p"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </span>
      {salvar.isError && <span className="text-xs text-rose-600">{mensagemErro(salvar.error)}</span>}
    </span>
  );
}

function FotoDoAbastecimento({ id }: { id: string }) {
  return (
    <FotoDoPonto
      chave={['veiculos', 'abastecimento', 'foto', id]}
      buscar={async () =>
        (await api.get<{ foto: string }>(`/veiculos/abastecimentos/${id}/foto`)).data.foto
      }
    />
  );
}

const dataEHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Lançar um abastecimento pela ficha: o km, a foto e, se já estiver à mão, o valor. */
function LancarAbastecimento({
  veiculo,
  onFechar,
}: {
  veiculo: VeiculoNaLista;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [kmDigitado, setKmDigitado] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [valor, setValor] = useState('');

  const kmNumero = kmDigitado ? Number(kmDigitado) : null;
  const kmAtras = veiculo.ultimoKm != null && kmNumero != null && kmNumero < veiculo.ultimoKm;

  const lancar = useMutation({
    mutationFn: async () => {
      await api.post(`/veiculos/${veiculo.id}/abastecimentos`, {
        km: kmNumero,
        foto,
        valor: Number(valor) > 0 ? Number(valor) : undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['veiculos'] });
      onFechar();
    },
  });

  const valido = kmNumero != null && !kmAtras && !!foto;

  return (
    <Janela titulo={`Abastecimento — ${veiculo.apelido}`} onFechar={onFechar}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="abast-km-sistema">
            Km do painel
          </label>
          <input
            id="abast-km-sistema"
            value={kmDigitado}
            onChange={(e) => setKmDigitado(e.target.value.replace(/\D/g, '').slice(0, 7))}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder={veiculo.ultimoKm != null ? `último: ${veiculo.ultimoKm}` : 'só os números'}
            className="campo num"
          />
          {kmAtras && veiculo.ultimoKm != null && (
            <p className="mt-1 text-xs font-semibold text-rose-600">
              O último abastecimento foi com {km(veiculo.ultimoKm)}. Confira o painel.
            </p>
          )}
        </div>
        <div>
          <label className="rotulo" htmlFor="abast-valor-sistema">
            Valor da nota
          </label>
          <CampoDinheiro
            id="abast-valor-sistema"
            valor={valor}
            onChange={setValor}
            placeholder="opcional"
          />
          <p className="ajuda">Em branco, vai para a conferência.</p>
        </div>
      </div>
      <p className="rotulo mt-4">Foto da nota</p>
      <FotoDaNota foto={foto} onFoto={setFoto} />

      {lancar.isError && <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => lancar.mutate()}
          disabled={!valido || lancar.isPending}
          className="btn btn-primario"
        >
          {lancar.isPending ? 'Enviando…' : 'Lançar abastecimento'}
        </button>
      </div>
    </Janela>
  );
}

/**
 * A ficha de um veículo: as duas somas, o que foi para cada categoria, cada
 * conta e cada abastecimento — e os botões de lançar uma conta ou um
 * abastecimento nele.
 */
function FichaDoVeiculo({ id, onFechar }: { id: string; onFechar: () => void }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [abastecendo, setAbastecendo] = useState(false);

  const ficha = useQuery({
    queryKey: ['veiculos', 'ficha', id],
    queryFn: async () => (await api.get<Ficha>(`/veiculos/${id}`)).data,
  });

  const apagarAbastecimento = useMutation({
    mutationFn: async (abastecimentoId: string) => {
      await api.delete(`/veiculos/abastecimentos/${abastecimentoId}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['veiculos'] }),
  });

  if (lancando && ficha.data) {
    return (
      <NovaDespesa
        veiculoInicial={{ id, apelido: ficha.data.veiculo.apelido }}
        onFechar={() => setLancando(false)}
      />
    );
  }
  if (abastecendo && ficha.data) {
    return (
      <LancarAbastecimento veiculo={ficha.data.veiculo} onFechar={() => setAbastecendo(false)} />
    );
  }
  if (editando && ficha.data) {
    return (
      <FormularioDoVeiculo
        veiculo={ficha.data.veiculo}
        onFechar={() => setEditando(false)}
        onApagado={onFechar}
      />
    );
  }

  const d = ficha.data;

  return (
    <Janela titulo={d?.veiculo.apelido ?? 'Veículo'} onFechar={onFechar}>
      {ficha.isLoading ? (
        <Carregando />
      ) : ficha.isError || !d ? (
        <Aviso tom="erro">{mensagemErro(ficha.error)}</Aviso>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-tinta-500">
            {identificacao(d.veiculo)}
            {d.veiculo.responsavel && ` · com ${d.veiculo.responsavel.nome}`}
            {!d.veiculo.ativo && ' · desligado'}
          </p>

          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={() => setLancando(true)} className="btn btn-primario">
              Lançar conta neste veículo
            </button>
            {d?.veiculo.ativo && (
              <button onClick={() => setAbastecendo(true)} className="btn btn-neutro">
                Lançar abastecimento
              </button>
            )}
            <button onClick={() => setEditando(true)} className="btn btn-neutro">
              Editar
            </button>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-tinta-50 p-4">
              <p className="eyebrow">Peças e serviços</p>
              <p className="valor mt-1 text-2xl">{formatBRL(d.veiculo.gasto)}</p>
              <p className="mt-0.5 text-xs text-tinta-500">
                {d.veiculo.quantidade} conta(s)
                {d.veiculo.emAberto > 0 && ` · ${formatBRL(d.veiculo.emAberto)} ainda em aberto`}
              </p>
            </div>
            <div className="rounded-2xl bg-tinta-50 p-4">
              <p className="eyebrow">Combustível</p>
              <p className="valor mt-1 text-2xl">{formatBRL(d.combustivel.total)}</p>
              <p className="mt-0.5 text-xs text-tinta-500">
                {d.combustivel.quantidade} abastecimento(s)
                {d.combustivel.ultimoKm != null && ` · último com ${km(d.combustivel.ultimoKm)}`}
                {d.combustivel.custoPorKm != null &&
                  ` · ${formatBRL(d.combustivel.custoPorKm)} por km`}
              </p>
              {d.combustivel.aConferir > 0 && (
                <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                  {d.combustivel.aConferir} na conferência, fora do total
                </p>
              )}
            </div>
          </div>

          {d.porCategoria.length > 0 && (
            <div className="mb-5">
              <p className="eyebrow mb-2">Para onde foi</p>
              <ul className="lista-dividida rounded-xl border border-tinta-200">
                {d.porCategoria.map((c) => (
                  <li key={c.nome} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-tinta-700">{c.nome}</span>
                    <span className="valor">{formatBRL(c.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="eyebrow mb-2">Contas lançadas</p>
          {d.gastos.length === 0 ? (
            <p className="mb-5 text-sm text-tinta-400">
              Nenhuma conta ainda. Use "Lançar conta neste veículo", ou marque o veículo
              no "Lançar conta" da tela Em aberto.
            </p>
          ) : (
            <ul className="lista-dividida mb-5 rounded-xl border border-tinta-200">
              {d.gastos.map((g) => (
                <li key={g.contaId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm text-tinta-800">{g.observacao}</span>
                    <span className="block text-[11px] text-tinta-400">
                      {formatData(g.vencimento)} · {g.fornecedor}
                      {g.idFnApagarIxc ? ` · título ${g.idFnApagarIxc}` : ''}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Selo pequeno tom={g.categoria ? 'info' : 'atencao'}>
                        {g.categoria?.nome ?? 'sem categoria'}
                      </Selo>
                      <Selo
                        pequeno
                        tom={
                          g.situacao === 'paga'
                            ? 'pago'
                            : g.situacao === 'em aberto'
                              ? 'neutro'
                              : 'erro'
                        }
                      >
                        {g.situacao === 'nao enviada' ? 'não chegou ao IXC' : g.situacao}
                      </Selo>
                    </span>
                  </span>
                  <span
                    className={`valor whitespace-nowrap ${
                      g.situacao === 'cancelada' || g.situacao === 'nao enviada'
                        ? 'text-tinta-400 line-through'
                        : ''
                    }`}
                  >
                    {formatBRL(g.valor)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="eyebrow mb-2">Abastecimentos</p>
          {d.abastecimentos.length === 0 ? (
            <p className="text-sm text-tinta-400">
              Nenhum ainda. Use "Lançar abastecimento" aqui em cima
              {d.veiculo.responsavel
                ? `, ou ${d.veiculo.responsavel.nome} lança pelo portal, com o CPF.`
                : ' — ou escolha o responsável em Editar, e ele lança pelo portal, com o CPF.'}
            </p>
          ) : (
            <ul className="lista-dividida rounded-xl border border-tinta-200">
              {d.abastecimentos.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-tinta-800">
                      {km(a.km)} ·{' '}
                      {a.valor != null ? (
                        <span className="valor">{formatBRL(a.valor)}</span>
                      ) : (
                        <span className="font-semibold text-amber-600 dark:text-amber-300">
                          na conferência
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-tinta-400">
                      {dataEHora(a.data)} · {a.lancadoPor}
                      {a.conferidoPor && a.conferidoPor !== a.lancadoPor && ` · conferido por ${a.conferidoPor}`}
                    </span>
                    {a.temFoto && <FotoDoAbastecimento id={a.id} />}
                  </span>
                  <span className="flex flex-col items-end gap-2">
                    {/* Com valor, dá para corrigir; sem, é a conferência ali mesmo. */}
                    <ValorDaNota abastecimento={a} />
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Apagar o abastecimento com ${km(a.km)}?`)) {
                          apagarAbastecimento.mutate(a.id);
                        }
                      }}
                      disabled={apagarAbastecimento.isPending}
                      className="btn btn-sutil btn-p text-rose-600"
                    >
                      Apagar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {apagarAbastecimento.isError && (
            <Aviso tom="erro">{mensagemErro(apagarAbastecimento.error)}</Aviso>
          )}
        </>
      )}
    </Janela>
  );
}

/** Cadastrar um veículo, ou editar, desligar e apagar um que já existe. */
function FormularioDoVeiculo({
  veiculo,
  onFechar,
  onApagado,
}: {
  veiculo?: VeiculoNaLista;
  onFechar: () => void;
  onApagado?: () => void;
}) {
  const qc = useQueryClient();
  const [apelido, setApelido] = useState(veiculo?.apelido ?? '');
  const [tipo, setTipo] = useState<TipoVeiculo>(veiculo?.tipo ?? 'MOTO');
  const [placa, setPlaca] = useState(veiculo?.placa ?? '');
  const [modelo, setModelo] = useState(veiculo?.modelo ?? '');
  const [ano, setAno] = useState(veiculo?.ano ? String(veiculo.ano) : '');
  const [responsavelId, setResponsavelId] = useState(veiculo?.responsavel?.id ?? '');
  const [observacao, setObservacao] = useState(veiculo?.observacao ?? '');

  const responsaveis = useQuery({
    queryKey: ['veiculos', 'responsaveis'],
    queryFn: async () =>
      (
        await api.get<Array<{ id: string; nome: string; apelido: string | null }>>(
          '/veiculos/responsaveis',
        )
      ).data,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['veiculos'] });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = {
        apelido: apelido.trim(),
        tipo,
        placa: placa.trim() || (veiculo ? null : undefined),
        modelo: modelo.trim() || (veiculo ? null : undefined),
        ano: ano ? Number(ano) : veiculo ? null : undefined,
        responsavelId: responsavelId || (veiculo ? null : undefined),
        observacao: observacao.trim() || (veiculo ? null : undefined),
      };
      if (veiculo) await api.patch(`/veiculos/${veiculo.id}`, dados);
      else await api.post('/veiculos', dados);
    },
    onSuccess: () => {
      recarregar();
      onFechar();
    },
  });

  const ligar = useMutation({
    mutationFn: async (ativo: boolean) => {
      await api.patch(`/veiculos/${veiculo!.id}`, { ativo });
    },
    onSuccess: () => {
      recarregar();
      onFechar();
    },
  });

  const apagar = useMutation({
    mutationFn: async () => {
      await api.delete(`/veiculos/${veiculo!.id}`);
    },
    onSuccess: () => {
      recarregar();
      onFechar();
      onApagado?.();
    },
  });

  const valido = apelido.trim().length >= 2 && (!ano || /^\d{4}$/.test(ano));
  const erro = salvar.error ?? ligar.error ?? apagar.error;

  return (
    <Janela titulo={veiculo ? `Editar — ${veiculo.apelido}` : 'Cadastrar veículo'} onFechar={onFechar}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="vei-apelido">
            Como vocês chamam
          </label>
          <input
            id="vei-apelido"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            className="campo"
            placeholder="Moto do almoxarifado, Hilux, Trator"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-tipo">
            Tipo
          </label>
          <select
            id="vei-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoVeiculo)}
            className="campo"
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-placa">
            Placa
          </label>
          <input
            id="vei-placa"
            value={placa}
            onChange={(e) => setPlaca(e.target.value.toUpperCase().slice(0, 8))}
            className="campo num uppercase"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-modelo">
            Marca e modelo
          </label>
          <input
            id="vei-modelo"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            className="campo"
            placeholder="Honda CG 160"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-ano">
            Ano
          </label>
          <input
            id="vei-ano"
            value={ano}
            onChange={(e) => setAno(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="campo num"
            inputMode="numeric"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="vei-responsavel">
            Responsável (quem abastece)
          </label>
          <select
            id="vei-responsavel"
            value={responsavelId}
            onChange={(e) => setResponsavelId(e.target.value)}
            className="campo"
            disabled={responsaveis.isLoading}
          >
            <option value="">Ninguém</option>
            {(responsaveis.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.apelido ? `${f.apelido} (${f.nome})` : f.nome}
              </option>
            ))}
          </select>
          <p className="ajuda">
            Ele entra no portal da pontuação com o CPF e lança o abastecimento deste
            veículo, com o km e a foto da nota.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="vei-obs">
            Observação
          </label>
          <input
            id="vei-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>
      </div>

      {erro && <Aviso tom="erro">{mensagemErro(erro)}</Aviso>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {veiculo && (
          <span className="mr-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => ligar.mutate(!veiculo.ativo)}
              disabled={ligar.isPending}
              className="btn btn-sutil btn-p"
              title={
                veiculo.ativo
                  ? 'Vendido ou parado: sai da escolha no lançamento, o histórico fica'
                  : 'Volta para a escolha no lançamento'
              }
            >
              {veiculo.ativo ? 'Desligar' : 'Religar'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Apagar ${veiculo.apelido}? Só dá se ele não tiver nenhum gasto.`)) {
                  apagar.mutate();
                }
              }}
              disabled={apagar.isPending}
              className="btn btn-sutil btn-p text-rose-600"
            >
              Apagar
            </button>
          </span>
        )}
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={!valido || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : veiculo ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </Janela>
  );
}
