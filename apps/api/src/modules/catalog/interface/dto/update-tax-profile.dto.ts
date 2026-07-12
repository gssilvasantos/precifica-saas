import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxProfileDto } from './create-tax-profile.dto';

export class UpdateTaxProfileDto extends PartialType(CreateTaxProfileDto) {}
