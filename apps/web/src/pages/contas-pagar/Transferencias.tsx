import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { IconeCadeado } from '../../components/icones';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { CaixaIxc, TransferenciaEntreContas } from '../../lib/types';

/** Hoje, em "AAAA-MM-DD". */
function diaDeHoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * As formas que a tela do IXC oferece, na mesma ordem.
 *
 * Aqui elas entram no histórico, e não numa coluna própria: a coluna de tipo da
 * movimentação financeira não está documentada no webservice, e escrever a
 * esmo num campo do financeiro real não se faz.
 */
const FORMAS = [
  'Dinheiro',
  'Pix',
  'Depósito',
  'Transferência',
  'Cheque',
  'Cartão de Débito',
  'Cartão de Crédito',
];

/**
 * Transferência entre contas.
 *
 * Sai 1.500 do caixa do Werick e entra no caixa do Aurélio, ou vai para a
 * Sicoob: o dinheiro não some nem aparece, muda de lugar. Sem registrar, o
 * caixa de origem fecha sobrando e o de destino faltando — pelo mesmo valor, e
 * sem nada ligando os dois.
 *
 * A tela abre com senha. Não porque a senha esconda algo de quem já entrou —
 * quem fecha a porta é o perfil ADMIN, no servidor —, mas porque esta é a única
 * tela que move saldo entre contas sem haver nota nenhuma para conferir depois,
 * e uma sessão deixada aberta na mesa não deveria bastar.
 */
export function Transferencias() {
  const [destravado, setDestravado] = useState(false);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Transferência entre Contas"
        titulo="Mover dinheiro de uma conta para outra"
        descricao="O que sai de um caixa entra no outro, e o lançamento é feito no IXC nas duas pontas — é o que faz os dois fecharem."
      />

      {destravado ? (
        <Transferir />
      ) : (
        <Destravar onDestravado={() => setDestravado(true)} />
      )}
    </Pagina>
  );
}

/** A senha da própria pessoa, conferida no servidor. */
function Destravar({ onDestravado }: { onDestravado: () => void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const destravar = useMutation({
    mutationFn: async () => api.post('/transferencias/destravar', { senha }),
    onSuccess: () => {
      setSenha('');
      setErro(null);
      onDestravado();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <Bloco titulo="Tela trancada" className="surgir">
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <IconeCadeado className="h-10 w-10 text-tinta-400" />
        <p className="max-w-md text-sm text-tinta-500">
          Esta tela move dinheiro entre contas e escreve no IXC. Confirme sua
          senha para abrir — a mesma com que você entrou no sistema.
        </p>
        <form
          className="flex w-full max-w-xs flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (senha) destravar.mutate();
          }}
        >
          <label className="rotulo self-start" htmlFor="senha-transferencia">
            Sua senha
          </label>
          <input
            id="senha-transferencia"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="campo"
            placeholder="••••••••"
          />
          <button
            type="submit"
            disabled={!senha || destravar.isPending}
            className="btn btn-primario"
          >
            {destravar.isPending ? 'Conferindo…' : 'Abrir'}
          </button>
        </form>
        {erro && <p className="text-sm text-rose-600">{erro}</p>}
      </div>
    </Bloco>
  );
}

function Transferir() {
  const qc = useQueryClient();
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(diaDeHoje);
  const [forma, setForma] = useState('Dinheiro');
  const [historico, setHistorico] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [feita, setFeita] = useState<TransferenciaEntreContas | null>(null);

  const contas = useQuery({
    queryKey: ['transferencias', 'contas'],
    queryFn: async () =>
      (
        await api.get<{ tabela: string | null; contas: CaixaIxc[] }>(
          '/transferencias/contas',
        )
      ).data,
  });

  const historicoLista = useQuery({
    queryKey: ['transferencias', 'lista'],
    queryFn: async () =>
      (await api.get<TransferenciaEntreContas[]>('/transferencias')).data,
  });

  const transferir = useMutation({
    mutationFn: async () =>
      (
        await api.post<TransferenciaEntreContas>('/transferencias', {
          origemId: Number(origemId),
          destinoId: Number(destinoId),
          valor: Number(valor),
          data,
          forma,
          historico: historico.trim() || undefined,
        })
      ).data,
    onSuccess: (t) => {
      setValor('');
      setHistorico('');
      setErro(null);
      setFeita(t);
      void qc.invalidateQueries({ queryKey: ['transferencias', 'lista'] });
      // O extrato do caixa muda nas duas pontas: as linhas novas são do IXC, e
      // é de lá que aquela tela lê.
      void qc.invalidateQueries({ queryKey: ['caixa', 'extrato'] });
    },
    onError: (e) => {
      setFeita(null);
      setErro(mensagemErro(e));
    },
  });

  const quanto = Number(valor) || 0;
  const falta =
    !origemId || !destinoId
      ? 'Escolha a conta de origem e a de destino.'
      : origemId === destinoId
        ? 'A origem e o destino são a mesma conta.'
        : quanto <= 0
          ? 'Informe o valor.'
          : !data
            ? 'Informe a data.'
            : null;

  const nomeDa = (id: string) =>
    contas.data?.contas.find((c) => String(c.id) === id)?.nome ?? '';

  if (contas.isLoading) return <Carregando texto="Lendo as contas no IXC…" />;
  if (contas.isError) return <Aviso tom="erro">{mensagemErro(contas.error)}</Aviso>;

  return (
    <>
      <Bloco titulo="Nova transferência" className="surgir mb-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="origem">
              De qual conta sai
            </label>
            <select
              id="origem"
              className="campo"
              value={origemId}
              onChange={(e) => setOrigemId(e.target.value)}
            >
              <option value="">Escolha a conta</option>
              {(contas.data?.contas ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="destino">
              Para qual conta vai
            </label>
            <select
              id="destino"
              className="campo"
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
            >
              <option value="">Escolha a conta</option>
              {(contas.data?.contas ?? [])
                // A mesma conta dos dois lados não é transferência: é ruído na
                // lista, e o servidor recusaria de todo jeito.
                .filter((c) => String(c.id) !== origemId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="rotulo">Valor</label>
            <CampoDinheiro valor={valor} onChange={setValor} />
          </div>
          <div>
            <label className="rotulo" htmlFor="data-transferencia">
              Dia em que o dinheiro mudou de lugar
            </label>
            <input
              id="data-transferencia"
              type="date"
              className="campo"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
            <p className="ajuda">
              Pode ser uma data já passada — é ela que decide em que período do
              caixa a transferência cai.
            </p>
          </div>
          <div>
            <label className="rotulo" htmlFor="forma">
              Como foi
            </label>
            <select
              id="forma"
              className="campo"
              value={forma}
              onChange={(e) => setForma(e.target.value)}
            >
              {FORMAS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="historico">
              Histórico
            </label>
            <input
              id="historico"
              className="campo"
              value={historico}
              onChange={(e) => setHistorico(e.target.value)}
              placeholder={
                origemId && destinoId
                  ? `Transferência de ${nomeDa(origemId)} para ${nomeDa(destinoId)} (${forma})`
                  : 'opcional — o que aparece no lançamento no IXC'
              }
              autoComplete="off"
            />
            <p className="ajuda">
              Vazio, ele se escreve sozinho com as contas e a forma.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => transferir.mutate()}
            disabled={!!falta || transferir.isPending}
            className="btn btn-acao"
            title={falta ?? 'Lança a saída e a entrada no IXC'}
          >
            {transferir.isPending ? 'Lançando no IXC…' : 'Transferir'}
          </button>
          {falta ? (
            <span className="text-sm text-amber-600">{falta}</span>
          ) : (
            <span className="text-sm text-tinta-500">
              Saem <span className="valor">{formatBRL(quanto)}</span> de{' '}
              <strong>{nomeDa(origemId)}</strong> e entram em{' '}
              <strong>{nomeDa(destinoId)}</strong>.
            </span>
          )}
        </div>

        {erro && (
          <div className="mt-3">
            <Aviso tom="erro">{erro}</Aviso>
          </div>
        )}

        {feita && (
          <div className="mt-3">
            <Aviso tom="pago">
              Transferidos {formatBRL(Number(feita.valor))} de{' '}
              <strong>{feita.origemNome}</strong> para{' '}
              <strong>{feita.destinoNome}</strong>. No IXC: saída{' '}
              <span className="valor">#{feita.idMovimOrigem}</span> e entrada{' '}
              <span className="valor">#{feita.idMovimDestino}</span>.
            </Aviso>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Transferências feitas por aqui" className="surgir">
        {historicoLista.isLoading && <Carregando texto="Lendo…" />}
        {historicoLista.data?.length === 0 && (
          <Vazio titulo="Nenhuma ainda">
            O que for transferido por esta tela aparece aqui, com o número dos
            dois lançamentos no IXC.
          </Vazio>
        )}
        {!!historicoLista.data?.length && (
          <ul className="lista-dividida">
            {historicoLista.data.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="valor">{formatBRL(Number(t.valor))}</span>{' '}
                  <span className="text-tinta-800">
                    {t.origemNome} → {t.destinoNome}
                  </span>
                  <span className="ml-2 text-xs text-tinta-400">
                    {formatData(t.data)}
                    {t.forma ? ` · ${t.forma}` : ''}
                  </span>
                  <div className="text-xs text-tinta-400">{t.historico}</div>
                </div>
                {/* Uma perna sem a outra é dinheiro que sumiu de uma conta sem
                    aparecer na outra: o estado que mais precisa ser visto. */}
                {t.idMovimOrigem && t.idMovimDestino ? (
                  <span className="shrink-0 text-xs text-tinta-400">
                    IXC #{t.idMovimOrigem} / #{t.idMovimDestino}
                  </span>
                ) : (
                  <Selo tom="erro">
                    Só a saída foi lançada (#{t.idMovimOrigem}) — a entrada
                    falta no IXC
                  </Selo>
                )}
              </li>
            ))}
          </ul>
        )}
      </Bloco>
    </>
  );
}
