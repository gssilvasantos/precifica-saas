import { IsIn } from 'class-validator';
import { ProductLotStatus } from '../../domain/product-lot';

export class UpdateProductLotStatusDto {
  @IsIn(['ATIVO', 'INATIVO'])
  status!: ProductLotStatus;
}
