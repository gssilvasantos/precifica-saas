import { PartialType } from '@nestjs/mapped-types';
import { CreatePackagingDto } from './create-packaging.dto';

export class UpdatePackagingDto extends PartialType(CreatePackagingDto) {}
