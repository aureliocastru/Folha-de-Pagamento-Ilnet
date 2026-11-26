import { Injectable } from '@nestjs/common';
import { numeroDoIxc } from '../almoxarifado/estoque.mapper';
import { montarFicha, type FichaDaOs } from './ficha';
import { OsDoIxcService } from './os-do-ixc.service';
import { OsService, type Login } from './os.service';

/**
 * A ficha da OS, montada para o técnico: o que o IXC põe no papel do
 * "matricial modelo 1", mais o telefone do cliente e o ponto no mapa.
 *
 * É só leitura, e é a OS do próprio técnico: quem entra passa pelo mesmo
 * `OsService.contexto` do resto da tela dele — OS de outro técnico não abre
 * ficha aqui.
 *
 * Os quatro cadastros do IXC vão juntos, numa só ida (ver `ficha.ts` para o
 * que se lê de cada um); o nome da caixa e a cidade do cliente vão depois,
 * porque o número delas está nos cadastros. Nada fica guardado: o telefone
 * que o atendimento acabou de corrigir e o login que caiu agora são o motivo
 * de o técnico abrir esta tela. Só a cidade, a UF e o nome da caixa ficam,
 * que são cadastro de nome de lugar.
 */
@Injectable()
export class FichaDeOsService {
  constructor(
    private readonly os: OsService,
    private readonly doIxc: OsDoIxcService,
  ) {}

  async ficha(login: Login, osId: number): Promise<FichaDaOs> {
    const { os } = await this.os.contexto(login, osId);
    const [assuntos, cliente, contrato, usuario, cidadeDaOs] = await Promise.all([
      this.doIxc.nomesDosAssuntos(),
      this.doIxc.cadastroDaFicha('cliente', os.clienteId),
      this.doIxc.cadastroDaFicha('cliente_contrato', os.contratoId),
      this.doIxc.cadastroDaFicha('radusuarios', os.loginId),
      this.doIxc.cidade(os.cidadeId),
    ]);
    const [caixa, cidade] = await Promise.all([
      this.doIxc.nomeDaCaixa(numeroDoIxc(usuario?.id_caixa_ftth)),
      // A OS nem sempre traz a cidade; quando não traz, é a do cadastro do
      // cliente — de onde o IXC a copia ao abrir a OS pelo endereço dele.
      cidadeDaOs ?? this.doIxc.cidade(numeroDoIxc(cliente?.cidade)),
    ]);
    return montarFicha(os, {
      assunto: assuntos.get(os.assuntoId) ?? null,
      cliente,
      contrato,
      login: usuario,
      caixa,
      cidade,
    });
  }
}
