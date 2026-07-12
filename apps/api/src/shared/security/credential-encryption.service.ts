import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Criptografia simétrica (AES-256-GCM) para credenciais de integração em
// repouso — hoje só o token do Olist (OlistConnection.apiTokenEnc), mas
// vive em shared/ porque é infraestrutura genérica: o próximo módulo que
// precisar guardar uma credencial de terceiro (Nuvemshop, Shopee push de
// preço) reusa isto em vez de reinventar.
//
// Simplificação consciente para este estágio: a chave vem de uma env var
// (ERP_CREDENTIALS_ENCRYPTION_KEY), não de um KMS gerenciado. Documentar no
// README que essa variável precisa existir em produção com um valor forte
// e nunca commitado — trocar por AWS KMS/GCP KMS/Vault é um adapter, não uma
// reescrita, se/quando isso for necessário.
@Injectable()
export class CredentialEncryptionService implements OnModuleInit {
  private readonly logger = new Logger(CredentialEncryptionService.name);
  private key!: Buffer;

  onModuleInit() {
    const secret = process.env.ERP_CREDENTIALS_ENCRYPTION_KEY;
    if (!secret) {
      this.logger.warn(
        'ERP_CREDENTIALS_ENCRYPTION_KEY não definida — usando uma chave de desenvolvimento fixa. ' +
          'NÃO use isso em produção; defina a variável de ambiente com um segredo forte.',
      );
    }
    this.key = scryptSync(secret ?? 'dev-only-insecure-key', 'precifica-erp-integration', 32);
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Formato: iv.authTag.cipherText, tudo em base64 — autocontido, sem
    // precisar de tabela auxiliar para guardar o IV.
    return [iv, authTag, encrypted].map((b) => b.toString('base64')).join('.');
  }

  decrypt(cipherPayload: string): string {
    const [ivB64, authTagB64, dataB64] = cipherPayload.split('.');
    if (!ivB64 || !authTagB64 || !dataB64) {
      throw new Error('Payload de credencial criptografada em formato inesperado.');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
