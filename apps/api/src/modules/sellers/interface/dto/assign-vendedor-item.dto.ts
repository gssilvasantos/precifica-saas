import { IsString } from 'class-validator';

// Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026) — atribuição manual explícita de um vendedor a um item de
// pedido JÁ existente (ver CommissionService.assignVendedor). vendedorId
// vem da rota (:vendedorId), não do corpo.
export class AssignVendedorItemDto {
  @IsString()
  orderId!: string;

  @IsString()
  itemId!: string;
}
