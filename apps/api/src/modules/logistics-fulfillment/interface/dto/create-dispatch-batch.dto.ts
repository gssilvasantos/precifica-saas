import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Projeto Estruturante 5 (Catálogo de Transportador/Serviço, benchmark Bling
// ERP, 29/07/2026) — integração puramente ADITIVA: formaEnvio virou opcional
// porque agora o operador pode informar carrierServiceId no lugar (resolvido
// para uma string formaEnvio em DispatchBatchesController.create ANTES de
// chamar o DispatchBatchService.createBatch existente, que nunca muda de
// assinatura). Exatamente um dos dois deve vir preenchido — validado no
// controller, não aqui, porque é uma regra de "ou um ou outro" entre dois
// campos, fora do escopo de um único decorator de class-validator.
export class CreateDispatchBatchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  formaEnvio?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  carrierServiceId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
