import { Logger } from '@nestjs/common';
import { ConsoleAlertService } from './console-alert.service';

describe('ConsoleAlertService', () => {
  it('severidade ERROR loga em Logger.error, com o prefixo grepável e a origem', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new ConsoleAlertService();

    service.emitAlert({ source: 'OrderSyncOrchestrator', severity: 'ERROR', message: 'Sync falhou' });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ALERTA TÉCNICO] [OrderSyncOrchestrator] Sync falhou'),
    );
    errorSpy.mockRestore();
  });

  it('severidade WARNING loga em Logger.warn, nunca em Logger.error', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new ConsoleAlertService();

    service.emitAlert({ source: 'MercadoLivreConnectionService', severity: 'WARNING', message: 'Aviso' });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ALERTA TÉCNICO] [MercadoLivreConnectionService] Aviso'));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('inclui o contexto estruturado serializado na linha de log, quando informado', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new ConsoleAlertService();

    service.emitAlert({
      source: 'MercadoLivreConnectionService',
      severity: 'ERROR',
      message: 'Falha ao renovar token',
      context: { tenantId: 'tenant-1' },
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('{"tenantId":"tenant-1"}'));
    errorSpy.mockRestore();
  });

  it('sem contexto, a linha de log não tenta serializar undefined', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new ConsoleAlertService();

    service.emitAlert({ source: 'X', severity: 'ERROR', message: 'Y' });

    expect(errorSpy).toHaveBeenCalledWith('[ALERTA TÉCNICO] [X] Y');
    errorSpy.mockRestore();
  });
});
