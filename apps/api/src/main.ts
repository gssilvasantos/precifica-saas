import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Tipado como NestExpressApplication (em vez do INestApplication genérico)
  // só porque useBodyParser (abaixo) é específico do adapter Express.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Sprint 27 (Pick & Pack) — chunks de vídeo chegam como base64 dentro do
  // corpo JSON (mesma simplificação consciente de AttachMediaDto, evitando
  // multipart/FileInterceptor). O limite default do body-parser (100kb)
  // rejeitaria até um chunk pequeno de vídeo depois da inflação de ~33% do
  // base64 — 15mb cobre um timeslice de alguns segundos com folga, sem abrir
  // mão do limite (evita que um payload absurdo prenda o event loop).
  app.useBodyParser('json', { limit: '15mb' });

  // Prefixo /api para todas as rotas — deixa claro na infra (proxy, gateway)
  // o que é API vs. o que será o frontend no futuro.
  app.setGlobalPrefix('api');

  // Validação automática de DTOs em todos os controllers (class-validator).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos não declarados no DTO
      forbidNonWhitelisted: true, // rejeita payloads com campos extras
      transform: true,
    }),
  );

  app.enableCors();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API rodando em http://localhost:${port}/api`);
}

bootstrap();
