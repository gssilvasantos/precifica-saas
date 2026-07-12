import { IsString, MinLength } from 'class-validator';

export class ConnectOlistDto {
  @IsString()
  @MinLength(10)
  apiToken!: string;
}
