import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMonitoredListingDto {
  @IsString()
  @IsNotEmpty()
  skuCode!: string;

  @IsString()
  @IsNotEmpty()
  competitorLabel!: string;

  @IsString()
  @IsNotEmpty()
  targetRef!: string;

  @IsString()
  @IsNotEmpty()
  radarCode!: string;

  @IsOptional()
  @IsString()
  channelCode?: string;
}
