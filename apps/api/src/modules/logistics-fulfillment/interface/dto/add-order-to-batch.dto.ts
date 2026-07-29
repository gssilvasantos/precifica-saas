import { IsNotEmpty, IsString } from 'class-validator';

export class AddOrderToBatchDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}
