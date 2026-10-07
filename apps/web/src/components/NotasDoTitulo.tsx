import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, mensagemErro, mensagemErroDeArquivo } from '../lib/api';
import type { NotaDoTitulo } from '../lib/types';
import { FotoAmpliada } from './ui';

/** O arquivo já lido do IXC, guardado para não pedir duas vezes. */
interface ArquivoDaNota {
  url: string;
  /** "image/jpeg", "application/pdf" — é quem decide se abre aqui ou numa aba. */
  tipo: string;
}

/** Uma nota guardada aqui — sem o arquivo, que vem quando se pede. */
interface NotaGuardada {
  id: string;
  rotulo: string;
  parteId: string;
}

/**
 * As notas de um título.
 *
 * Primeiro as guardadas aqui: as da conta paga de uma vez, uma por nota. Elas
 * também estão no IXC, mas de lá não voltam — com várias no mesmo título, o
 * webservice desta base não devolve uma por uma. Sem nenhuma guardada, a
 * lista é a do IXC, como sempre foi.
 *
 * `filtro` serve à ficha do veículo, nas contas lançadas antes das cópias
 * existirem: dos arquivos do título, só os que levam o nome dele.
 */
export function NotasDoTitulo({
  idFnApagar,
  filtro,
}: {
  idFnApagar: number;
  filtro?: (descricao: string) => boolean;
}) {
  const guardadas = useQuery({
    queryKey: ['notas-guardadas', 'titulo', idFnApagar],
    queryFn: async () =>
      (await api.get<NotaGuardada[]>(`/contas-abertas/${idFnApagar}/notas-guardadas`)).data,
    retry: 0,
  });

  if (guardadas.isLoading) {
    return <p className="mt-4 text-sm text-tinta-400">Procurando as notas…</p>;
  }
  if (guardadas.data?.length) return <NotasGuardadas notas={guardadas.data} />;
  return <NotasNoIxc idFnApagar={idFnApagar} filtro={filtro} />;
}

/** As notas guardadas de uma das notas de uma conta — a do veículo, na ficha dele. */
export function NotasDaParte({ parteId }: { parteId: string }) {
  const guardadas = useQuery({
    queryKey: ['notas-guardadas', 'parte', parteId],
    queryFn: async () =>
      (await api.get<NotaGuardada[]>(`/contas-abertas/partes/${parteId}/notas`)).data,
    retry: 0,
  });

  if (guardadas.isLoading) {
    return <p className="mt-4 text-sm text-tinta-400">Procurando a nota…</p>;
  }
  if (guardadas.isError) {
    return (
      <p className="mt-4 text-sm text-rose-600">
        Não deu para abrir a nota: {mensagemErro(guardadas.error)}
      </p>
    );
  }
  return <NotasGuardadas notas={guardadas.data ?? []} />;
}

/**
 * As notas guardadas aqui, com o mesmo jeito de abrir das do IXC: a foto em
 * tela cheia, com as setas; o PDF num link que abre a aba.
 */
function NotasGuardadas({ notas }: { notas: NotaGuardada[] }) {
  const [lidas] = useState(() => new Map<string, string>());
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  /** O PDF já lido: abre por um link, que o toque abre sem o celular recusar. */
  const [pdf, setPdf] = useState<{ id: string; url: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf.url);
    },
    [pdf],
  );

  async function ler(id: string): Promise<string> {
    const pronta = lidas.get(id);
    if (pronta) return pronta;
    const { data } = await api.get<{ foto: string }>(`/contas-abertas/notas-guardadas/${id}`);
    lidas.set(id, data.foto);
    return data.foto;
  }

  async function abrir(nota: NotaGuardada) {
    setAbrindo(nota.id);
    setErro(null);
    try {
      const dados = await ler(nota.id);
      if (dados.startsWith('data:image/')) {
        setVendo(nota.id);
      } else {
        const blob = await (await fetch(dados)).blob();
        setPdf({ id: nota.id, url: URL.createObjectURL(blob) });
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAbrindo(null);
    }
  }

  /** A foto vizinha: pula o PDF, que não se mostra em tela cheia. */
  async function irPara(passo: number) {
    const atual = notas.findIndex((n) => n.id === vendo);
    for (let i = atual + passo; i >= 0 && i < notas.length; i += passo) {
      try {
        if ((await ler(notas[i].id)).startsWith('data:image/')) {
          setVendo(notas[i].id);
          return;
        }
      } catch (e) {
        setErro(mensagemErro(e));
        return;
      }
    }
  }

  const aberta = vendo ? lidas.get(vendo) : undefined;
  const indice = notas.findIndex((n) => n.id === vendo);

  return (
    <div className="mt-4">
      <div className="rotulo">Notas anexadas</div>
      {notas.length === 0 ? (
        <p className="text-sm text-tinta-400">Nenhuma nota anexada.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {notas.map((nota) => (
            <span key={nota.id} className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => void abrir(nota)}
                disabled={abrindo === nota.id}
                className="btn btn-p btn-neutro"
              >
                {abrindo === nota.id ? 'Abrindo…' : `Ver: ${nota.rotulo}`}
              </button>
              {pdf?.id === nota.id && (
                <a
                  href={pdf.url}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  Abrir o PDF
                </a>
              )}
            </span>
          ))}
        </div>
      )}
      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}
      {vendo && aberta && (
        <FotoAmpliada
          src={aberta}
          titulo={
            notas.length > 1
              ? `${notas[indice]?.rotulo ?? 'Nota'} — ${indice + 1} de ${notas.length}`
              : (notas[indice]?.rotulo ?? 'Nota')
          }
          onFechar={() => setVendo(null)}
          onAnterior={indice > 0 ? () => void irPara(-1) : undefined}
          onProxima={indice < notas.length - 1 ? () => void irPara(1) : undefined}
        />
      )}
    </div>
  );
}

/**
 * As notas anexadas a um título, lidas do IXC.
 *
 * É a mesma lista da aba "Arquivos" da tela dele. Aparece na ficha porque a
 * pergunta de quem a abre é "cadê a foto disso?" — quem anexou o cupom na hora
 * de lançar a conta vai procurá-la aqui, e mandar a pessoa ao IXC para
 * responder seria mandá-la embora da tela em que ela já está.
 *
 * O bloco aparece mesmo quando não há nota nenhuma, dizendo isso com todas as
 * letras. Antes ele sumia calado, e sumir é a mesma tela de quando o anexo
 * falhou: quem tinha acabado de anexar não conseguia distinguir "não subiu" de
 * "não tem onde ver".
 */
function NotasNoIxc({
  idFnApagar,
  filtro,
}: {
  idFnApagar: number;
  filtro?: (descricao: string) => boolean;
}) {
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** A foto sendo lida em tela cheia, quando é foto. */
  const [vendo, setVendo] = useState<NotaDoTitulo | null>(null);
  /** O PDF já baixado: abre por um link, que o toque abre sem o celular recusar. */
  const [pdf, setPdf] = useState<number | null>(null);

  /*
   * Os arquivos já baixados. Passar de uma foto à outra não pode significar
   * uma ida ao IXC a cada seta, e o `useState` com função guarda o mesmo mapa
   * por toda a vida do componente.
   */
  const [baixados] = useState(() => new Map<number, ArquivoDaNota>());
  useEffect(
    () => () => {
      for (const { url } of baixados.values()) URL.revokeObjectURL(url);
      baixados.clear();
    },
    [baixados],
  );

  const notas = useQuery({
    queryKey: ['notas-do-titulo', idFnApagar],
    queryFn: async () =>
      (await api.get<NotaDoTitulo[]>(`/contas-abertas/${idFnApagar}/notas`))
        .data,
    // Anexo é raro e o IXC é lento: não vale repetir a pergunta sozinho.
    retry: 0,
  });

  const lista = (notas.data ?? []).filter((n) => !filtro || filtro(n.descricao));

  /*
   * O arquivo vem pela API autenticada, e não por um `href` direto: o token
   * vive no cabeçalho, e uma aba aberta na mão chegaria lá sem ele.
   */
  async function baixar(nota: NotaDoTitulo): Promise<Blob> {
    const { data } = await api.get<Blob>(
      `/contas-abertas/notas/${nota.id}/arquivo`,
      {
        params: { extensao: nota.extensao || undefined, titulo: idFnApagar },
        responseType: 'blob',
      },
    );
    return data;
  }

  async function arquivo(nota: NotaDoTitulo): Promise<ArquivoDaNota> {
    const pronto = baixados.get(nota.id);
    if (pronto) return pronto;

    const data = await baixar(nota);
    const lido = { url: URL.createObjectURL(data), tipo: data.type };
    baixados.set(nota.id, lido);
    return lido;
  }

  /*
   * Foto ou PDF, quem diz é o arquivo, e não a lista do IXC: nesta base ela
   * chama de "PDF" até a foto tirada pela câmera. A foto abre aqui, do tamanho
   * da tela, com zoom; o PDF ganha o link que abre a aba.
   */
  async function abrir(nota: NotaDoTitulo) {
    setAbrindo(nota.id);
    setErro(null);
    try {
      const lido = await arquivo(nota);
      if (lido.tipo.startsWith('image/')) setVendo(nota);
      else setPdf(nota.id);
    } catch (e) {
      setErro(await mensagemErroDeArquivo(e));
    } finally {
      setAbrindo(null);
    }
  }

  /** A foto vizinha: baixa a seguinte, e pula o PDF, que não se mostra em tela cheia. */
  async function irPara(passo: number) {
    if (!vendo) return;
    const atual = lista.findIndex((n) => n.id === vendo.id);
    for (let i = atual + passo; i >= 0 && i < lista.length; i += passo) {
      setAbrindo(lista[i].id);
      try {
        if ((await arquivo(lista[i])).tipo.startsWith('image/')) {
          setVendo(lista[i]);
          return;
        }
      } catch (e) {
        setErro(await mensagemErroDeArquivo(e));
        return;
      } finally {
        setAbrindo(null);
      }
    }
  }

  const indice = vendo ? lista.findIndex((n) => n.id === vendo.id) : -1;
  const aberta = vendo ? baixados.get(vendo.id) : undefined;

  return (
    <div className="mt-4">
      <div className="rotulo">Notas anexadas</div>

      {notas.isLoading && (
        <p className="text-sm text-tinta-400">Procurando no IXC…</p>
      )}

      {notas.error && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Não deu para ler os anexos deste título no IXC:{' '}
          {mensagemErro(notas.error)}
        </p>
      )}

      {notas.data && lista.length === 0 && (
        <p className="text-sm text-tinta-400">
          Nenhuma nota anexada a este título no IXC.
        </p>
      )}

      {lista.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lista.map((nota) => (
            <span key={nota.id} className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => abrir(nota)}
                disabled={abrindo === nota.id}
                className="btn btn-p btn-neutro"
                title={
                  nota.data
                    ? `Anexada em ${nota.data}${nota.usuario ? ` por ${nota.usuario}` : ''}`
                    : undefined
                }
              >
                {abrindo === nota.id ? 'Abrindo…' : `Abrir: ${nota.descricao}`}
              </button>
              {pdf === nota.id && baixados.get(nota.id) && (
                <a
                  href={baixados.get(nota.id)!.url}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  Abrir o PDF
                </a>
              )}
            </span>
          ))}
        </div>
      )}

      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}

      {vendo && aberta && (
        <FotoAmpliada
          src={aberta.url}
          titulo={
            lista.length > 1
              ? `${vendo.descricao} — ${indice + 1} de ${lista.length}`
              : vendo.descricao
          }
          onFechar={() => setVendo(null)}
          onAnterior={indice > 0 ? () => void irPara(-1) : undefined}
          onProxima={indice < lista.length - 1 ? () => void irPara(1) : undefined}
        />
      )}
    </div>
  );
}
