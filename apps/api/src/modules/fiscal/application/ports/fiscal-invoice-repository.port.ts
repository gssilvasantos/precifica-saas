import {
  FiscalAuthorizationResult,
  FiscalErrorResult,
  FiscalInvoice,
  FiscalInvoiceCreateData,
} from '../../domain/fiscal-invoice.entity';

export interface FiscalInvoiceRepository {
  create(data: FiscalInvoiceCreateData): Promise<FiscalInvoice>;
  findById(tenantId: string, id: string): Promise<FiscalInvoice | null>;
  findByFocusRef(focusRef: string): Promise<FiscalInvoice | null>;
  findAllByOrder(tenantId: string, orderId: string): Promise<FiscalInvoice[]>;
  findAllByTenant(tenantId: string, status?: string): Promise<FiscalInvoice[]>;
  markProcessing(id: string): Promise<FiscalInvoice>;
  markAuthorized(id: string, result: FiscalAuthorizationResult): Promise<FiscalInvoice>;
  markError(id: string, result: FiscalErrorResult): Promise<FiscalInvoice>;
  markCancelled(id: string, cancelReason: string): Promise<FiscalInvoice>;
}

export const FISCAL_INVOICE_REPOSITORY = Symbol('FISCAL_INVOICE_REPOSITORY');
