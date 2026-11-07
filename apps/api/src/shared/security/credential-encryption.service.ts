import { Injectable, OnModuleInit } from '@nestjs/common';
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
//
// Falha alta na inicialização se a env var faltar (achado de auditoria de
// segurança, 20/10/2026, mesma categoria do fallback de JWT_SECRET corrigido
// no mesmo lote): antes disto, a ausência da variável só gerava um
// `logger.warn` e o serviço seguia criptografando credenciais de terceiro
// (Olist, Nuvemshop, Mercado Livre) com a chave fixa 'dev-only-insecure-key'
// — sem travar a inicialização. Isso contraria .claude/rules/security.md
// ("Falhe alto na inicialização quando faltar variável obrigatória.
// Fallback silencioso para chave de desenvolvimento em produção é
// incidente, não conveniência") e o próprio comentário deste arquivo, que já
// dizia "NUNCA aceitável em produção" mas não impedia.
@Injectable()
export class CredentialEncryptionService implements OnModuleInit {
  private key!: Buffer;

  onModuleInit() {
    const secret = process.env.ERP_CREDENTIALS_ENCRYPTION_KEY;
    if (!secret) {
      throw new Error(
        'ERP_CREDENTIALS_ENCRYPTION_KEY não está definida. Configure essa variável de ambiente antes de ' +
          'iniciar a aplicação — nunca existe um valor padrão de desenvolvimento aqui (ver .env.example).',
      );
    }
    this.key = scryptSync(secret, 'precifica-erp-integration', 32);
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
