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

  return (
    <select
      id={id}
      className={className}
      title={title}
      value={value}
      disabled={carregando || desabilitado}
      onChange={(e) => {
        if (e.target.value === NOVA) {
          setCriando(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">{vazio}</option>
      {/* As soltas primeiro: opção fora de `optgroup` depois de um grupo
          aparece como se tivesse escapado dele. */}
      {soltas.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
        </option>
      ))}
      {grupos.map(({ mae, filhas }) => (
        <optgroup key={mae.id} label={mae.nome}>
          {/*
            A mãe só é escolhível quando já etiqueta alguma conta. Grupo é
            cabeçalho — quem etiqueta é a subcategoria, senão o gasto para no
            nível de cima e o dashboard não tem o que destrinchar. Mas quem
            ganhou filhas depois de já ter contas etiquetadas continua na lista:
            tirá-la seria mudar, sem avisar, a etiqueta de contas já
            classificadas.
          */}
          {mae.emUso > 0 && (
            <option value={mae.id}>{mae.nome} (sem subcategoria)</option>
          )}
          {filhas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </optgroup>
      ))}
      {extras}
      <option value={NOVA}>+ Criar nova categoria…</option>
    </select>
  );
}
