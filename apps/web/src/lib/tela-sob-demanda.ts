import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { recarregarDoServidor } from '../components/AvisoDeVersaoNova';

/**
 * Uma tela que só se baixa quando é aberta.
 *
 * Até 13/10/2026 o app inteiro — as cem telas de todos os módulos — vinha num
 * pacote só, de 1,4 MB, e o celular do técnico baixava e montava a folha, a
 * contabilidade e o RH antes de mostrar a tela de pontuação, a única que ele
 * abre. Agora o primeiro acesso traz o esqueleto, e cada tela vem na hora em
 * que se entra nela (e fica guardada no aparelho: o nome do arquivo muda a
 * cada versão, e o nginx manda guardar).
 *
 * O cuidado é a versão nova: a página aberta antes dela pede o pedaço pelo
 * nome velho, que já não existe no servidor, e o import falha. Isso se
 * resolve recarregando a página — uma vez só, para um servidor fora do ar não
 * virar recarga em círculo; na segunda falha o erro aparece.
 */
// O mesmo `any` do `lazy` do React: é ele que deixa a tela manter as props dela.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function telaSobDemanda<C extends ComponentType<any>>(
  carregar: () => Promise<C>,
): LazyExoticComponent<C> & { preCarregar: () => void } {
  let pedido: Promise<{ default: C }> | null = null;
  const buscar = () => {
    pedido ??= carregar().then(
      (componente) => {
        esquecerRecarga();
        return { default: componente };
      },
      (erro: unknown) => {
        pedido = null; // a próxima tentativa pede de novo
        throw erro;
      },
    );
    return pedido;
  };
  const abrir = () =>
    buscar().catch((erro: unknown) => {
      if (recarregarUmaVez()) return new Promise<never>(() => {});
      throw erro;
    });
  return Object.assign(lazy(abrir), {
    // Só quem abre a tela recarrega a página. O pré-carregamento roda por
    // baixo, com alguém talvez digitando: falhando, fica calado, e quem abrir
    // a tela tenta de novo.
    preCarregar: () => void buscar().catch(() => {}),
  });
}

const TRAVA = 'tela.recarregouEm';
/** Duas falhas dentro disto são o servidor com problema, e não versão nova. */
const JANELA_MS = 30_000;

function recarregarUmaVez(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(TRAVA) ?? 0);
    if (Date.now() - ultima < JANELA_MS) return false;
    sessionStorage.setItem(TRAVA, String(Date.now()));
  } catch {
    return false;
  }
  recarregarDoServidor();
  return true;
}

function esquecerRecarga(): void {
  try {
    sessionStorage.removeItem(TRAVA);
  } catch {
    /* sem sessionStorage, sem trava a limpar */
  }
}

/**
 * Baixa, sem pressa, as telas que se vai abrir em seguida — as do módulo em
 * que se está. Espera o aparelho ficar ocioso, para não disputar a rede com a
 * tela que está carregando agora.
 */
export function preCarregarQuandoOcioso(telas: Array<{ preCarregar: () => void }>): () => void {
  const fazer = () => telas.forEach((t) => t.preCarregar());
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fazer, { timeout: 5_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fazer, 2_000);
  return () => clearTimeout(id);
}
