import { NestFactory } from '@nestjs/core';
import { LOG_LEVELS, Logger, LogLevel, ValidationPipe } from '@nestjs/common';

import { AppModule } from './app.module';
import { ValidationExceptionFilter } from './filters/validation-exception.filter';

async function bootstrap() {
  const logger = new Logger('bootstrap');

  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, { logger });

  /* ********************************************** */

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

  /* ********************************************** */

  // Ex: LOG_LEVELS=error,warn,log,debug
  const envLogLevels = process.env.LOG_LEVELS;

  const defaultLevels: LogLevel[] = isProduction
    ? ['error', 'warn']
    : ['log', 'debug', 'warn', 'error', 'verbose'];

  const levels: LogLevel[] = envLogLevels
    ? envLogLevels
        .split(',')
        .map((item) => item.trim().toLowerCase() as LogLevel)
        .filter((level) => LOG_LEVELS.includes(level))
    : defaultLevels;

  app.useLogger(levels.length > 0 ? levels : defaultLevels);

  /* ********************************************** */

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`\uf427  App running on port ${port} (internal)`);
}
void bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
