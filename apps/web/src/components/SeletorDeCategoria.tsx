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

  return (
    /*
     * Duas listas em vez de uma.
     *
     * A lista única mostrava as trinta e poucas categorias de uma vez, com as
     * mães em negrito e as filhas recuadas por baixo. Cabia na tela do
     * cadastro, onde se lê a árvore inteira; não cabia aqui, que é onde se
     * **procura um nome**: rolar trinta linhas atrás de "Confraternização" no
     * meio de sete grupos custava mais que a classificação valia, e o débito
     * ficava sem etiqueta — que é o que o dashboard não sabe somar.
     *
     * Agora a primeira lista tem só o nível de cima, sete ou oito nomes, e a
     * segunda só aparece quando o grupo escolhido tem o que abrir.
     */
    <div className="min-w-0 space-y-2">
      <select
        id={id}
        className={className}
        title={title}
        value={grupoAtivo}
        disabled={carregando || desabilitado}
        onChange={(e) => {
          const escolhido = e.target.value;

          if (escolhido === NOVA) {
            setCriando(true);
            return;
          }

          const abriu = grupos.find((g) => g.mae.id === escolhido);
          if (abriu) {
            /*
             * Grupo escolhido não vira classificação: ele abre a segunda
             * lista e espera.
             *
             * Nada é emitido aqui de propósito. Metade das telas que usam este
             * campo salva no `onChange` — a ficha do débito classifica a conta
             * no ato —, e mandar o id da mãe gravaria uma etiqueta que a
             * pessoa não escolheu. Mandar vazio seria pior: apagaria a
             * classificação que já existia no meio de uma troca que ela ainda
             * não terminou.
             *
             * Quem quer mesmo a mãe sem subcategoria a encontra na segunda
             * lista, quando ela já etiqueta alguma conta.
             */
            setGrupoAberto(escolhido);
            return;
          }

          escolher(escolhido);
        }}
      >
        <option value="">{vazio}</option>
        {/* As soltas e as mães na mesma lista, em ordem alfabética: para quem
            procura, "Seguro" e "Custo com Pessoal" são a mesma coisa — um nome
            do nível de cima. Qual das duas abre uma segunda lista é detalhe do
            cadastro, e não da procura. */}
        {[
          ...soltas.map((c) => ({ id: c.id, nome: c.nome, grupo: false })),
          ...grupos.map((g) => ({
            id: g.mae.id,
            nome: g.mae.nome,
            grupo: true,
          })),
        ]
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {/* A seta avisa que ali tem mais coisa dentro, e é o que evita a
                  segunda lista aparecer como surpresa. */}
              {c.grupo ? `${c.nome} ›` : c.nome}
            </option>
          ))}
        {extras}
        <option value={NOVA}>+ Criar nova categoria…</option>
      </select>

      {grupo && (
        <select
          className={className}
          aria-label={`Subcategoria de ${grupo.mae.nome}`}
          value={
            // A escolha só é desta lista quando ela é o próprio grupo ou uma
            // filha dele; senão a segunda lista abre em branco, esperando.
            value === grupo.mae.id ||
            grupo.filhas.some((f) => f.id === value)
              ? value
              : ''
          }
          disabled={carregando || desabilitado}
          onChange={(e) => escolher(e.target.value)}
        >
          <option value="">Escolha em {grupo.mae.nome}…</option>
          {/*
            A mãe só é escolhível quando já etiqueta alguma conta. Grupo é
            cabeçalho — quem etiqueta é a subcategoria, senão o gasto para no
            nível de cima e o dashboard não tem o que destrinchar. Mas quem
            ganhou filhas depois de já ter contas etiquetadas continua na lista:
            tirá-la seria mudar, sem avisar, a etiqueta de contas já
            classificadas.
          */}
          {grupo.mae.emUso > 0 && (
            <option value={grupo.mae.id}>
              {grupo.mae.nome} (sem subcategoria)
            </option>
          )}
          {grupo.filhas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
