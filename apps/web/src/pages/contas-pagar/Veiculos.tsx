import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FotoDoPonto } from '../../components/PainelDePontos';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
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
  ultimoKm: number | null;
}

interface Abastecimento {
  id: string;
  valor: number;
  km: number;
  data: string;
  lancadoPor: string;
  temFoto: boolean;
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
 * A ficha de um veículo: as duas somas, o que foi para cada categoria, cada
 * conta e cada abastecimento — e o botão de lançar uma conta nele.
 */
function FichaDoVeiculo({ id, onFechar }: { id: string; onFechar: () => void }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [lancando, setLancando] = useState(false);

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
              {d.veiculo.responsavel
                ? `Nenhum ainda. ${d.veiculo.responsavel.nome} lança pelo portal, com o CPF.`
                : 'Nenhum ainda. Escolha o responsável em Editar: é ele quem lança pelo portal, com o CPF.'}
            </p>
          ) : (
            <ul className="lista-dividida rounded-xl border border-tinta-200">
              {d.abastecimentos.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-tinta-800">
                      <span className="valor">{formatBRL(a.valor)}</span> · {km(a.km)}
                    </span>
                    <span className="block text-[11px] text-tinta-400">
                      {new Date(a.data).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}{' '}
                      · {a.lancadoPor}
                    </span>
                    {a.temFoto && (
                      <FotoDoPonto
                        chave={['veiculos', 'abastecimento', 'foto', a.id]}
                        buscar={async () =>
                          (await api.get<{ foto: string }>(`/veiculos/abastecimentos/${a.id}/foto`))
                            .data.foto
                        }
                      />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Apagar o abastecimento de ${formatBRL(a.valor)} com ${km(a.km)}?`)) {
                        apagarAbastecimento.mutate(a.id);
                      }
                    }}
                    disabled={apagarAbastecimento.isPending}
                    className="btn btn-sutil btn-p text-rose-600"
                  >
                    Apagar
                  </button>
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
