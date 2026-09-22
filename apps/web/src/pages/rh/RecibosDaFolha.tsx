import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type {
  AnaliseDosRecibos,
  EstanteRh,
  LoteDeRecibos,
  PastaRh,
  RecibosGuardados,
} from '../../lib/types';

/**
 * O PDF de recibos da folha, separado por pessoa.
 *
 * Todo mês a contabilidade manda um arquivo só, com uma página por empregado.
 * Guardado assim, ele responde "onde está a folha de julho?" e não responde
 * "onde está o recibo do Fulano?" — que é a pergunta que se faz dois anos
 * depois, quando ele reclama de um valor.
 *
 * Nada é guardado antes de esta tela mostrar de quem é cada página e para que
 * pasta ela vai. O casamento por CPF acerta quase sempre; "quase" é a razão de
 * a conferência existir, porque recibo na pasta errada é pior que recibo fora
 * da pasta.
 */
export function RecibosDaFolha() {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = useState<{ nome: string; dados: string } | null>(
    null,
  );
  const [destinos, setDestinos] = useState<Record<string, string>>({});
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RecibosGuardados | null>(null);
  const [desfeito, setDesfeito] = useState<string | null>(null);

  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  const lotes = useQuery({
    queryKey: ['rh', 'recibos', 'lotes'],
    queryFn: async () =>
      (await api.get<LoteDeRecibos[]>('/rh/recibos/lotes')).data,
  });

  const analisar = useMutation({
    mutationFn: async (dados: string) =>
      (await api.post<AnaliseDosRecibos>('/rh/recibos/analisar', { arquivo: dados }))
        .data,
    onSuccess: (analise) => {
      setErro(null);
      setResultado(null);
      // O que o app achou entra como escolha feita; discordar é trocar no
      // seletor, e não ter de escolher 23 vezes o que já estava certo.
      setDestinos(
        Object.fromEntries(
          analise.itens
            .filter((i) => i.pastaId)
            .map((i) => [i.matricula, i.pastaId as string]),
        ),
      );
      setFora(
        new Set(analise.itens.filter((i) => i.jaGuardado).map((i) => i.matricula)),
      );
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const criarPasta = useMutation({
    mutationFn: async (dados: { nome: string; cpf?: string; chave: string }) => ({
      pasta: (await api.post<PastaRh>('/rh/pastas', dados)).data,
      chave: dados.chave,
    }),
    onSuccess: ({ pasta, chave }) => {
      setDestinos((atual) => ({ ...atual, [chave]: pasta.id }));
      void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /*
   * Desfazer apaga o que aquele lançamento guardou, em todas as pastas de uma
   * vez. É a única saída de quem separou o arquivo errado — o conserto à mão
   * seria caçar vinte e três documentos em vinte e três pastas diferentes.
   */
  const desfazer = useMutation({
    mutationFn: async (lote: LoteDeRecibos) =>
      (
        await api.delete<{ competencia: string; apagados: number }>(
          `/rh/recibos/lotes/${lote.id}`,
        )
      ).data,
    onSuccess: (r) => {
      setErro(null);
      setResultado(null);
      setDesfeito(
        `${r.apagados} recibo(s) de ${mesDaCompetencia(r.competencia)} apagados das pastas.`,
      );
      void qc.invalidateQueries({ queryKey: ['rh'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const guardar = useMutation({
    mutationFn: async () => {
      const analise = analisar.data!;
      const itens = analise.itens
        .filter((i) => destinos[i.matricula] && !fora.has(i.matricula))
        .map((i) => ({
          paginas: i.paginas,
          pastaId: destinos[i.matricula],
          nome: i.nome,
        }));
      return (
        await api.post<RecibosGuardados>('/rh/recibos', {
          arquivo: arquivo!.dados,
          competencia: analise.competencia,
          arquivoNome: arquivo!.nome,
          itens,
        })
      ).data;
    },
    onSuccess: (r) => {
      setResultado(r);
      setErro(null);
      setDesfeito(null);
      analisar.reset();
      setArquivo(null);
      void qc.invalidateQueries({ queryKey: ['rh'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = e.target.files?.[0];
    e.target.value = '';
    if (!escolhido) return;
    setResultado(null);
    const dados = await lerComoDataUrl(escolhido);
    setArquivo({ nome: escolhido.name, dados });
    analisar.mutate(dados);
  }

  const analise = analisar.data;
  const pastas = estante.data?.pastas ?? [];
  const aGuardar = analise
    ? analise.itens.filter((i) => destinos[i.matricula] && !fora.has(i.matricula))
        .length
    : 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="RH"
        titulo="Recibos da folha"
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {desfeito && <Aviso tom="marca">{desfeito}</Aviso>}

      {resultado && (
        <Aviso tom="pago">
          {resultado.guardados.length} recibo(s) de{' '}
          {mesDaCompetencia(resultado.competencia)} guardados nas pastas.
          {resultado.pulados.length > 0 && (
            <>
              {' '}
              {resultado.pulados.length} ficaram de fora:{' '}
              {resultado.pulados
                .map((p) => `${p.nome} (${p.motivo})`)
                .join('; ')}
              .
            </>
          )}
        </Aviso>
      )}

      <Bloco titulo="O arquivo do mês" className="surgir mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-primario w-fit cursor-pointer">
            {analisar.isPending ? 'Lendo o PDF…' : 'Escolher o PDF dos recibos'}
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={escolher}
            />
          </label>
          {arquivo && (
            <span className="truncate text-sm text-tinta-600">
              {arquivo.nome}
            </span>
          )}
        </div>
        <p className="ajuda">
          É o mesmo arquivo que chega da contabilidade, com um empregado por
          página. Nada é guardado antes de você conferir a lista abaixo.
        </p>
      </Bloco>

      {analise && (
        <>
          <Aviso tom="info">
            {analise.itens.length} recibo(s) de{' '}
            <strong>{analise.competenciaEscrita ?? analise.competencia}</strong>{' '}
            em {analise.totalDePaginas} páginas.
            {analise.paginasSemDono.length > 0 && (
              <>
                {' '}
                Não reconheci a(s) página(s){' '}
                {analise.paginasSemDono.join(', ')} — elas não entram em pasta
                nenhuma.
              </>
            )}
          </Aviso>

          <Bloco semPadding className="mb-6">
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Guardar</th>
                    <th className="th">Quem</th>
                    <th className="th">Página</th>
                    <th className="th">Vai para a pasta</th>
                  </tr>
                </thead>
                <tbody>
                  {analise.itens.map((item) => {
                    const destino = destinos[item.matricula] ?? '';
                    const marcado = !!destino && !fora.has(item.matricula);
                    return (
                      <tr key={item.matricula} className="linha">
                        <td className="td">
                          <input
                            type="checkbox"
                            className="marcador"
                            checked={marcado}
                            disabled={!destino}
                            onChange={(e) =>
                              setFora((atual) => {
                                const novo = new Set(atual);
                                if (e.target.checked) novo.delete(item.matricula);
                                else novo.add(item.matricula);
                                return novo;
                              })
                            }
                          />
                        </td>
                        <td className="td">
                          <div className="font-medium text-tinta-800">
                            {item.nome}
                          </div>
                          <div className="text-xs text-tinta-400">
                            matrícula {item.matricula}
                            {item.cargo ? ` · ${item.cargo.toLowerCase()}` : ''}
                          </div>
                          {item.jaGuardado && (
                            <Selo pequeno tom="atencao">
                              já guardado neste mês
                            </Selo>
                          )}
                        </td>
                        <td className="td num whitespace-nowrap text-tinta-500">
                          {item.paginas.join(', ')}
                        </td>
                        <td className="td">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={destino}
                              onChange={(e) =>
                                setDestinos((atual) => ({
                                  ...atual,
                                  [item.matricula]: e.target.value,
                                }))
                              }
                              className="campo max-w-[240px]"
                            >
                              <option value="">Escolha a pasta</option>
                              {pastas
                                .filter((p) => !p.daEmpresa)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nome}
                                  </option>
                                ))}
                            </select>
                            {item.casouPor && destino === item.pastaId && (
                              <Selo pequeno tom="pago">
                                {item.casouPor === 'cpf'
                                  ? 'achei pelo CPF'
                                  : 'achei pelo nome'}
                              </Selo>
                            )}
                            {!destino && (
                              <button
                                type="button"
                                onClick={() =>
                                  criarPasta.mutate({
                                    nome: item.nome,
                                    cpf: item.cpf || undefined,
                                    chave: item.matricula,
                                  })
                                }
                                disabled={criarPasta.isPending}
                                className="btn btn-p btn-neutro"
                                title="Cria a pasta desta pessoa, com o nome e o CPF do recibo"
                              >
                                Criar pasta
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Bloco>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-tinta-500">
              {aGuardar} de {analise.itens.length} marcados. Cada recibo entra
              na subpasta{' '}
              <span className="text-tinta-700">Recibos de pagamento</span> da
              pasta escolhida — ela nasce na primeira vez e é a mesma nos meses
              seguintes.
            </p>
            <button
              type="button"
              onClick={() => guardar.mutate()}
              disabled={aGuardar === 0 || guardar.isPending}
              className="btn btn-acao"
            >
              {guardar.isPending
                ? 'Guardando…'
                : `Guardar ${aGuardar} recibo(s) nas pastas`}
            </button>
          </div>
        </>
      )}

      {!analise && !analisar.isPending && !resultado && (
        <Vazio titulo="Nenhum arquivo lido ainda">
          Escolha o PDF do mês acima. Eu leio quem é o dono de cada página,
          mostro a lista e só guardo depois que você conferir.
          <div className="mt-4">
            <Link to="/rh/pastas" className="btn btn-neutro">
              Ver as pastas
            </Link>
          </div>
        </Vazio>
      )}

      {/*
        O histórico existe para ser desfeito.

        Separar um mês toca vinte e três pastas de uma vez, e o engano — mês
        errado, arquivo errado — só aparece depois de tudo guardado. Aqui cada
        lançamento é uma linha, e um clique tira das pastas tudo o que ele pôs.
      */}
      {(lotes.data?.length ?? 0) > 0 && (
        <Bloco titulo="O que já foi separado" className="mt-8" semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Quando</th>
                  <th className="th">Competência</th>
                  <th className="th">Arquivo</th>
                  <th className="th text-right">Recibos</th>
                  <th className="th text-right" />
                </tr>
              </thead>
              <tbody>
                {(lotes.data ?? []).map((lote) => (
                  <tr key={lote.id} className="linha">
                    <td className="td whitespace-nowrap">
                      {formatData(lote.createdAt)}
                    </td>
                    <td className="td num whitespace-nowrap">
                      {mesDaCompetencia(lote.competencia)}
                    </td>
                    <td className="td">
                      <span className="truncate text-tinta-500">
                        {lote.arquivoNome}
                      </span>
                    </td>
                    <td className="td num whitespace-nowrap text-right">
                      {lote.guardados}
                      {lote.guardados !== lote.quantidade && (
                        <span
                          className="ml-1 text-xs text-tinta-400"
                          title={`Entraram ${lote.quantidade}; o resto já foi apagado à mão`}
                        >
                          de {lote.quantidade}
                        </span>
                      )}
                    </td>
                    <td className="td text-right">
                      <button
                        type="button"
                        onClick={() => {
                          const ok = confirm(
                            `Desfazer o lançamento de ${mesDaCompetencia(lote.competencia)}?\n\n` +
                              `Isto apaga ${lote.guardados} recibo(s) das pastas de todo mundo. ` +
                              'Os arquivos saem daqui e não voltam.',
                          );
                          if (ok) desfazer.mutate(lote);
                        }}
                        disabled={desfazer.isPending}
                        className="btn btn-p btn-sutil"
                        title="Apaga das pastas tudo o que este lançamento guardou"
                      >
                        Desfazer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>
      )}
    </Pagina>
  );
}

/** "2026-07" → "07/2026". */
function mesDaCompetencia(competencia: string): string {
  return `${competencia.slice(5)}/${competencia.slice(0, 4)}`;
}

/** O arquivo como data URL — é assim que ele chega à API. */
function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () =>
      reject(new Error('Não consegui ler este arquivo do seu computador.'));
    leitor.readAsDataURL(arquivo);
  });
}
