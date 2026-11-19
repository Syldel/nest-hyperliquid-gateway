import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  hlMarketKind,
  hlPerpDexOf,
  type HLTrailingStopAction,
} from '@syldel/hl-shared-types';

import { AssetRegistryService } from './asset-registry.service';
import { HyperliquidApiTradeService } from './hyperliquid-api-trade.service';
import { HyperliquidApiPublicInfoService } from './hyperliquid-api-public-info.service';
import { HyperliquidGatewayException } from '../exceptions/hyperliquid-gateway.exception';
import {
  activationSideRefusal,
  buildTrailingStopAction,
  readTrailingStopAnswer,
  TrailingStopRequest,
  TrailingStopRequestError,
} from '../utils/trailing-stop-action';

export interface TrailingStopParams extends TrailingStopRequest {
  assetName: string;
}

export interface PlacedTrailingStop {
  oid: number;
  /** L'action telle qu'elle a été signée : ce qui a réellement été posé, valeurs canoniques comprises. */
  action: HLTrailingStopAction;
}

/**
 * ============================================================================
 * POSER UN TRAILING STOP NATIF, EN PLUS DU STOP DU BOT
 *
 * Le trailing stop d'Hyperliquid (2026-09-21) est un ordre de l'exchange, que
 * l'exchange fait suivre lui-même. Il s'ajoute au stop-loss du bot et ne le
 * remplace jamais : le bot ne le compte pas comme sa protection et le laisse
 * en place (garde-fou du 2026-11-16, `PROTECTIVE_KIND_BY_ORDER_TYPE`).
 *
 * Ce que ce service garantit, dans cet ordre :
 *
 * 1. **un perp**, du dex principal ou d'un dex HIP-3, et rien d'autre. Le
 *    spot et les outcomes n'ont pas de trailing stop (« available for perp
 *    markets »). HIP-3 est ouvert le 2026-11-19, et mesuré le même jour
 *    sur `xyz:BRENTOIL` (actif 110049) : pose acceptée, suivi et annulation
 *    comme au dex principal (`docs/trailing-stop.md`, S7 de la sonde) ;
 * 2. **des valeurs déjà sur la grille**, refusées sinon (400), jamais
 *    tronquées : voir `buildTrailingStopAction` ;
 * 3. **une activation du bon côté du marqué** : au-dessus pour une vente, en
 *    dessous pour un achat. L'exchange accepte l'autre côté et suit tout de
 *    suite, sans rien dire (mesuré le 2026-11-17) ;
 * 4. **une réponse lue, pas supposée** : l'oid d'un ordre posé, le texte d'un
 *    refus, ou une issue inconnue qui dit qu'il faut relire les ordres ouverts.
 *
 * **Aucune relance.** L'action n'a pas de `cloid` : un second envoi après une
 * réponse perdue poserait un second stop suiveur, que rien ne distinguerait du
 * premier. `executeWithNonce` n'en fait aucune (`MAX_RETRIES = 1`), et ce
 * service traduit toute panne après l'envoi en issue inconnue.
 *
 * La modification n'existe pas : ni la doc ni l'interface officielle n'en
 * proposent pour ce type. Remplacer, c'est poser le nouveau puis annuler
 * l'ancien par `POST /hyperliquid/order/cancel` — et le suivi repart du prix
 * courant. L'annulation n'a donc pas de route ici.
 * ============================================================================
 */
@Injectable()
export class TrailingStopService {
  private readonly logger = new Logger(TrailingStopService.name);

  constructor(
    private readonly assetRegistry: AssetRegistryService,
    private readonly tradeService: HyperliquidApiTradeService,
    private readonly publicInfoService: HyperliquidApiPublicInfoService,
  ) {}

  async placeTrailingStop(
    params: TrailingStopParams,
    isTestnet = false,
  ): Promise<PlacedTrailingStop> {
    const action = this.toAction(params);
    await this.requireActivationSide(params.assetName, action, isTestnet);
    this.logger.log(`Place trailing stop: ${JSON.stringify(action)}`);

    let reply: unknown;
    try {
      reply = await this.tradeService.placeTrailingStop(action, isTestnet);
    } catch (error) {
      // Un refus local (agent, débit) est levé AVANT l'envoi : il dit vrai, on
      // le laisse passer. Toute autre panne a pu survenir après que l'exchange
      // a reçu l'action.
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Trailing stop outcome unknown: ${message}`);
      throw new HyperliquidGatewayException(
        'EXCHANGE_OUTCOME_UNKNOWN',
        `The trailing stop request failed (${message}). It may have been placed: read the open orders before anything else.`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // La réponse brute s'écrit, succès compris : tant qu'aucune n'a été
    // mesurée, le journal est une pièce du dossier.
    const raw = JSON.stringify(reply);
    this.logger.log(`Trailing stop answer: ${raw}`);

    const answer = readTrailingStopAnswer(reply);
    switch (answer.kind) {
      case 'placed':
        return { oid: answer.oid, action };
      case 'refused':
        throw new HyperliquidGatewayException(
          'EXCHANGE_TRAILING_STOP_REFUSED',
          `Hyperliquid refused the trailing stop: ${answer.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      case 'unknown':
        throw new HyperliquidGatewayException(
          'EXCHANGE_UNEXPECTED_RESPONSE',
          `Unexpected Hyperliquid answer for a trailing stop: ${raw}. It may have been placed: read the open orders before anything else.`,
          HttpStatus.BAD_GATEWAY,
        );
    }
  }

  /**
   * Refuse une activation du mauvais côté du marqué (voir `activationSideRefusal`). Le marqué n'est lu que s'il y a une
   * activation : un suivi immédiat ne coûte aucune lecture. Lecture `metaAndAssetCtxs`, poids 20, la même que les ordres
   * instantanés. Un marqué illisible refuse l'ordre : on ne signe pas ce qu'on n'a pas pu contrôler.
   */
  private async requireActivationSide(
    assetName: string,
    action: HLTrailingStopAction,
    isTestnet: boolean,
  ): Promise<void> {
    if (action.activationPx === null) return;

    // Le marqué se lit sur le dex de la paire : lu au dex principal, celui
    // d'un HIP-3 manquait, et la pose était refusée (« No mark price »).
    const markets = await this.publicInfoService.getPerpMarketsWithPrices(
      hlPerpDexOf(assetName) ?? '',
      isTestnet,
    );
    const markPx = markets.find((m) => m.name === assetName)?.markPrice;
    if (markPx === undefined) {
      throw new HyperliquidGatewayException(
        'INVALID_MARKET_DATA',
        `No mark price for ${assetName}: the activation side cannot be checked, nothing was signed`,
      );
    }

    const refusal = activationSideRefusal(
      action.isBuy,
      action.activationPx,
      markPx,
    );
    if (refusal) {
      throw new HyperliquidGatewayException(
        'TRAILING_STOP_ACTIVATION_WRONG_SIDE',
        refusal,
      );
    }
  }

  private toAction(params: TrailingStopParams): HLTrailingStopAction {
    const { assetName } = params;

    const kind = hlMarketKind(assetName);
    if (kind !== 'perp' && kind !== 'builderPerp') {
      throw new HyperliquidGatewayException(
        'TRAILING_STOP_MARKET_UNSUPPORTED',
        `Trailing stops are placed on perps only, not on ${assetName}`,
      );
    }

    const asset = this.assetRegistry.getAssetId(assetName);
    const szDecimals = this.assetRegistry.getSzDecimals(assetName);
    if (asset === undefined || szDecimals === undefined) {
      throw new HyperliquidGatewayException(
        'UNKNOWN_ASSET',
        `Unknown asset: ${assetName}`,
      );
    }
    // Le nom et l'identifiant doivent dire le même genre : un perp du dex
    // principal sous 10 000, un HIP-3 à partir de 100 000. Un registre qui les
    // ferait diverger signerait pour un autre marché que celui demandé.
    const idMatches =
      kind === 'perp'
        ? this.assetRegistry.isPerpById(asset)
        : this.assetRegistry.isBuilderById(asset);
    if (!idMatches) {
      throw new HyperliquidGatewayException(
        'TRAILING_STOP_MARKET_UNSUPPORTED',
        `${assetName} resolves to asset ${asset}, which is not a ${kind === 'perp' ? 'main-dex' : 'HIP-3'} perp`,
      );
    }

    try {
      return buildTrailingStopAction(params, { asset, szDecimals });
    } catch (error) {
      if (error instanceof TrailingStopRequestError) {
        throw new HyperliquidGatewayException(
          'TRAILING_STOP_INVALID',
          error.message,
        );
      }
      throw error;
    }
  }
}
