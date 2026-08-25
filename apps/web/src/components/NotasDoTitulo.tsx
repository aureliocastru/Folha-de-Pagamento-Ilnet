import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import type { NotaDoTitulo } from '../lib/types';
import { FotoAmpliada } from './ui';

/** O arquivo já lido do IXC, guardado para não pedir duas vezes. */
interface ArquivoDaNota {
  url: string;
  /** "image/jpeg", "application/pdf" — é quem decide se abre aqui ou numa aba. */
  tipo: string;
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
export function NotasDoTitulo({ idFnApagar }: { idFnApagar: number }) {
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** A foto sendo lida em tela cheia, quando é foto. */
  const [vendo, setVendo] = useState<NotaDoTitulo | null>(null);

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

  const lista = notas.data ?? [];
  /** Só as fotos — são elas que a tela cheia percorre com as setas. */
  const fotos = lista.filter(ehFoto);

  /*
   * O arquivo vem pela API autenticada, e não por um `href` direto: o token
   * vive no cabeçalho, e uma aba aberta na mão chegaria lá sem ele.
   */
  async function arquivo(nota: NotaDoTitulo): Promise<ArquivoDaNota> {
    const pronto = baixados.get(nota.id);
    if (pronto) return pronto;

    const { data } = await api.get<Blob>(
      `/contas-abertas/notas/${nota.id}/arquivo`,
      { params: { extensao: nota.extensao || undefined }, responseType: 'blob' },
    );
    const lido = { url: URL.createObjectURL(data), tipo: data.type };
    baixados.set(nota.id, lido);
    return lido;
  }

  async function abrir(nota: NotaDoTitulo) {
    setAbrindo(nota.id);
    setErro(null);
    try {
      const { url, tipo } = await arquivo(nota);
      // Foto abre aqui, do tamanho da tela — é para ser lida, e a aba nova
      // custa a volta. PDF vai para a aba, que é quem sabe folhear.
      if (tipo.startsWith('image/')) setVendo(nota);
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAbrindo(null);
    }
  }

  /** A foto vizinha na sequência, já baixada antes de trocar o que está à vista. */
  async function irPara(passo: number) {
    if (!vendo) return;
    const proxima = fotos[fotos.findIndex((f) => f.id === vendo.id) + passo];
    if (!proxima) return;
    setAbrindo(proxima.id);
    try {
      await arquivo(proxima);
      setVendo(proxima);
    } catch (e) {
      setErro(mensagemErro(e));
      setVendo(null);
    } finally {
      setAbrindo(null);
    }
  }

  const naSequencia = vendo ? fotos.findIndex((f) => f.id === vendo.id) : -1;
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
            <button
              key={nota.id}
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
              {abrindo === nota.id
                ? 'Abrindo…'
                : `${ehFoto(nota) ? 'Ver foto' : 'Abrir'}: ${nota.descricao}`}
              {nota.extensao && (
                <span className="ml-1 text-tinta-400">.{nota.extensao}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}

      {vendo && aberta && (
        <FotoAmpliada
          src={aberta.url}
          titulo={
            fotos.length > 1
              ? `${vendo.descricao} — foto ${naSequencia + 1} de ${fotos.length}`
              : vendo.descricao
          }
          onFechar={() => setVendo(null)}
          onAnterior={naSequencia > 0 ? () => void irPara(-1) : undefined}
          onProxima={
            naSequencia < fotos.length - 1 ? () => void irPara(1) : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * É foto ou é papel digitalizado em PDF?
 *
 * Pela extensão, que é o que a listagem do IXC traz — o tipo de verdade só
 * chega junto com o arquivo, e a decisão de como abrir precisa vir antes, no
 * rótulo do botão. Sem extensão, trata-se como arquivo comum: o palpite errado
 * abriria a tela cheia com um PDF que ela não sabe desenhar.
 */
function ehFoto(nota: NotaDoTitulo): boolean {
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp'].includes(
    nota.extensao.toLowerCase(),
  );
}
