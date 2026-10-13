import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { recarregarDoServidor } from './AvisoDeVersaoNova';

/**
 * Segura o erro de uma tela dentro dela.
 *
 * Sem isto, qualquer erro ao desenhar uma tela — um dado que veio diferente do
 * esperado, um pedaço do app que não baixou — apagava o sistema inteiro: tela
 * branca, sem menu, e o único jeito de sair era fechar e abrir de novo. Agora
 * a tela com problema mostra o aviso, e o menu continua funcionando para ir a
 * outra.
 *
 * Trocar de endereço apaga o aviso: o erro de uma tela não segue a pessoa
 * para a próxima. Sem `key`, de propósito — remontar a cada endereço jogaria
 * fora o estado das telas que mudam o próprio endereço sem sair dela.
 */
export function TelaProtegida({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Protecao caminho={pathname}>{children}</Protecao>;
}

interface Props {
  caminho: string;
  children: ReactNode;
}

class Protecao extends Component<Props, { erro: Error | null }> {
  state: { erro: Error | null } = { erro: null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidUpdate(anterior: Props) {
    if (anterior.caminho !== this.props.caminho && this.state.erro) {
      this.setState({ erro: null });
    }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Fica no console do aparelho, para quem for investigar.
    console.error('Erro na tela:', erro, info.componentStack);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <p className="font-display text-lg font-semibold text-tinta-900">Esta tela deu erro.</p>
        <p className="mt-2 break-words text-[12px] text-tinta-500">{erro.message}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => this.setState({ erro: null })}
            className="btn btn-ferramenta"
          >
            Tentar de novo
          </button>
          <button type="button" onClick={recarregarDoServidor} className="btn btn-primario">
            Recarregar o app
          </button>
        </div>
      </div>
    );
  }
}
