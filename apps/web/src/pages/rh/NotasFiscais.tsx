import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type { DocumentoRh, MesDeNotas } from '../../lib/types';
import { lerComoDataUrl, motivoDoBlob, nomeDeArquivo } from './Pasta';

/** A prateleira dentro da pasta do mês, para a estante mostrar o que é. */
const TIPO_DA_NOTA = 'Nota fiscal';

/**
 * Notas fiscais de entrada — o que a casa comprou no mês.
 *
 * O que esta tela substitui é uma pasta no computador de alguém. As notas
 * chegam o mês inteiro, por e-mail e no balcão, e no fim do mês vão para a
 * contabilidade virar crédito de imposto. Enquanto o monte mora numa pasta do
 * Windows, ele só existe naquela máquina.
 *
 * É uma gaveta, e de propósito. Abre-se o mês, arrastam-se os arquivos para
 * dentro, e no fim baixa-se o zip para mandar. Não há fornecedor, número nem
 * valor a digitar: seriam noventa campos por mês para responder uma pergunta
 * que a contabilidade já responde, e o que se pode deixar pela metade acaba
 * pela metade.
 *
 * O arrasto cai na página inteira, e não numa janela que se abre antes. Quem
 * está com a nota aberta ao lado, ou recém-baixada, quer soltá-la e continuar
 * — abrir formulário para cada papel é o que fazia a pasta do Windows ganhar
 * essa disputa.
 */
export function NotasFiscais() {
  const qc = useQueryClient();
  /** null = a lista de meses; a pasta = dentro daquele mês. */
  const [mes, setMes] = useState<MesDeNotas | null>(null);
  const [abrindoMes, setAbrindoMes] = useState(false);
  const [erroDoMes, setErroDoMes] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [subindo, setSubindo] = useState(0);

  const meses = useQuery({
    queryKey: ['rh', 'notas-fiscais'],
    queryFn: async () => (await api.get<MesDeNotas[]>('/rh/notas-fiscais')).data,
  });

  const documentos = useQuery({
    queryKey: ['rh', 'documentos', mes?.id],
    queryFn: async () =>
      (await api.get<DocumentoRh[]>('/rh/documentos', { params: { pastaId: mes?.id } }))
        .data,
    enabled: mes !== null,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['rh', 'notas-fiscais'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'documentos'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
  }

  function avisar(texto: string) {
    setFeito(texto);
    setTimeout(() => setFeito(null), 5000);
  }

  const abrirMes = useMutation({
    mutationFn: async (competencia: string) =>
      (await api.post<MesDeNotas>('/rh/notas-fiscais', { competencia })).data,
    onSuccess: (m) => {
      setAbrindoMes(false);
      setErroDoMes(null);
      recarregar();
      // O mês nasceu vazio: o passo seguinte é jogar os arquivos dentro dele.
      setMes(m);
    },
    // O recado desta fila mora na janela, e não na página: quem acabou de
    // pedir o mês está olhando para ela, e um aviso atrás dela não é aviso.
    onError: (e) => setErroDoMes(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/rh/documentos/${id}`)).data,
    onSuccess: recarregar,
    onError: (e) => setErro(mensagemErro(e)),
  });

  /**
   * Os arquivos soltos entram um a um, com o nome que já têm.
   *
   * Um a um porque cada arquivo é o corpo inteiro de uma requisição — cinco de
   * quinze megabytes juntos é o que o nginx recusa sem frase nenhuma. E o que
   * falha no meio não para a fila nem desfaz o que entrou: quem soltou oito
   * notas e tem uma grande demais quer as outras sete guardadas, e quer saber
   * qual ficou de fora.
   */
  async function guardarArquivos(arquivos: File[]) {
    if (!mes || arquivos.length === 0) return;
    setErro(null);
    setSubindo(arquivos.length);

    const falhas: string[] = [];
    let entraram = 0;
    const avisos: string[] = [];

    for (const arquivo of arquivos) {
      try {
        const { data } = await api.post<DocumentoRh & { avisoDaConversao?: string }>(
          '/rh/documentos',
          {
            pastaId: mes.id,
            titulo: semExtensao(arquivo.name),
            tipo: TIPO_DA_NOTA,
            arquivoNome: arquivo.name,
            arquivo: await lerComoDataUrl(arquivo),
            // A foto da nota vira PDF: o pacote que vai à contabilidade sai
            // todo no mesmo formato, e abre em sequência no mesmo leitor.
            converterParaPdf: true,
          },
        );
        entraram += 1;
        if (data.avisoDaConversao) avisos.push(data.avisoDaConversao);
      } catch (e) {
        falhas.push(`${arquivo.name}: ${mensagemErro(e)}`);
      }
    }

    setSubindo(0);
    recarregar();

    if (entraram > 0) {
      avisar(
        `${entraram} arquivo${entraram > 1 ? 's' : ''} guardado${entraram > 1 ? 's' : ''}.` +
          (avisos.length > 0 ? ` ${avisos.join(' ')}` : ''),
      );
    }
    if (falhas.length > 0) setErro(falhas.join(' · '));
  }

  function aoSoltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    void guardarArquivos([...e.dataTransfer.files]);
  }

  /**
   * Baixa o mês inteiro num zip.
   *
   * Vai pela API autenticada, e não por um `href` direto: o token vive no
   * cabeçalho, e um link aberto na mão chegaria lá sem ele. O erro do servidor
   * chega como blob, e por isso é lido como texto antes de virar aviso.
   */
  async function baixarMes(m: MesDeNotas) {
    setBaixando(m.id);
    setErro(null);
    try {
      const resposta = await api.get<Blob>(`/rh/pastas/${m.id}/zip`, {
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
      setBaixando(null);
    }
  }

  const lista = documentos.data ?? [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Notas fiscais"
        titulo={mes ? porExtenso(mes.competencia) : 'Notas fiscais'}
        descricao={
          mes
            ? 'Arraste as notas para qualquer lugar desta tela. No fim do mês, baixe o zip e mande.'
            : 'O que a empresa comprou em cada mês, para ir à contabilidade e virar crédito de imposto.'
        }
        voltar={mes ? () => setMes(null) : undefined}
        acoes={
          mes ? (
            <button
              type="button"
              onClick={() => void baixarMes(mes)}
              disabled={baixando !== null}
              className="btn btn-primario"
            >
              {baixando ? 'Montando o zip…' : 'Baixar o mês'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setErroDoMes(null);
                setAbrindoMes(true);
              }}
              className="btn btn-primario"
            >
              Abrir um mês
            </button>
          )
        }
      />

      {feito && <Aviso tom="pago">{feito}</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {mes === null ? (
        <Bloco semPadding>
          {meses.isLoading ? (
            <Carregando texto="Abrindo a gaveta…" />
          ) : (meses.data ?? []).length === 0 ? (
            <Vazio titulo="Nenhum mês aberto ainda">
              Comece pelo botão "Abrir um mês": ele cria a pasta daquele mês, e
              é para dentro dela que você arrasta as notas. No fim do mês, o zip
              da pasta é o que vai para a contabilidade.
            </Vazio>
          ) : (
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Mês</th>
                    <th className="th">Arquivos</th>
                    <th className="th">Último entrou</th>
                    <th className="th text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(meses.data ?? []).map((m) => (
                    <tr key={m.id} className="linha">
                      <td className="td">
                        <button
                          type="button"
                          onClick={() => setMes(m)}
                          className="font-medium text-tinta-800 hover:underline"
                        >
                          {porExtenso(m.competencia)}
                        </button>
                      </td>
                      <td className="td num text-tinta-600">{m.qtd}</td>
                      <td className="td whitespace-nowrap text-tinta-500">
                        {m.ultimoEm ? formatData(m.ultimoEm) : 'vazio'}
                      </td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setMes(m)}
                            className="btn btn-neutro btn-p"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => void baixarMes(m)}
                            disabled={baixando !== null || m.qtd === 0}
                            className="btn btn-neutro btn-p disabled:opacity-40"
                            title={
                              m.qtd === 0
                                ? 'Este mês ainda está vazio'
                                : 'Baixa as notas deste mês num zip, para mandar à contabilidade'
                            }
                          >
                            {baixando === m.id ? 'Montando…' : 'Baixar o mês'}
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
        /* A tela inteira do mês é o alvo do arrasto: quem está com a nota
           aberta ao lado quer soltá-la aqui e seguir, sem abrir formulário. */
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={(e) => {
            // Só apaga a moldura ao sair da área toda, e não ao passar por
            // cima de uma linha da tabela lá dentro.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setArrastando(false);
            }
          }}
          onDrop={aoSoltar}
          className={`rounded-2xl transition ${
            arrastando ? 'ring-2 ring-brand-400 ring-offset-4 ring-offset-transparent' : ''
          }`}
        >
          <Bloco semPadding>
            {subindo > 0 && (
              <div className="border-b border-tinta-100 px-5 py-3 text-sm text-tinta-600">
                Guardando {subindo} arquivo{subindo > 1 ? 's' : ''}…
              </div>
            )}

            {documentos.isLoading ? (
              <Carregando texto="Abrindo o mês…" />
            ) : lista.length === 0 ? (
              <Vazio titulo="Arraste as notas para cá">
                Solte os arquivos em qualquer lugar desta tela — pode ser mais
                de um de uma vez. Foto da nota vira PDF sozinha, para o pacote
                sair todo no mesmo formato.
              </Vazio>
            ) : (
              <div className="overflow-x-auto rolagem-fina">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">Nota</th>
                      <th className="th">Entrou</th>
                      <th className="th text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((d) => (
                      <tr key={d.id} className="linha">
                        <td className="td">
                          <div className="font-medium text-tinta-800">
                            {d.titulo}
                          </div>
                          <div className="text-[11px] text-tinta-400">
                            {d.arquivoNome} · {emMegabytes(d.arquivoTamanho)}
                          </div>
                        </td>
                        <td className="td whitespace-nowrap text-tinta-500">
                          {formatData(d.createdAt)}
                        </td>
                        <td className="td text-right">
                          <div className="flex justify-end gap-2">
                            {/* Abre na aba, que é o que quem clica em "ver"
                                espera de um PDF. */}
                            <a
                              href={`/api/rh/documentos/${d.id}/arquivo`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-neutro btn-p"
                            >
                              Ver
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Apagar "${d.titulo}"?`)) {
                                  apagar.mutate(d.id);
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
                </table>
              </div>
            )}
          </Bloco>

          {/* O botão existe para quem não arrasta — do celular, ou de um
              gerenciador de arquivos que não solta na janela do navegador. */}
          <div className="mt-4 flex items-center gap-3">
            <label className="btn btn-neutro cursor-pointer">
              Escolher arquivos
              <input
                type="file"
                multiple
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  void guardarArquivos([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="text-xs text-tinta-400">
              PDF ou foto da nota, até 15 MB cada.
            </span>
          </div>
        </div>
      )}

      {abrindoMes && (
        <JanelaDoMes
          pendente={abrirMes.isPending}
          erro={erroDoMes}
          onFechar={() => {
            setAbrindoMes(false);
            setErroDoMes(null);
          }}
          onAbrir={(competencia) => abrirMes.mutate(competencia)}
        />
      )}
    </Pagina>
  );
}

/** Que mês abrir. O corrente vem escrito, que é o de quase toda vez. */
function JanelaDoMes({
  pendente,
  erro,
  onFechar,
  onAbrir,
}: {
  pendente: boolean;
  erro: string | null;
  onFechar: () => void;
  onAbrir: (competencia: string) => void;
}) {
  const [competencia, setCompetencia] = useState(mesCorrente);

  return (
    <Janela titulo="Abrir um mês" onFechar={onFechar}>
      <div className="space-y-4">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <p className="text-sm text-tinta-500">
          A pasta nasce vazia, e é para dentro dela que as notas vão. O nome
          dela vira o nome do zip que chega na contabilidade.
        </p>
        <div>
          <label className="rotulo">Mês</label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="campo w-48"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onAbrir(competencia)}
            disabled={pendente || !/^\d{4}-\d{2}$/.test(competencia)}
            className="btn btn-primario"
          >
            {pendente ? 'Abrindo…' : 'Abrir'}
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
  // Pasta renomeada à mão pela estante: o nome que sobrou é a resposta.
  return nome && ano ? `${nome} de ${ano}` : competencia;
}

/** O mês de hoje, que é o que quase toda abertura vai querer. */
function mesCorrente(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function semExtensao(nome: string): string {
  return nome.replace(/\.[^.]+$/, '').slice(0, 120) || nome;
}

function emMegabytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
