import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * Une décimale positive écrite en clair : ni signe, ni exposant. `IsNumberString` accepterait `"-1"` ou `"1e3"`, et une
 * valeur qui part vers un hachage signé ne se laisse pas interpréter.
 */
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;
const PLAIN_DECIMAL_MESSAGE =
  '$property must be a plain positive decimal string';

/**
 * Le repli : un pourcentage (`"10"` pour 10 %) ou une distance en prix. « Exactement un des deux » se contrôle dans
 * `buildTrailingStopAction`, qui refuse aussi les valeurs hors grille.
 */
export class TrailingRetracementDto {
  @IsOptional()
  @IsString()
  @Matches(PLAIN_DECIMAL, { message: PLAIN_DECIMAL_MESSAGE })
  pct?: string;

  @IsOptional()
  @IsString()
  @Matches(PLAIN_DECIMAL, { message: PLAIN_DECIMAL_MESSAGE })
  px?: string;
}

/**
 * Un trailing stop natif (`POST /orders/trailing-stop`).
 *
 * `reduceOnly` est **obligatoire** et non déduit : un stop suiveur qui ferme une position et un ordre qui en ouvre une
 * sont deux intentions, et l'appelant doit dire laquelle. Le ValidationPipe global refuse toute propriété inconnue
 * (`forbidNonWhitelisted`), `cloid` compris : l'action n'en a pas.
 */
export class TrailingStopDto {
  @IsString()
  assetName: string;

  /** Côté de l'ORDRE : `false` est une vente, le stop d'un long. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isBuy: boolean;

  @IsString()
  @Matches(PLAIN_DECIMAL, { message: PLAIN_DECIMAL_MESSAGE })
  sz: string;

  @IsDefined()
  // Le texte d'un formulaire se lit ; tout le reste arrive tel quel à `IsBoolean`, qui refuse. Pas de `false` par défaut.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  reduceOnly: boolean;

  @IsDefined()
  @ValidateNested()
  @Type(() => TrailingRetracementDto)
  retracement: TrailingRetracementDto;

  /** Absent : le suivi commence tout de suite. */
  @IsOptional()
  @IsString()
  @Matches(PLAIN_DECIMAL, { message: PLAIN_DECIMAL_MESSAGE })
  activationPx?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isTestnet?: boolean;
}
