import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
  type Tom,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type {
  FilaDeFerias,
  LeituraDaPrevisao,
  PessoaNaFila,
  SituacaoFerias,
} from '../../lib/types';

const TOM_DA_SITUACAO: Record<SituacaoFerias, Tom> = {
  VENCIDA: 'erro',
  LIBERADA: 'pago',
  AGUARDANDO: 'neutro',
};

const ROTULO_DA_SITUACAO: Record<SituacaoFerias, string> = {
  VENCIDA: 'prazo vencido',
  LIBERADA: 'pode sair',
  AGUARDANDO: 'juntando os 12 meses',
};

/** "72 dias", "1 dia", "venceu há 3 dias". */
function contagem(dias: number): string {
  if (dias < 0) {
    const passados = Math.abs(dias);
    return `venceu há ${passados} dia${passados === 1 ? '' : 's'}`;
  }
  if (dias === 0) return 'vence hoje';
  return `${dias} dia${dias === 1 ? '' : 's'}`;
}

/** Os mesmos dias em meses, do jeito que o relatório escreve: "(2,6)". */
function emMeses(dias: number): string {
  return (dias / 30).toFixed(1).replace('.', ',');
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-08-13" mais N dias. */
function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Último dia de férias: o primeiro dia já conta. */
function fimDasFerias(inicio: string, dias: number): string {
  return somarDias(inicio, Math.max(dias, 1) - 1);
}

/**
 * Férias: quem é o próximo da fila.
 *
 * A ordem não é escolhida aqui — é a data limite que manda. Ela é o último dia
 * em que as férias podem começar sem a empresa pagar em dobro (art. 137 da
 * CLT), e é o que a contabilidade calcula no relatório que manda todo mês.
 * Este app relê o PDF, reconta os dias para hoje e diz quem pode sair agora.
 */
export function Ferias() {
  const qc = useQueryClient();
  const [leitura, setLeitura] = useState<LeituraDaPrevisao | null>(null);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState(false);
  const [mandando, setMandando] = useState<PessoaNaFila | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const fila = useQuery({
    queryKey: ['ferias-fila'],
    queryFn: async () => (await api.get<FilaDeFerias>('/ferias/fila')).data,
  });

  function avisar(texto: string, ruim = false) {
    setFeedback(texto);
    setErro(ruim);
  }

  function limparArquivo() {
    setLeitura(null);
    if (inputArquivo.current) inputArquivo.current.value = '';
  }

  const ler = useMutation({
    mutationFn: async (arquivo: File) => {
      const form = new FormData();
      form.append('arquivo', arquivo);
      const { data } = await api.post<LeituraDaPrevisao>(
        '/ferias/previsoes/ler',
        form,
      );
      return data;
    },
    onSuccess: (data) => {
      setLeitura(data);
      avisar('');
    },
    onError: (err) => {
      limparArquivo();
      avisar(mensagemErro(err), true);
    },
  });

  const gravar = useMutation({
    mutationFn: async () => {
      if (!leitura) throw new Error('Nada para gravar');
      const { data } = await api.post('/ferias/previsoes', {
        ...leitura.previsao,
        arquivoNome: leitura.arquivoNome,
      });
      return data;
    },
    onSuccess: () => {
      avisar('Previsão atualizada — a fila agora é a deste relatório.');
      limparArquivo();
      qc.invalidateQueries({ queryKey: ['ferias-fila'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const marcar = useMutation({
    mutationFn: async (corpo: {
      itemId: string;
      inicio: string;
      dias: number;
      observacao?: string;
    }) => (await api.post('/ferias/marcadas', corpo)).data,
    onSuccess: () => {
      avisar(`${mandando?.nome ?? 'Pessoa'} foi mandado(a) para férias.`);
      setMandando(null);
      qc.invalidateQueries({ queryKey: ['ferias-fila'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const desmarcar = useMutation({
    mutationFn: async (id: string) => api.delete(`/ferias/marcadas/${id}`),
    onSuccess: () => {
      avisar('Férias desfeitas — a pessoa voltou para a fila.');
      qc.invalidateQueries({ queryKey: ['ferias-fila'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const dados = fila.data;
  const proximo = dados?.fila[0] ?? null;
  const podemSair = dados?.fila.filter((p) => p.situacao !== 'AGUARDANDO') ?? [];
  const vencidos = dados?.fila.filter((p) => p.situacao === 'VENCIDA') ?? [];
  const deFeriasAgora = dados?.marcadas.filter((p) => p.ferias?.emCurso) ?? [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Férias"
        titulo="Quem é o próximo"
        descricao="A fila sai da “Previsão de Férias” que a contabilidade manda todo mês: jogue o PDF aqui e a ordem se refaz sozinha. Quem aparece primeiro é quem tem menos prazo até a data limite — o último dia em que as férias podem começar sem a empresa pagar em dobro."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      {vencidos.length > 0 && (
        <Aviso tom="erro">
          {vencidos.length === 1
            ? `${vencidos[0].nome} passou da data limite`
            : `${vencidos.length} pessoas passaram da data limite`}{' '}
          — férias concedidas depois dela são pagas em dobro (art. 137 da CLT).
        </Aviso>
      )}

      {fila.isLoading ? (
        <Bloco>
          <Carregando />
        </Bloco>
      ) : !dados?.previsao ? (
        <Bloco className="surgir">
          <Vazio titulo="Nenhuma previsão enviada ainda">
            Suba o PDF “Previsão de Férias” da contabilidade no bloco abaixo e a
            fila aparece aqui, na ordem de quem tem menos prazo.
          </Vazio>
        </Bloco>
      ) : (
        <>
          {proximo && (
            <ProximoDaFila
              pessoa={proximo}
              quantosPodem={podemSair.length}
              onMandar={() => setMandando(proximo)}
            />
          )}

          <Bloco
            titulo="A fila inteira"
            className="surgir surgir-2 mt-6"
            acao={
              <span className="text-xs text-tinta-400">
                previsão de {formatData(dados.previsao.dataRelatorio)}
                {dados.previsao.diasDesdeORelatorio > 45 &&
                  ' — vale pedir a nova à contabilidade'}
              </span>
            }
            semPadding
          >
            {dados.fila.length === 0 ? (
              <Vazio titulo="Todo mundo desta previsão já foi mandado para férias">
                Quando a contabilidade mandar o relatório novo, a fila se refaz.
              </Vazio>
            ) : (
              <TabelaDaFila
                pessoas={dados.fila}
                onMandar={(p) => setMandando(p)}
              />
            )}
          </Bloco>

          {dados.marcadas.length > 0 && (
            <Bloco
              titulo={
                deFeriasAgora.length > 0
                  ? `De férias agora: ${deFeriasAgora.map((p) => primeiroNome(p.nome)).join(', ')}`
                  : 'Férias já marcadas'
              }
              className="surgir surgir-3 mt-6"
              semPadding
            >
              <TabelaDeMarcadas
                pessoas={dados.marcadas}
                onDesfazer={(p) => {
                  if (
                    p.ferias &&
                    confirm(
                      `Desfazer as férias de ${p.nome}?\n\nEla(e) volta para a fila, com o mesmo prazo de antes.`,
                    )
                  ) {
                    desmarcar.mutate(p.ferias.id);
                  }
                }}
              />
            </Bloco>
          )}
        </>
      )}

      <Bloco
        titulo="Atualizar a previsão"
        className="surgir surgir-3 mt-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputArquivo}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) ler.mutate(arquivo);
            }}
            className="block w-full max-w-md text-sm text-tinta-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
          />
          {ler.isPending && (
            <span className="text-sm text-tinta-400">Lendo o PDF…</span>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-tinta-500">
          É o mesmo arquivo que a contabilidade manda todo mês (“Férias
          Previstas”). Precisa ser o PDF original: se for digitalizado — uma foto
          dentro do arquivo —, não há texto para ler. Quem já foi mandado para
          férias continua marcado; o relatório novo só refaz os prazos.
        </p>
      </Bloco>

      {leitura && (
        <Bloco titulo="Confira antes de trocar a fila" className="surgir mt-6">
          {leitura.divergencia && (
            <Aviso tom="atencao">
              {leitura.divergencia} Confira a lista abaixo antes de gravar —
              pode ter escapado alguém.
            </Aviso>
          )}
          {leitura.jaExiste && (
            <Aviso tom="atencao">
              Já existe uma previsão desse mesmo dia ({leitura.jaExiste.itens}{' '}
              pessoas, de “{leitura.jaExiste.arquivoNome}”). Gravar substitui a
              anterior.
            </Aviso>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Leitura
              rotulo="Relatório de"
              valor={formatData(leitura.previsao.dataRelatorio)}
              forte
            />
            <Leitura
              rotulo="Empregados"
              valor={String(leitura.previsao.itens.length)}
              forte
            />
            <Leitura rotulo="Empresa" valor={leitura.previsao.empresa ?? '—'} />
            <Leitura
              rotulo="Meses limite"
              valor={
                leitura.previsao.mesesLimite
                  ? String(leitura.previsao.mesesLimite)
                  : '—'
              }
            />
          </div>

          <div className="mt-5 max-h-96 overflow-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-papel">
                <tr className="border-y border-tinta-100">
                  <th className="th">Empregado</th>
                  <th className="th">Admissão</th>
                  <th className="th">Período aquisitivo</th>
                  <th className="th">Data limite</th>
                  <th className="th text-right">Dias</th>
                </tr>
              </thead>
              <tbody>
                {leitura.previsao.itens.map((item) => (
                  <tr key={`${item.codigo}-${item.ordem}`} className="linha">
                    <td className="td">
                      <div className="font-medium text-tinta-800">
                        {item.nome}
                      </div>
                      <div className="text-xs text-tinta-400">
                        {item.codigo}
                        {item.cargo ? ` · ${item.cargo}` : ''}
                      </div>
                    </td>
                    <td className="td num text-tinta-500">
                      {formatData(item.admissao)}
                    </td>
                    <td className="td num text-tinta-500">
                      {formatData(item.periodoInicio)} a{' '}
                      {formatData(item.periodoFim)}
                    </td>
                    <td className="td num font-medium text-tinta-800">
                      {formatData(item.dataLimite)}
                    </td>
                    <td className="td num text-right text-tinta-500">
                      {item.diasDireito}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
            <button
              onClick={() => gravar.mutate()}
              disabled={gravar.isPending}
              className="btn btn-primario"
            >
              {gravar.isPending ? 'Gravando…' : 'Confirmar e atualizar a fila'}
            </button>
            <button onClick={limparArquivo} className="btn btn-neutro">
              Cancelar
            </button>
          </div>
        </Bloco>
      )}

      {mandando && (
        <JanelaMandarParaFerias
          pessoa={mandando}
          ocupado={marcar.isPending}
          onFechar={() => setMandando(null)}
          onConfirmar={(dados) => marcar.mutate({ itemId: mandando.itemId, ...dados })}
        />
      )}
    </Pagina>
  );
}

/**
 * O cartão do topo. A pergunta que traz alguém a esta tela é "quem é o
 * próximo?", e a resposta merece caber num olhar — nome, quanto prazo resta e o
 * botão que resolve.
 */
function ProximoDaFila({
  pessoa,
  quantosPodem,
  onMandar,
}: {
  pessoa: PessoaNaFila;
  quantosPodem: number;
  onMandar: () => void;
}) {
  const vencida = pessoa.situacao === 'VENCIDA';
  const pode = pessoa.situacao !== 'AGUARDANDO';

  return (
    <section className="surgir card relative overflow-hidden p-6 sm:p-7">
      <span
        className={`absolute inset-x-0 top-0 h-1 ${
          vencida
            ? 'bg-rose-500'
            : pode
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
              : 'bg-gradient-to-r from-brand-500 to-brand-300'
        }`}
      />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow">O próximo da fila</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-tinta-900">
            {pessoa.funcionarioId ? (
              <Link
                to={`/folha/funcionarios/${pessoa.funcionarioId}`}
                className="hover:text-brand-700 hover:underline"
              >
                {pessoa.nome}
              </Link>
            ) : (
              pessoa.nome
            )}
          </h2>
          <p className="mt-1 text-sm text-tinta-500">
            {pessoa.cargo ?? 'Sem cargo no relatório'} · matrícula{' '}
            <span className="num">{pessoa.codigo}</span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Selo tom={TOM_DA_SITUACAO[pessoa.situacao]} ponto>
              {ROTULO_DA_SITUACAO[pessoa.situacao]}
            </Selo>
            {!pode && (
              <span className="text-xs text-tinta-500">
                completa 12 meses em {formatData(pessoa.periodoFim)} — daqui a{' '}
                {contagem(pessoa.diasParaLiberar)}
              </span>
            )}
          </div>

          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="rotulo">Período aquisitivo</dt>
              <dd className="num text-tinta-700">
                {formatData(pessoa.periodoInicio)} a{' '}
                {formatData(pessoa.periodoFim)}
              </dd>
            </div>
            <div>
              <dt className="rotulo">Data limite</dt>
              <dd className="num font-medium text-tinta-800">
                {formatData(pessoa.dataLimite)}
              </dd>
            </div>
            <div>
              <dt className="rotulo">Dias de direito</dt>
              <dd className="num text-tinta-700">{pessoa.diasDireito}</dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="sm:text-right">
            <p className="eyebrow">
              {pessoa.diasAteLimite < 0 ? 'Passou do limite' : 'Falta para o limite'}
            </p>
            <p
              className={`mt-1 font-display text-[44px] font-semibold leading-none tracking-tight num ${
                vencida
                  ? 'text-rose-600'
                  : pessoa.diasAteLimite <= 60
                    ? 'text-amber-600'
                    : 'text-tinta-900'
              }`}
            >
              {Math.abs(pessoa.diasAteLimite)}
            </p>
            <p className="mt-1 text-xs text-tinta-400">
              dia(s) · {emMeses(Math.abs(pessoa.diasAteLimite))} mês(es)
            </p>
          </div>
          <button
            onClick={onMandar}
            disabled={!pode}
            title={
              pode
                ? 'Registra que essa pessoa saiu de férias'
                : 'Só depois de completar o período aquisitivo'
            }
            className="btn btn-primario"
          >
            Mandar para férias
          </button>
          {quantosPodem > 1 && (
            <p className="text-xs text-tinta-400">
              {quantosPodem} pessoas já podem sair
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TabelaDaFila({
  pessoas,
  onMandar,
}: {
  pessoas: PessoaNaFila[];
  onMandar: (p: PessoaNaFila) => void;
}) {
  return (
    <div className="overflow-x-auto rolagem-fina">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-t border-tinta-200">
            <th className="th w-10">#</th>
            <th className="th">Empregado</th>
            <th className="th">Período aquisitivo</th>
            <th className="th">Data limite</th>
            <th className="th text-right">Faltam</th>
            <th className="th">Situação</th>
            <th className="th text-right">Ação</th>
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p, i) => (
            <tr key={p.itemId} className="linha">
              <td className="td num text-tinta-400">{i + 1}</td>
              <td className="td">
                <div className="font-medium text-tinta-800">
                  {p.funcionarioId ? (
                    <Link
                      to={`/folha/funcionarios/${p.funcionarioId}`}
                      className="hover:text-brand-700 hover:underline"
                    >
                      {p.nome}
                    </Link>
                  ) : (
                    p.nome
                  )}
                </div>
                <div className="text-xs text-tinta-400">
                  {p.cargo ?? `matrícula ${p.codigo}`}
                </div>
              </td>
              <td className="td num text-tinta-500">
                {formatData(p.periodoInicio)} a {formatData(p.periodoFim)}
              </td>
              <td className="td num font-medium text-tinta-800">
                {formatData(p.dataLimite)}
              </td>
              <td
                className={`td num text-right ${
                  p.diasAteLimite < 0
                    ? 'font-semibold text-rose-600'
                    : p.diasAteLimite <= 60
                      ? 'font-semibold text-amber-600'
                      : 'text-tinta-600'
                }`}
              >
                {contagem(p.diasAteLimite)}
              </td>
              <td className="td">
                <Selo pequeno tom={TOM_DA_SITUACAO[p.situacao]}>
                  {p.situacao === 'AGUARDANDO'
                    ? `sai em ${contagem(p.diasParaLiberar)}`
                    : ROTULO_DA_SITUACAO[p.situacao]}
                </Selo>
              </td>
              <td className="td text-right">
                <button
                  onClick={() => onMandar(p)}
                  disabled={p.situacao === 'AGUARDANDO'}
                  className="btn btn-neutro btn-p"
                  title={
                    p.situacao === 'AGUARDANDO'
                      ? `Só a partir de ${formatData(p.periodoFim)}`
                      : 'Registra que essa pessoa saiu de férias'
                  }
                >
                  Mandar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDeMarcadas({
  pessoas,
  onDesfazer,
}: {
  pessoas: PessoaNaFila[];
  onDesfazer: (p: PessoaNaFila) => void;
}) {
  return (
    <div className="overflow-x-auto rolagem-fina">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-t border-tinta-200">
            <th className="th">Empregado</th>
            <th className="th">Saída</th>
            <th className="th">Último dia</th>
            <th className="th text-right">Dias</th>
            <th className="th">Situação</th>
            <th className="th text-right">Ação</th>
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => (
            <tr key={p.itemId} className="linha">
              <td className="td">
                <div className="font-medium text-tinta-800">{p.nome}</div>
                <div className="text-xs text-tinta-400">
                  {p.ferias?.observacao ?? p.cargo ?? ''}
                </div>
              </td>
              <td className="td num text-tinta-600">
                {formatData(p.ferias?.inicio)}
              </td>
              <td className="td num text-tinta-600">
                {formatData(p.ferias?.fim)}
                {p.ferias && (
                  <div className="text-xs text-tinta-400">
                    volta {formatData(somarDias(p.ferias.fim.slice(0, 10), 1))}
                  </div>
                )}
              </td>
              <td className="td num text-right text-tinta-500">
                {p.ferias?.dias}
              </td>
              <td className="td">
                {p.ferias?.emCurso ? (
                  <Selo pequeno tom="info" ponto>
                    de férias agora
                  </Selo>
                ) : (
                  <Selo pequeno tom="neutro">
                    marcadas
                  </Selo>
                )}
              </td>
              <td className="td text-right">
                <button
                  onClick={() => onDesfazer(p)}
                  className="btn btn-perigo btn-p"
                >
                  Desfazer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mandar alguém para férias. Registra quem saiu e até quando — o pagamento das
 * férias continua sendo da contabilidade, e é isso que a janela diz, para
 * ninguém sair daqui achando que alguma coisa foi paga.
 */
function JanelaMandarParaFerias({
  pessoa,
  ocupado,
  onFechar,
  onConfirmar,
}: {
  pessoa: PessoaNaFila;
  ocupado: boolean;
  onFechar: () => void;
  onConfirmar: (dados: {
    inicio: string;
    dias: number;
    observacao?: string;
  }) => void;
}) {
  const [inicio, setInicio] = useState(hojeISO());
  const [dias, setDias] = useState(Math.round(pessoa.diasDireito) || 30);
  const [observacao, setObservacao] = useState('');

  const fim = fimDasFerias(inicio, dias);
  const depoisDoLimite = inicio > pessoa.dataLimite.slice(0, 10);
  const valido = !!inicio && dias >= 1 && dias <= 30;

  return (
    <Janela titulo={`Mandar ${pessoa.nome} para férias`} onFechar={onFechar}>
      <p className="text-sm text-tinta-500">
        Fica registrado aqui quem está fora e até quando. O pagamento das férias
        (e o terço constitucional) continua saindo pela contabilidade — esta tela
        não paga nada.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="rotulo">Primeiro dia de férias</label>
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo">Dias</label>
          <input
            type="number"
            min={1}
            max={30}
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo">Último dia</label>
          <div className="campo bg-tinta-50 num text-tinta-700">
            {fim ? formatData(fim) : '—'}
          </div>
        </div>
        <div className="sm:col-span-3">
          <label className="rotulo">Observação</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder="Ex.: vendeu 10 dias, combinado com o setor"
            autoComplete="off"
          />
        </div>
      </div>

      {dias < 30 && (
        <Aviso tom="atencao">
          Menos de 30 dias: o restante continua devido do mesmo período
          aquisitivo, e o app vai tirar essa pessoa da fila mesmo assim. Anote na
          observação o que ficou combinado.
        </Aviso>
      )}
      {depoisDoLimite && (
        <Aviso tom="erro">
          Este início passa da data limite ({formatData(pessoa.dataLimite)}):
          férias começadas depois dela são pagas em dobro.
        </Aviso>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-tinta-100 pt-4">
        <button
          onClick={() =>
            onConfirmar({
              inicio,
              dias,
              observacao: observacao.trim() || undefined,
            })
          }
          disabled={!valido || ocupado}
          className="btn btn-primario"
        >
          {ocupado ? 'Registrando…' : 'Confirmar as férias'}
        </button>
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <span className="text-sm text-tinta-500">
          Volta ao trabalho em{' '}
          <strong className="num">
            {fim ? formatData(somarDias(fim, 1)) : '—'}
          </strong>
        </span>
      </div>
    </Janela>
  );
}

function Leitura({
  rotulo,
  valor,
  forte,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
}) {
  return (
    <div>
      <div className="rotulo">{rotulo}</div>
      <div
        className={
          forte
            ? 'font-display text-lg font-semibold num text-tinta-800'
            : 'num text-sm text-tinta-700'
        }
      >
        {valor}
      </div>
    </div>
  );
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0];
}
