import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, mensagemErro } from '../lib/api';
import { emArvore } from '../lib/categorias';
import type { CategoriaDespesa } from '../lib/types';

/**
 * Valor da opção que abre a criação. Um cuid nunca começa com dois sublinhados,
 * então ele não colide com o id de categoria nenhuma — é o mesmo truque que a
 * opção "— tirar a categoria —" da classificação em lote já usava.
 */
const NOVA = '__nova';

/**
 * Prefixo da opção "— sem subcategoria —", que escolhe a própria mãe.
 *
 * Ela precisa de um valor **diferente** do da linha da mãe logo acima, embora
 * as duas escolham a mesma categoria. Com o mesmo valor, clicar nela cairia no
 * ramo que abre o grupo — o mesmo id, a mesma reação — e a opção não faria
 * nada além de reabrir a lista que já estava aberta. O prefixo é o que separa
 * "abre este grupo" de "para nesta categoria".
 */
const MAE = '__mae:';

interface Props {
  categorias: CategoriaDespesa[] | undefined;
  value: string;
  onChange: (id: string) => void;
  /** Rótulo da opção vazia: "Sem classificação", "Escolha a categoria…". */
  vazio: string;
  /** Opções extras, logo antes da de criar. */
  extras?: ReactNode;
  /**
   * Linha de ajuda sob o campo de nomear. Fica de fora na barra de seleção em
   * lote, que é escura e estreita: ali `ajuda` é cinza-médio sobre fundo quase
   * preto no tema claro, e a frase custaria mais do que explica.
   */
  ajuda?: string;
  carregando?: boolean;
  desabilitado?: boolean;
  id?: string;
  className?: string;
  title?: string;
}

/**
 * O seletor de categoria, com a criação embutida.
 *
 * Classificar um débito e cadastrar a categoria eram duas telas: quem estava
 * com a conta na frente e não achava a etiqueta certa tinha de sair daqui, ir
 * ao cadastro, criar, e voltar para achar o débito de novo. O caminho longo
 * custava a classificação — o débito ficava sem etiqueta, que é o que o
 * dashboard não sabe somar.
 *
 * A criação vive dentro do próprio seletor, e não num botão ao lado, porque é
 * ali que a falta é percebida: a pessoa abre a lista à procura de um nome, não
 * o encontra, e a saída está na mesma lista que ela já está lendo.
 */
export function SeletorDeCategoria({
  categorias,
  value,
  onChange,
  vazio,
  extras,
  ajuda,
  carregando = false,
  desabilitado = false,
  id,
  className = 'campo',
  title,
}: Props) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  /**
   * O grupo aberto agora, quando ele foi aberto por um clique e ainda não
   * levou a escolha nenhuma.
   *
   * Existe por um caso só: a pessoa troca de grupo e ainda não escolheu a
   * subcategoria. Nesse instante o `value` que veio de fora ainda é o antigo —
   * de propósito, ver o `escolher` —, e sem este estado a primeira lista
   * saltaria de volta para o grupo anterior no meio do gesto.
   *
   * `null` = siga o `value`, que é o caso normal e o de toda reabertura.
   */
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  /**
   * A recém-criada entra na lista à mão até a releitura chegar. Sem isto o
   * `value` apontaria, por um instante, para uma opção que ainda não existe, e
   * o campo apareceria em branco justo depois de a pessoa criar a categoria.
   */
  const [recemCriada, setRecemCriada] = useState<CategoriaDespesa | null>(null);
  const qc = useQueryClient();

  const criar = useMutation({
    mutationFn: async (n: string) =>
      (await api.post<CategoriaDespesa>('/categorias-despesa', { nome: n }))
        .data,
    onSuccess: (c) => {
      setRecemCriada(c);
      setCriando(false);
      setNome('');
      void qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
      // Ela foi criada para ser usada agora — deixar a escolha para um segundo
      // gesto é repetir, em menor escala, a viagem que este campo evita.
      onChange(c.id);
    },
  });

  const lista = categorias ?? [];
  const opcoes =
    recemCriada && !lista.some((c) => c.id === recemCriada.id)
      ? [...lista, recemCriada]
      : lista;

  const podeCriar = nome.trim().length >= 2 && !criar.isPending;

  function desistir() {
    setCriando(false);
    setNome('');
    criar.reset();
  }

  if (criando) {
    return (
      <div className={className === 'campo' ? '' : 'min-w-0'}>
        <div className="flex items-center gap-2">
          <input
            id={id}
            value={nome}
            autoFocus
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (podeCriar) criar.mutate(nome);
              }
              if (e.key === 'Escape') desistir();
            }}
            placeholder="Nome da nova categoria"
            className="campo min-w-0 flex-1"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => criar.mutate(nome)}
            disabled={!podeCriar}
            className="btn btn-primario shrink-0"
          >
            {criar.isPending ? 'Criando…' : 'Criar'}
          </button>
          <button
            type="button"
            onClick={desistir}
            disabled={criar.isPending}
            className="btn btn-neutro shrink-0"
          >
            Cancelar
          </button>
        </div>
        {criar.isError ? (
          <p className="mt-2 text-sm text-rose-600">
            {mensagemErro(criar.error)}
          </p>
        ) : (
          ajuda && <p className="ajuda">{ajuda}</p>
        )}
      </div>
    );
  }

  const { grupos, soltas } = emArvore(opcoes);

  /*
   * Que grupo a primeira lista está mostrando.
   *
   * Sai do `value`, que é sempre uma categoria só: se ela tem mãe, o grupo é a
   * mãe; se não tem, ela mesma é a linha de cima (uma solta, ou uma mãe
   * escolhida sem subcategoria). Valor que não é categoria nenhuma — vazio, ou
   * o `__limpar` da barra de seleção em lote — passa direto e a primeira lista
   * o mostra como está.
   */
  const doValor = opcoes.find((c) => c.id === value);
  const grupoDoValor = doValor ? (doValor.pai?.id ?? doValor.id) : value;
  const grupoAtivo = grupoAberto ?? grupoDoValor;
  const grupo = grupos.find((g) => g.mae.id === grupoAtivo) ?? null;

  /**
   * Emite a escolha e volta a seguir o `value`.
   *
   * Depois disto o `grupoDoValor` já responde certo — a categoria escolhida
   * sabe de quem é filha —, e manter o estado local só criaria uma segunda
   * fonte de verdade para a mesma pergunta.
   */
  function escolher(id: string) {
    setGrupoAberto(null);
    onChange(id);
  }

  /** O recuo das filhas. Espaço fixo: o normal seria colapsado pelo HTML. */
  const RECUO = '\u2007\u2007\u2007';

  /*
   * O nível de cima, em ordem alfabética, sem a mãe que está aberta.
   *
   * Soltas e mães na mesma lista: para quem procura, "Seguro" e "Custo com
   * Pessoal" são a mesma coisa — um nome do nível de cima. Qual das duas abre
   * mais coisa é detalhe do cadastro, e o negrito já conta isso.
   */
  const doTopo = [
    ...soltas.map((c) => ({ id: c.id, nome: c.nome, ehGrupo: false })),
    ...grupos.map((g) => ({ id: g.mae.id, nome: g.mae.nome, ehGrupo: true })),
  ]
    .filter((c) => c.id !== grupo?.mae.id)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  /*
   * O que o campo mostra fechado.
   *
   * Quase sempre é a categoria escolhida — inclusive a subcategoria, que é o
   * ponto: o campo tem de dizer "Fazenda", e não "Expansão", ou quem confere a
   * ficha do débito não vê o que foi classificado.
   *
   * A exceção é o instante em que se abriu um grupo e ainda não se escolheu
   * dentro dele. Aí a categoria antiga é de outro grupo e não está na lista —
   * as filhas dela estão recolhidas —, e um `value` que não bate com nenhuma
   * opção deixaria o campo em branco no meio do gesto. Nesse instante ele
   * mostra a mãe que se acabou de abrir, que é onde a pessoa está.
   */
  const valorAparece =
    !grupo ||
    value === grupo.mae.id ||
    grupo.filhas.some((f) => f.id === value);
  const selecionado = valorAparece ? value : grupoAtivo;

  return (
    /*
     * Uma lista só, que se reorganiza.
     *
     * A lista original mostrava as trinta e poucas categorias de uma vez —
     * sete grupos e as filhas de todos eles, abertos ao mesmo tempo. Cabia na
     * tela do cadastro, onde se lê a árvore inteira; não cabia aqui, que é
     * onde se **procura um nome**: rolar trinta linhas atrás de
     * "Confraternização" custava mais que a classificação valia, e o débito
     * ficava sem etiqueta — que é o que o dashboard não sabe somar.
     *
     * Aqui ela mostra só o nível de cima, oito ou nove nomes. Escolhida uma
     * mãe, **ela sobe para o topo** com as filhas dela embaixo, e as outras
     * mães continuam abaixo delas: o passo seguinte fica na primeira linha da
     * lista, e o resto continua ao alcance sem uma segunda ida a lugar nenhum.
     *
     * As mães vão em negrito. É o que diz, sem palavra nenhuma, quais linhas
     * abrem mais coisa e quais já são a escolha final.
     */
    <select
      id={id}
      className={className}
      title={title}
      value={selecionado}
      disabled={carregando || desabilitado}
      onChange={(e) => {
        const escolhido = e.target.value;

        if (escolhido === NOVA) {
          setCriando(true);
          return;
        }

        // "— sem subcategoria —": para na própria mãe, em vez de reabri-la.
        if (escolhido.startsWith(MAE)) {
          escolher(escolhido.slice(MAE.length));
          return;
        }

        const abriu = grupos.find((g) => g.mae.id === escolhido);
        if (abriu) {
          /*
           * Clicar na mãe abre o grupo; não classifica nada.
           *
           * Nada é emitido aqui de propósito. Metade das telas que usam este
           * campo salva no `onChange` — a ficha do débito classifica a conta
           * no ato —, e mandar o id da mãe gravaria uma etiqueta que a pessoa
           * não escolheu. Mandar vazio seria pior: apagaria a classificação
           * que já existia no meio de uma troca ainda não terminada.
           *
           * Quem quer mesmo a mãe sem subcategoria a encontra logo abaixo
           * dela, quando ela já etiqueta alguma conta.
           */
          setGrupoAberto(escolhido);
          return;
        }

        escolher(escolhido);
      }}
    >
      <option value="">{vazio}</option>

      {/* A mãe aberta e as filhas dela, no topo: é onde está o passo seguinte. */}
      {grupo && (
        <>
          <option value={grupo.mae.id} className="font-bold">
            {grupo.mae.nome}
          </option>
          {/*
            A mãe só é escolhível quando já etiqueta alguma conta. Grupo é
            cabeçalho — quem etiqueta é a subcategoria, senão o gasto para no
            nível de cima e o dashboard não tem o que destrinchar. Mas quem
            ganhou filhas depois de já ter contas etiquetadas continua na
            lista: tirá-la seria mudar, sem avisar, a etiqueta de contas já
            classificadas.

            O valor leva o prefixo `MAE` porque a linha de cima já usa o id
            puro para abrir o grupo: são a mesma categoria, mas dois pedidos
            diferentes.
          */}
          {grupo.mae.emUso > 0 && (
            <option value={`${MAE}${grupo.mae.id}`}>
              {RECUO}— sem subcategoria —
            </option>
          )}
          {grupo.filhas.map((c) => (
            <option key={c.id} value={c.id}>
              {RECUO}
              {c.nome}
            </option>
          ))}
        </>
      )}

      {doTopo.map((c) => (
        <option
          key={c.id}
          value={c.id}
          className={c.ehGrupo ? 'font-bold' : undefined}
        >
          {c.nome}
        </option>
      ))}

      {extras}
      <option value={NOVA}>+ Criar nova categoria…</option>
    </select>
  );
}
