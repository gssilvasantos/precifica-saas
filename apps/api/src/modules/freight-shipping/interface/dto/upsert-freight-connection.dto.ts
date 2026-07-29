import { IsNotEmpty, IsObject, IsString } from 'class-validator';

// `credential` é deliberadamente `Record<string, unknown>` (não tipado por
// provider) — cada provider define seu próprio formato (ver
// *Credential interfaces em infrastructure/*/*-api.client.ts); validar campo
// a campo aqui exigiria um DTO novo a cada transportadora, o mesmo motivo
// pelo qual FreightProviderConnection.credentialEnc guarda um JSON opaco.
export class UpsertFreightConnectionDto {
  @IsString()
  @IsNotEmpty()
  providerCode!: string;

  @IsObject()
  credential!: Record<string, unknown>;
}
