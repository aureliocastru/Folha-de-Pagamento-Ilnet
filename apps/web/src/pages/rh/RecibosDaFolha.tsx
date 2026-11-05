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
import { formatBRL, formatData } from '../../lib/format';
import type {
  AnaliseDosRecibos,
  EstanteRh,
  LoteDeRecibos,
  ParcelaDo13,
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
        await api.delete<{
          competencia: string;
          apagados: number;
          devolvidos?: number;
          bonusDesfeitos?: number;
        }>(`/rh/recibos/lotes/${lote.id}`)
      ).data,
    onSuccess: (r, lote) => {
      setErro(null);
      setResultado(null);
      setDesfeito(
        `${r.apagados} recibo(s) ${deQue(lote.parcelaDo13, r.competencia)} apagados das pastas.` +
          (r.devolvidos
            ? ` O A receber na folha de ${r.devolvidos} funcionário(s) voltou ao de antes.`
            : '') +
          (r.bonusDesfeitos
            ? ` ${r.bonusDesfeitos} bônus do 13º desfeito(s).`
            : ''),
      );
      void qc.invalidateQueries({ queryKey: ['funcionarios'] });
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
      void qc.invalidateQueries({ queryKey: ['funcionarios'] });
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
  /* O "A receber na folha" troca para todo recibo do PDF, marcado ou não: o
     valor é da folha, e a marca é só de guardar na pasta. */
  const aAtualizar = analise
    ? analise.itens.filter((i) => i.aReceberNovo !== null).length
    : 0;
  /* O 13º não mexe no A receber: o líquido vira um bônus, de todo recibo do
     PDF, pela mesma razão. */
  const e13 = !!analise?.parcelaDo13;
  const aLancar = analise
    ? analise.itens.filter((i) => i.bonus13?.novo != null).length
    : 0;
  const aMudar = e13 ? aLancar : aAtualizar;

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
          {resultado.guardados.length} recibo(s){' '}
          {deQue(resultado.parcelaDo13, resultado.competencia)} guardados nas
          pastas.
          {resultado.bonus.length > 0 && (
            <>
              {' '}
              Bônus do 13º lançado para {resultado.bonus.length} funcionário(s):{' '}
              {quandoSai(resultado.bonus.map((b) => b.folha))}.
            </>
          )}
          {resultado.aReceber.length > 0 && (
            <>
              {' '}
              A receber na folha atualizado de {resultado.aReceber.length}{' '}
              funcionário(s) com o líquido do recibo.
            </>
          )}
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
      {resultado &&
        (resultado.semAtualizar.length > 0 ||
          resultado.semCarteira.length > 0 ||
          resultado.semBonus.length > 0) && (
          <Aviso tom="atencao">
            {resultado.semBonus.length > 0 && (
              <>
                Sem bônus do 13º:{' '}
                {resultado.semBonus
                  .map((p) => `${p.nome} (${p.motivo})`)
                  .join('; ')}
                .{' '}
              </>
            )}
            {resultado.semAtualizar.length > 0 && (
              <>
                A receber na folha <strong>não</strong> atualizado:{' '}
                {resultado.semAtualizar
                  .map((p) => `${p.nome} (${p.motivo})`)
                  .join('; ')}
                .{' '}
              </>
            )}
            {resultado.semCarteira.length > 0 && (
              <>
                Sem carteira assinada no cadastro — a folha paga pelo salário
                base: {resultado.semCarteira.join('; ')}.
              </>
            )}
          </Aviso>
        )}

      <Bloco titulo="O arquivo da contabilidade" className="surgir mb-6">
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
          O recibo do mês ou o do 13º salário, como chega da contabilidade.
          Nada é guardado antes de você conferir a lista abaixo.
        </p>
      </Bloco>

      {analise && (
        <>
          <Aviso tom="info">
            {analise.itens.length} recibo(s){' '}
            {analise.parcelaDo13 ? (
              <>
                do{' '}
                <strong>
                  13º salário — {analise.parcelaDo13}ª parcela
                </strong>{' '}
                ({analise.competenciaEscrita ?? analise.competencia})
              </>
            ) : (
              <>
                de{' '}
                <strong>
                  {analise.competenciaEscrita ?? analise.competencia}
                </strong>
              </>
            )}{' '}
            em {analise.totalDePaginas} páginas.
            {analise.paginasSemDono.length > 0 && (
              <>
                {' '}
                Não reconheci a(s) página(s){' '}
                {analise.paginasSemDono.join(', ')} — elas não entram em pasta
                nenhuma.
              </>
            )}
            {!e13 && !analise.atualizaAReceber && (
              <>
                {' '}
                É de um mês anterior ao último separado: o A receber na folha
                não muda.
              </>
            )}
            {aLancar > 0 && (
              <>
                {' '}
                O líquido vira bônus do 13º para {aLancar} funcionário(s):{' '}
                {quandoSai(
                  analise.itens
                    .filter((i) => i.bonus13?.novo != null)
                    .map((i) => i.bonus13!.folha ?? ''),
                )}
                .
              </>
            )}
            {!e13 && aAtualizar > 0 && (
              <>
                {' '}
                O A receber na folha muda para {aAtualizar} funcionário(s).
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
                    <th className="th text-right">
                      {e13 ? 'Bônus do 13º' : 'A receber'}
                    </th>
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
                              {e13 ? 'já guardado' : 'já guardado neste mês'}
                            </Selo>
                          )}
                        </td>
                        {item.bonus13 ? (
                          <td className="td whitespace-nowrap text-right">
                            {item.liquido !== null ? (
                              <span
                                className={`valor ${
                                  item.bonus13.novo === null && item.bonus13.atual === null
                                    ? 'text-tinta-400'
                                    : ''
                                }`}
                              >
                                {formatBRL(item.liquido)}
                              </span>
                            ) : (
                              <span className="text-tinta-400">—</span>
                            )}
                            {item.bonus13.folha && !item.bonus13.aviso && (
                              <div className="text-xs text-tinta-400">
                                {item.bonus13.novo === null
                                  ? 'já lançado · '
                                  : ''}
                                {quintoDia(item.bonus13.folha)}
                              </div>
                            )}
                            {item.bonus13.novo !== null &&
                              item.bonus13.atual !== null && (
                                <div className="num text-xs text-tinta-400">
                                  era {formatBRL(item.bonus13.atual)}
                                </div>
                              )}
                            {item.bonus13.aviso && (
                              <div className="mt-0.5 max-w-[220px] whitespace-normal text-xs text-amber-600 dark:text-amber-400">
                                {item.bonus13.aviso}
                              </div>
                            )}
                          </td>
                        ) : (
                        <td className="td whitespace-nowrap text-right">
                          {item.liquido !== null ? (
                            <span
                              className={`valor ${
                                analise.atualizaAReceber ? '' : 'text-tinta-400'
                              }`}
                            >
                              {formatBRL(item.liquido)}
                            </span>
                          ) : (
                            <span className="text-tinta-400">—</span>
                          )}
                          {item.aReceberNovo !== null && (
                            <div className="num text-xs text-tinta-400">
                              era{' '}
                              {item.aReceberAtual !== null
                                ? formatBRL(item.aReceberAtual)
                                : 'vazio'}
                            </div>
                          )}
                          {item.aReceberAviso && (
                            <div className="mt-0.5 max-w-[220px] whitespace-normal text-xs text-amber-600 dark:text-amber-400">
                              {item.aReceberAviso}
                            </div>
                          )}
                        </td>
                        )}
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
              disabled={(aGuardar === 0 && aMudar === 0) || guardar.isPending}
              className="btn btn-acao"
            >
              {guardar.isPending
                ? 'Guardando…'
                : e13
                  ? aGuardar > 0 && aLancar > 0
                    ? `Guardar ${aGuardar} recibo(s) e lançar ${aLancar} bônus`
                    : aGuardar > 0
                      ? `Guardar ${aGuardar} recibo(s) nas pastas`
                      : `Lançar o bônus do 13º de ${aLancar} funcionário(s)`
                  : aGuardar > 0
                    ? `Guardar ${aGuardar} recibo(s) nas pastas`
                    : `Atualizar o A receber de ${aAtualizar} funcionário(s)`}
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
                      {lote.parcelaDo13
                        ? `13º ${lote.competencia.slice(0, 4)} · ${lote.parcelaDo13}ª parcela`
                        : mesDaCompetencia(lote.competencia)}
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
                            `Desfazer o lançamento ${deQue(lote.parcelaDo13, lote.competencia)}?\n\n` +
                              `Isto apaga ${lote.guardados} recibo(s) das pastas de todo mundo, ` +
                              (lote.parcelaDo13
                                ? `e os ${lote.bonus} bônus do 13º que ele lançou. `
                                : 'e o A receber na folha volta ao de antes. ') +
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

/** "de 07/2026", ou "do 13º 2026 (1ª parcela)" — de que é o arquivo. */
function deQue(parcela: ParcelaDo13 | null, competencia: string): string {
  return parcela
    ? `do 13º ${competencia.slice(0, 4)} (${parcela}ª parcela)`
    : `de ${mesDaCompetencia(competencia)}`;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "2026-11" → "sai no quinto dia de novembro": a folha que paga o bônus. */
function quintoDia(folha: string): string {
  const mes = MESES[Number(folha.slice(5, 7)) - 1] ?? folha;
  const ano = folha.slice(0, 4);
  const anoDeAgora = String(new Date().getFullYear());
  return `sai no quinto dia de ${mes}${ano === anoDeAgora ? '' : ` de ${ano}`}`;
}

/**
 * Em que folha os bônus saem, juntando quem cai na mesma: "sai no quinto dia
 * de novembro", ou "20 no quinto dia de novembro, 4 no de dezembro".
 */
function quandoSai(folhas: string[]): string {
  const conta = new Map<string, number>();
  for (const f of folhas.filter(Boolean)) conta.set(f, (conta.get(f) ?? 0) + 1);
  const ordem = [...conta.keys()].sort();
  if (ordem.length <= 1) return ordem[0] ? quintoDia(ordem[0]) : '';
  return ordem
    .map((f) => `${conta.get(f)} ${quintoDia(f).replace('sai no ', 'no ')}`)
    .join(', ');
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
