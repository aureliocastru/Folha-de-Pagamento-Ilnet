import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Janela,
  Pagina,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { MesDeNotas, NotaFiscal } from '../../lib/types';
import { lerComoDataUrl, motivoDoBlob, nomeDeArquivo } from './Pasta';

/**
 * Notas fiscais de entrada — o que a casa comprou no mês.
 *
 * O que esta tela substitui é uma pasta no computador de alguém. As notas
 * chegam o mês inteiro, por e-mail e no balcão, e no fim do mês vão para a
 * contabilidade para virar crédito de imposto. Enquanto o monte mora numa pasta
 * do Windows, duas perguntas ficam sem resposta: **quanto** foi mandado, e se a
 * nota que chegou dia 3 ainda está lá em dezembro, quando o contador pergunta.
 *
 * Por isso a lista soma. Guardar o arquivo, a estante já fazia — o que faltava
 * era o total do mês ao lado do monte, que é o número que se confere com quem
 * recebe. E é por isso que o botão que importa aqui é o de baixar o mês inteiro
 * num zip: é ele que sai da casa.
 *
 * A nota é o arquivo mais o valor, e os dois andam juntos: apagar a nota leva o
 * papel, e apagar o papel pela estante leva o valor. Um total somado sobre
 * linha sem nota atrás mentiria justamente para quem confere.
 */
export function NotasFiscais() {
  const qc = useQueryClient();
  /** null = a lista de meses; "AAAA-MM" = dentro daquele mês. */
  const [mes, setMes] = useState<string | null>(null);
  const [lancando, setLancando] = useState(false);
  const [editando, setEditando] = useState<NotaFiscal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  const meses = useQuery({
    queryKey: ['rh', 'notas-fiscais'],
    queryFn: async () => (await api.get<MesDeNotas[]>('/rh/notas-fiscais')).data,
  });

  const notas = useQuery({
    queryKey: ['rh', 'notas-fiscais', mes],
    queryFn: async () =>
      (await api.get<NotaFiscal[]>(`/rh/notas-fiscais/${mes}`)).data,
    enabled: mes !== null,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['rh', 'notas-fiscais'] });
    // A estante mudou junto: a pasta do mês nasceu, ou o papel saiu dela.
    void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'documentos'] });
  }

  const apagar = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/rh/notas-fiscais/${id}`)).data,
    onSuccess: recarregar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  /**
   * Baixa o mês inteiro num zip.
   *
   * Vai pela API autenticada, e não por um `href` direto: o token vive no
   * cabeçalho, e um link aberto na mão chegaria lá sem ele. O erro do servidor
   * chega como blob, e por isso é lido como texto antes de virar aviso.
   */
  async function baixarMes(m: MesDeNotas) {
    setBaixando(true);
    setErro(null);
    try {
      const resposta = await api.get<Blob>(`/rh/pastas/${m.pastaId}/zip`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(resposta.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${nomeDeArquivo(`Notas fiscais ${porExtenso(m.competencia)}`)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErro(await motivoDoBlob(e));
    } finally {
      setBaixando(false);
    }
  }

  const doMes = notas.data ?? [];
  const totalDoMes = doMes.reduce((s, n) => s + Number(n.valor), 0);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Notas fiscais"
        titulo={mes ? porExtenso(mes) : 'Notas fiscais'}
        descricao={
          mes
            ? 'As notas de entrada deste mês. O zip leva todas de uma vez.'
            : 'O que a empresa comprou em cada mês, para ir à contabilidade e virar crédito de imposto.'
        }
        voltar={mes ? () => setMes(null) : undefined}
        acoes={
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setLancando(true);
            }}
            className="btn btn-primario"
          >
            Lançar nota
          </button>
        }
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {mes === null ? (
        <Bloco semPadding>
          {meses.isLoading ? (
            <Carregando />
          ) : (meses.data ?? []).length === 0 ? (
            <Vazio titulo="Nenhuma nota guardada ainda">
              A primeira nota abre o mês dela. Guarde o PDF ou a foto da nota
              escaneada, com o valor — é a soma dele que se confere com a
              contabilidade no fim do mês.
            </Vazio>
          ) : (
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Mês</th>
                    <th className="th">Notas</th>
                    <th className="th text-right">Total</th>
                    <th className="th">Última entrou</th>
                    <th className="th text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(meses.data ?? []).map((m) => (
                    <tr key={m.competencia} className="linha">
                      <td className="td">
                        <button
                          type="button"
                          onClick={() => setMes(m.competencia)}
                          className="font-medium text-tinta-800 hover:underline"
                        >
                          {porExtenso(m.competencia)}
                        </button>
                      </td>
                      <td className="td num text-tinta-600">{m.qtd}</td>
                      <td className="td text-right">
                        <span className="valor">{formatBRL(m.total)}</span>
                      </td>
                      <td className="td whitespace-nowrap text-tinta-500">
                        {formatData(m.ultimaEm)}
                      </td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setMes(m.competencia)}
                            className="btn btn-neutro btn-p"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => void baixarMes(m)}
                            disabled={baixando}
                            className="btn btn-neutro btn-p"
                            title="Baixa as notas deste mês num zip, para mandar à contabilidade"
                          >
                            {baixando ? 'Montando…' : 'Baixar o mês'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>
      ) : (
        <Bloco semPadding>
          {notas.isLoading ? (
            <Carregando />
          ) : doMes.length === 0 ? (
            <Vazio titulo="Este mês ficou sem nota">
              Nenhuma nota aqui — ou todas foram apagadas.
            </Vazio>
          ) : (
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Fornecedor</th>
                    <th className="th">Nº</th>
                    <th className="th">Emitida</th>
                    <th className="th text-right">Valor</th>
                    <th className="th text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {doMes.map((n) => (
                    <tr key={n.id} className="linha">
                      <td className="td">
                        <div className="font-medium text-tinta-800">
                          {n.fornecedor}
                        </div>
                        <div className="text-[11px] text-tinta-400">
                          {n.arquivoNome}
                        </div>
                      </td>
                      <td className="td num text-tinta-600">{n.numero ?? '—'}</td>
                      <td className="td whitespace-nowrap text-tinta-500">
                        {n.emitidaEm ? formatData(n.emitidaEm) : '—'}
                      </td>
                      <td className="td text-right">
                        <span className="valor">{formatBRL(n.valor)}</span>
                      </td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-2">
                          {/* O arquivo abre na aba, que é o que quem clica em
                              "ver" espera de um PDF ou de uma foto. */}
                          <a
                            href={`/api/rh/documentos/${n.documentoId}/arquivo`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-neutro btn-p"
                          >
                            Ver
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setErro(null);
                              setEditando(n);
                            }}
                            className="btn btn-neutro btn-p"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  `Apagar a nota de ${n.fornecedor} de ${formatBRL(n.valor)}? ` +
                                    'O arquivo sai da estante junto.',
                                )
                              ) {
                                apagar.mutate(n.id);
                              }
                            }}
                            className="btn btn-sutil btn-p"
                          >
                            Apagar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* O total fecha a tabela porque é a resposta que se leva desta
                    tela: é ele que se confere com quem recebe as notas. */}
                <tfoot>
                  <tr className="border-t-2 border-tinta-200">
                    <td className="td font-semibold text-tinta-700" colSpan={3}>
                      {doMes.length} nota{doMes.length > 1 ? 's' : ''} em{' '}
                      {porExtenso(mes)}
                    </td>
                    <td className="td text-right">
                      <span className="valor text-[15px] font-semibold">
                        {formatBRL(totalDoMes)}
                      </span>
                    </td>
                    <td className="td" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Bloco>
      )}

      {(lancando || editando) && (
        <FormularioDaNota
          nota={editando ?? undefined}
          mesSugerido={mes ?? mesCorrente()}
          onFechar={() => {
            setLancando(false);
            setEditando(null);
          }}
          onPronto={(competencia) => {
            setLancando(false);
            setEditando(null);
            recarregar();
            // Guardada a nota, o lugar de olhar é o mês dela — inclusive quando
            // ela foi lançada num mês diferente do que estava aberto.
            if (mes !== null) setMes(competencia);
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * A nota chegando, ou sendo corrigida.
 *
 * Corrigindo, o arquivo não aparece: papel guardado não se troca por cima —
 * apaga-se a nota e sobe-se de novo, que é o que deixa rastro de que o arquivo
 * mudou. O que se corrige aqui é o que se digitou errado.
 */
function FormularioDaNota({
  nota,
  mesSugerido,
  onFechar,
  onPronto,
}: {
  nota?: NotaFiscal;
  mesSugerido: string;
  onFechar: () => void;
  onPronto: (competencia: string) => void;
}) {
  const corrigindo = nota !== undefined;
  const [competencia, setCompetencia] = useState(nota?.competencia ?? mesSugerido);
  const [fornecedor, setFornecedor] = useState(nota?.fornecedor ?? '');
  const [numero, setNumero] = useState(nota?.numero ?? '');
  const [valor, setValor] = useState(nota?.valor ?? '');
  const [emitidaEm, setEmitidaEm] = useState(nota?.emitidaEm?.slice(0, 10) ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo: Record<string, unknown> = {
        competencia,
        fornecedor,
        numero: numero.trim() || undefined,
        valor: Number(valor),
        emitidaEm: emitidaEm || undefined,
      };

      if (corrigindo) {
        await api.patch(`/rh/notas-fiscais/${nota.id}`, corpo);
        return;
      }

      if (!arquivo) throw new Error('Escolha o arquivo da nota.');
      corpo.arquivoNome = arquivo.name;
      corpo.arquivo = await lerComoDataUrl(arquivo);
      await api.post('/rh/notas-fiscais', corpo);
    },
    onSuccess: () => onPronto(competencia),
    onError: (e) => setErro(mensagemErro(e)),
  });

  const incompleto =
    fornecedor.trim().length < 2 ||
    Number(valor) <= 0 ||
    (!corrigindo && !arquivo);

  return (
    <Janela
      titulo={corrigindo ? 'Corrigir a nota' : 'Lançar nota fiscal'}
      onFechar={onFechar}
    >
      <div className="space-y-4">
        {erro && <Aviso tom="erro">{erro}</Aviso>}

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="rotulo">Mês da nota</label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="campo"
            />
          </div>
          <div>
            <label className="rotulo">Emitida em</label>
            <input
              type="date"
              value={emitidaEm}
              onChange={(e) => setEmitidaEm(e.target.value)}
              className="campo"
            />
          </div>
        </div>

        <div>
          <label className="rotulo">Fornecedor</label>
          <input
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
            placeholder="De quem é a nota"
            className="campo"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="rotulo">Número da nota</label>
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="opcional"
              className="campo w-40"
            />
          </div>
          <div>
            <label className="rotulo">Valor (R$)</label>
            <CampoDinheiro
              valor={valor}
              onChange={setValor}
              className="campo w-40"
            />
          </div>
        </div>

        {corrigindo ? (
          <p className="text-xs leading-relaxed text-tinta-500">
            O arquivo continua o mesmo (<strong>{nota.arquivoNome}</strong>).
            Para trocar o papel, apague esta nota e lance de novo — assim fica
            claro que o documento mudou, e não só o que estava escrito sobre ele.
          </p>
        ) : (
          <div>
            <label className="rotulo">Arquivo da nota</label>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="campo"
            />
            <p className="mt-1 text-xs text-tinta-400">
              O PDF da nota, ou a foto dela escaneada. Até 15 MB.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || incompleto}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Guardando…' : corrigindo ? 'Salvar' : 'Guardar'}
          </button>
          <button type="button" onClick={onFechar} className="btn btn-sutil">
            Cancelar
          </button>
        </div>
      </div>
    </Janela>
  );
}

/** "2026-09" → "Setembro de 2026". */
function porExtenso(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const nomes = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];
  const nome = nomes[Number(mes) - 1];
  return nome ? `${nome} de ${ano}` : competencia;
}

/** O mês de hoje, que é o que quase toda nota lançada vai querer. */
function mesCorrente(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}
