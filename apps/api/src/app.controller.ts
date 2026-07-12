import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // Health check simples — usado por Docker/monitoramento para saber se a API está de pé.
  @Get('health')
  health() {
    return { status: 'ok', service: 'precifica-api', timestamp: new Date().toISOString() };
  }
}
