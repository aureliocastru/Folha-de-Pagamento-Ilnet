import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { GravarGuiaDto, LerTextoDaGuiaDto } from './dto/guia.dto';
import { ImpostosService } from './impostos.service';

/** PDF de guia é pequeno; acima disso é arquivo errado. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

@Controller('impostos')
export class ImpostosController {
  constructor(private readonly service: ImpostosService) {}

  /**
   * Lê o PDF e devolve o que entendeu, sem gravar. A tela mostra para conferir
   * — só o POST seguinte grava.
   */
  @Post('guias/ler')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO } }),
  )
  ler(@UploadedFile(new ParseFilePipe()) arquivo: Express.Multer.File) {
    return this.service.ler(arquivo);
  }

  /**
   * O mesmo, para o PDF sem texto: o navegador leu a imagem e manda o que
   * reconheceu. Também não grava nada.
   */
  @Post('guias/ler-texto')
  @HttpCode(200)
  lerTexto(@Body() dto: LerTextoDaGuiaDto) {
    return this.service.lerDaImagem(dto);
  }

  @Post('guias')
  @HttpCode(201)
  gravar(@Body() dto: GravarGuiaDto, @Req() req: Request) {
    return this.service.gravar(dto, usuarioId(req));
  }

  @Get('guias')
  listar(@Query('competencia') competencia?: string) {
    return this.service.listar(competencia);
  }

  /**
   * Põe a guia na fila de pagamento do IXC.
   *
   * A guia já sai como conta a pagar quando é lançada; isto aqui é para as que
   * ficaram para trás — as de antes desta tela existir, e as em que o IXC não
   * respondeu na hora. Chamar duas vezes devolve a conta que já existe.
   */
  @Post('guias/:id/conta-a-pagar')
  @HttpCode(201)
  gerarConta(@Param('id') id: string, @Req() req: Request) {
    return this.service.gerarContaAPagar(id, usuarioId(req));
  }

  @Delete('guias/:id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }
}
