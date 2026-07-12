import { IsDateString, IsString } from 'class-validator';

export class CreatePromotionCampaignDto {
  @IsString()
  name!: string;

  @IsString()
  channelCode!: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;
}
