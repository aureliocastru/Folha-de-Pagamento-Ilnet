import { PainelDePontos } from '../../components/PainelDePontos';
import { CabecalhoPagina, Pagina } from '../../components/ui';
import { api } from '../../lib/api';

/**
 * O painel de pontuar, visto de dentro do sistema.
 *
 * É o mesmo que o coordenador usa no portal, sem login novo: quem é ADMIN já
 * entrou no sistema. A diferença está na API — o ADMIN apaga qualquer
 * lançamento, e o coordenador só os dele.
 */
export function Pontuar() {
  return (
    <Pagina>
      <CabecalhoPagina
        secao="Pontuação"
        titulo="Pontuar"
        descricao="Todos os funcionários, os pontos do mês e a posição de cada um. Toque em alguém para dar ou tirar pontos."
      />
      <PainelDePontos cliente={api} base="/pontuacao" />
    </Pagina>
  );
}
