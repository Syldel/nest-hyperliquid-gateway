import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { AppModule } from './app.module';
import { ValidationExceptionFilter } from './filters/validation-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  /* ********************************************** */

  const isProduction = process.env.NODE_ENV === 'production';

  // INFO: Avec origin: '*', il faut normalement mettre => credentials: false
  let origin: string | string[];
  if (isProduction) {
    const allowed = process.env.ALLOWED_ORIGINS;

    if (!allowed) {
      throw new Error(
        'ALLOWED_ORIGINS must be defined in production environment',
      );
    }

    origin = allowed.split(',').map((o) => o.trim());
  } else {
    origin = ['http://localhost:3000', 'http://localhost:3001'];
  }

  app.enableCors({
    origin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  /* ********************************************** */
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new ValidationExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
