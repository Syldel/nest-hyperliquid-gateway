# Sur quoi s'appuyer pour décider d'un modèle de données

Ce dépôt traduit l'API d'Hyperliquid en types partagés (`@syldel/hl-shared-types`) que le
bot et l'application mobile consomment. Chaque champ déclaré ici est une **affirmation sur
ce que l'exchange rend**, et une affirmation fausse ne se voit pas : elle se paie plus tard,
sur un dimensionnement ou un affichage.

Ce document dit où chercher avant d'affirmer, et ce que chaque source peut ou ne peut pas
établir.

## Trois sources, et ce que chacune prouve

Elles ne forment pas une hiérarchie où la meilleure remplacerait les autres : **elles
couvrent des terrains différents**, et la bonne question est « laquelle peut trancher
*ceci* ? ».

### 1. La mesure de première main

Captures du gateway (`nest-trading-bot/captures/`, variable `GATEWAY_CAPTURE_FILE`),
lectures via les routes `/hyperliquid/info/*`, relevés dans le navigateur.

- **Prouve** qu'une forme existe, et c'est la seule source qui le fasse. Un `null` observé
  une fois clôt la question de la nullité d'un champ.
- **Ne prouve pas** l'inverse : mille valeurs présentes n'établissent pas qu'un champ soit
  toujours là. L'asymétrie est totale, et c'est elle qui décide du sens dans lequel on peut
  conclure.
- **Se décrit honnêtement.** « 22 entrées » n'est pas « 22 observations » si ce sont 22
  instantanés de la même position : noter le nombre d'**états distincts**, le ou les coins,
  le ou les dex, et les modes couverts. Un échantillon d'une paire sur un dex HIP-3 ne dit
  rien du dex principal.

### 2. La documentation officielle

<https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api>

- **Fait autorité** sur les noms de champs, les types de requête et le chemin nominal.
- **Est construite sur un exemple par endpoint**, donc muette sur ce qui *varie*. Deux cas
  rencontrés : `liquidationPx` n'y apparaît qu'en chaîne alors qu'il peut valoir `null` ;
  `collateralToken` est absent de l'exemple de `meta` mais présent dans celui de
  `metaAndAssetCtxs`, pour un champ que les cinq dex rendent.
- Un champ absent d'un exemple n'est donc **ni absent de l'API, ni optionnel**.

### 3. Le SDK Python officiel

Première partie, et **typé** — ce que la doc en prose n'est pas :

[`hyperliquid-dex/hyperliquid-python-sdk`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk),
`hyperliquid/utils/types.py` : des `TypedDict`, des `Union`, des `Literal`, des `Optional`.

**Sur quoi repose le mot « officiel »**, parce que le nom de l'organisation n'y suffit pas —
n'importe qui peut créer `hyperliquid-dex` :

- la **page d'API de la documentation** ne se contente pas de le lister, elle le
  **distingue** : les trois autres bibliothèques y portent une attribution communautaire
  explicite (« written by community member », « written by members of the community »),
  celle-ci non ;
- **PyPI** le corrobore par une autre chaîne : le paquet `hyperliquid-python-sdk` déclare
  `author: "Hyperliquid"` et `author_email: "hello@hyperliquid.xyz"` — le domaine de
  l'exchange, celui de `api.hyperliquid.xyz`. Sa version 0.24.0 est publiée le
  2026-06-04T19:47Z, à deux minutes du `pushed_at` du dépôt GitHub : les deux pistes mènent
  au même artefact.

⚠️ Ce qui ne l'établit **pas**, et qu'il ne faut pas invoquer : l'organisation GitHub rend
`is_verified: false` et déclare `blog: hyperfoundation.org`. GitHub n'atteste donc pas son
domaine, et son `name: "Hyperliquid"` est déclaratif — exactement ce qu'une imitation
afficherait. La conclusion est portée par la doc de l'exchange et par PyPI, pas par
l'organisation.

Et ce qui reste non vérifié : **qui le maintient au quotidien**. « Publié par l'exchange »
n'est pas « suivi par l'équipe ».

- **Tranche les questions de forme** que la doc laisse en suspens : unions discriminées,
  champs propres à une variante, valeurs énumérées, nullité. C'est de l'information de
  première partie, exprimée dans le registre exact dont on a besoin ici.
- **Est particulièrement utile quand la mesure est étroite** : il couvre les branches qu'un
  compte de développement n'a jamais exercées.

### Ce qui *ressemble* à une source officielle sans l'être

La page d'API renvoie aussi vers des bibliothèques **écrites par la communauté**, et le dit :
un SDK Rust (`infinitefield/hypersdk`), deux SDK TypeScript (`nktkas/hyperliquid`,
`nomeida/hyperliquid`), et les intégrations CCXT. Il n'existe donc **aucun SDK TypeScript de
première partie**.

**Être lié par la documentation officielle n'est pas être de première partie.** Le lien
donne de la visibilité, pas de l'autorité : ces projets lisent la même API que nous et
peuvent s'être trompés de la même façon. Ils servent à **repérer** une question — « celui-là
déclare ce champ nullable, pourquoi ? » — jamais à la clore.

Le piège est le SDK TypeScript : même langage, même système de types, on a envie d'y recopier
une union toute faite. C'est précisément celui à ne pas croire sur parole.

Un dépôt de l'organisation `hyperliquid-dex` n'est pas non plus un blanc-seing. Relevé le
2026-10-04, par appel direct à l'API GitHub sur chaque dépôt :

| dépôt | dernier `push` | ce qu'en dit la doc d'API |
| --- | --- | --- |
| `hyperliquid-python-sdk` | 2026-06-04 | présenté comme le SDK Python |
| `hyperliquid-rust-sdk` | **2025-10-21** | **pas mentionné** — la doc renvoie au SDK communautaire |

Onze mois sans écriture, et la documentation qui oriente ailleurs : c'est le risque
« un client retarde sur le serveur » rendu concret. Ce dépôt se lit comme un indice, pas
comme une référence.

⚠️ Et sur la méthode : un relevé de l'organisation entière, résumé par un outil, s'est
révélé faux sur ce dépôt (donné comme un *fork* Python, alors que l'API dit `fork: false` et
`description: null`). **Interroger chaque dépôt séparément**, et citer le champ lu.

## Le cas qui a fait écrire ce document

`HLPerpLeverage` déclarait `rawUsd` **obligatoire** pour les deux modes de marge. Le faux
gateway du bot devait donc forcer une assertion de type pour construire une position cross
plausible — ce qu'un double n'a pas le droit de faire.

Aucune des deux premières sources ne pouvait trancher :

- les captures ne contenaient que des leviers `cross`, tous en `{ type, value }` nus, sur
  **une seule paire** d'un seul dex : rien sur l'isolé ;
- l'exemple de la doc de `clearinghouseState` ne montre qu'une position **isolée**, qui
  porte `rawUsd` : rien sur le cross.

Le SDK Python déclare les deux, et l'affaire est close :

```python
CrossLeverage    = TypedDict("CrossLeverage",    {"type": Literal["cross"],    "value": int})
IsolatedLeverage = TypedDict("IsolatedLeverage", {"type": Literal["isolated"], "value": int,
                                                  "rawUsd": str})
Leverage = Union[CrossLeverage, IsolatedLeverage]
```

C'est la forme qu'a prise `HLPerpLeverage` en 0.0.23 — union discriminée sur `type`, et non
`rawUsd?: DecimalString`, parce qu'un optionnel rendrait le champ lisible sans vérifier le
mode et que `Number(undefined)` rend `NaN` sans un mot.

## Ce que le SDK Python ne règle pas

Il est de première partie, pas infaillible, et le citer ne dispense pas de mesurer :

- **C'est un client.** Il peut retarder sur le serveur, ou ne couvrir que ce dont il a
  besoin. Un `Literal[...]` dit ce que le SDK accepte, pas nécessairement tout ce que
  l'exchange émet.
- **Il ne type pas tout.** Relevé le 2026-10-04 : `types.py` déclare `Leverage` mais
  **aucun** type de position — ni `liquidationPx`, ni `entryPx`, ni `assetPositions`. Son
  silence n'est pas une réponse.
- **Il ne dit rien de l'état d'un compte.** « Ce dex rend-il `collateralToken` ? », « ce
  marché est-il délisté ? », « mon compte est-il unifié ? » sont des questions de mesure.
- **Les conventions diffèrent.** Python écrit `int` là où TypeScript n'a que `number` ; les
  décimaux voyagent en `str`, ce que `DecimalString` traduit. Ne pas recopier un type, en
  lire la **structure**.

## Un cas où la documentation et la mesure se contredisent : modifier un ordre à déclencheur

Relevé le 2026-10-27, page `exchange-endpoint` de la doc officielle (sections « Cancel order(s) », « Modify an order »).

- **`modify` et `batchModify` ont un drapeau optionnel `a` (`always_place`).** Avec `a = true`, le nouvel ordre est posé que
  l'annulation de l'ancien ait réussi ou non. Avec `a = false`, la doc dit que le nouvel ordre **doit être un ordre sans
  déclencheur**, en `Alo` ou en `Gtc` non exécutable. `a` doit être **omis** quand il vaut `false` : une action hachée avec
  `a: false` est rejetée.
- **`cancel` et `cancelByCloid` ont un drapeau optionnel `f` (`fast`).** Avec `f: true`, la doc dit que l'ordre est rejeté s'il
  désigne un ordre à déclencheur ; `f` n'a aujourd'hui aucun autre effet et doit lui aussi être omis quand il vaut `false`.
- **Notre code n'envoie jamais ni `a` ni `f`** (aucune occurrence dans `src/`). Il est donc, selon la doc, dans le cas
  `always_place = false`.

**La mesure dit le contraire, aujourd'hui.** Des ordres à déclencheur ont été modifiés sans `a`, et acceptés : le
réalignement des protections par `batchModify` (quatre réalignements, quatre `updated`, zéro repli, voir
`nest-trading-bot/docs/trading/professional-practices.md`) et, le 2026-10-27, deux `modify` d'un stop de position (le second
vers un déclencheur déjà franchi). Lue à la lettre, la doc aurait rejeté chacun de ces ordres.

**Piste datée, relevée le 2026-10-27 : les deux drapeaux sont récents.** Ce n'est qu'une piste — la règle de ce document veut que
seule une source de première partie conclue, et ce qui suit vient d'un SDK communautaire et d'un miroir tiers de l'annonce :

- **L'annonce du canal API** : message 327, du **2026-06-11**, qui date `a` six jours avant le SDK. Texte relevé sur un miroir
  tiers (voir plus bas, « Ce que le canal d'annonces dit »).
- **Le SDK nktkas/hyperliquid** (communautaire) a ajouté `a` à `modify`/`batchModify` (PR #145, le **2026-06-17**) et `f` à
  `cancel`/`cancelByCloid` (PR #146, le **2026-06-17** aussi), soit environ quatre mois avant cette lecture. Les trois PR ont été
  relus **en brut** le 2026-10-27 (`api.github.com` : JSON, diff et commentaires) :
  - **#145** a pour auteur un contributeur (`roscoe-infinex`), pas le mainteneur, qui l'a fusionné après un seul commentaire,
    « Thanks for your contribution! ». Son corps écrit que Hyperliquid a ajouté `always_place`, « announced in the HL API
    channel » (messages 325 et 327 ; `https://t.me/hyperliquid_api/327`), et dit n'avoir pas pu lancer la partie réseau des
    tests, qui demande une clé testnet financée. Sa phrase sur l'application future est donc une lecture de la doc, pas une
    observation ;
  - **#146** (le mainteneur) ne cite **aucune annonce**, seulement la documentation officielle. Côté SDK, la récence de `f` ne
    repose que sur la date de ce PR ;
  - **#157** (le mainteneur, **2026-06-19**) : son corps n'est que le modèle de PR, cases non cochées ; il n'explique rien. Son
    titre dit « executable and trigger modifies », et son diff pose `a: true` dans les tests de `modify` **et** `batchModify`, pour
    des ordres exécutables (Ioc, FrontendMarket, Gtc) **et** à déclencheur (TP, SL), en supprimant les échantillons dédiés ajoutés
    par #145. Ces tests sont joués sur le testnet. Le motif n'est pas écrit : un alignement sur la doc, ou des tests qui
    échouaient parce que le testnet applique la règle ? **Rien ne tranche.**
- **Le SDK Python officiel** (première partie), `master` lu le 2026-10-27 : ses actions `batchModify`, `cancel` et
  `cancelByCloid` ne portent ni `a` ni `f`. Ce silence n'est pas une réponse (voir plus haut : il ne type pas tout, et il peut
  simplement être en retard).
- **Nos propres modèles** : `hl-shared-types` date du 2026-01-15, et ses interfaces `cancel` et `modify` n'ont pas été touchées
  depuis le 2026-01-18. Elles précèdent donc juin 2026 : leur silence est cohérent avec des drapeaux récents, sans le prouver
  à lui seul.

**Lecture la plus plausible, non prouvée : la règle est annoncée mais pas encore appliquée.** L'auteur du PR #145 écrit que
« Once HL enforces the new semantics », un `modify` visant un ordre à déclencheur (TP/SL) sera rejeté sans `a: true`. Cela
s'accorde avec nos mesures — des `modify` d'ordres à déclencheur acceptés sans `a`, y compris le 2026-10-27 — sans rien forcer.
**Mais l'annonce elle-même ne dit pas cela** : elle décrit une capacité et n'annonce ni rejet, ni date d'application, ni un mot
sur les TP/SL. « Once HL enforces » est la déduction du contributeur, tirée de la doc. La doc, elle, ne parle d'une « future mise
à niveau du réseau » que pour l'effet de `f` sur le mempool ; pour `a` et pour le rejet des ordres à déclencheur par `f: true`,
elle écrit au présent.

⚠️ **Ce qui n'est pas établi :**

- **La date d'application**, et si la règle l'est déjà dans un cas ou sur le testnet : rien ici ne la donne. L'annonce Telegram
  a été relevée en partie (messages 326, 327 et 329, sur un miroir tiers) : l'annonce du 2026-06-11 borne la date de `a` par le
  haut, aucun message lu ne fixe la date d'application. Les messages 325, 328, 330 (environ 20 h avant le PR #157), 331 et tous
  les suivants (le canal va au moins jusqu'au 350, le 2026-08-05) ne sont pas lus. La doc, relue **en brut** (`curl`, sans outil qui
  résume) le 2026-10-27, n'aide pas : la page de l'endpoint (120 880 octets, en entier), celle des erreurs et celle de la latence
  ne montrent ni date ni « last updated », et l'index `llms.txt` (159 lignes) ne liste aucune page de journal des changements,
  d'annonces ou de mises à niveau. Ces changements ne s'annoncent donc que sur le canal Telegram de l'API : à suivre par une
  personne, aucun test ne les verra.
- **Que la règle vise ce que le PR en dit** : c'est la lecture d'un tiers (un contributeur du SDK), ni un énoncé de l'exchange ni
  celui de son annonce. L'hypothèse d'un cas plus étroit (le nouvel ordre posé quand l'annulation a échoué, ou un ordre modifié
  **en** ordre exécutable ou à déclencheur, comme le dit l'annonce) n'est pas écartée.
- **La lecture des PR** avait d'abord été faite par un outil qui résume ; refaite **en brut** le 2026-10-27, elle a confirmé les
  citations et corrigé deux paraphrases de ce document (le corps et le périmètre du #157). Deux autres, dans
  `nest-trading-bot/docs/known-gaps.md`, ont été corrigées de même. **Le SDK Python** : la façon dont il a été lu n'est pas
  notée.
- **Ce que la doc ne donne pas pour `modify`** (relue en brut le 2026-10-27) : la section `modify` a deux onglets de réponse,
  « Successful Response » et « Error Response », **vides** ; la section `batchModify` n'en a aucun. La forme d'une réponse de
  modification, et celle de son refus, ne sont donc écrites nulle part. La doc place en revanche `a` **au niveau de l'action**,
  après `order` (`modify`) ou `modifies` (`batchModify`) : un seul drapeau pour tout un lot.

### Ce que le canal d'annonces dit (messages 326, 327 et 329, relevés le 2026-10-27)

**Le statut de ce relevé : un miroir tiers.** Le canal Telegram `hyperliquid_api` (« Hyperliquid API Announcements », 2 878
abonnés) n'expose pas ses textes sur le web : `t.me/hyperliquid_api/<n>?embed=1&mode=tme` rend le numéro, la minute et le nombre
de vues, puis « Please open Telegram to view this post », et `t.me/s/hyperliquid_api` ne montre que la carte du canal. Les trois
textes ont été **collés par l'utilisateur depuis Telemetr.io**, un agrégateur : la règle de ce document veut qu'on n'en tire que
ce qu'une source de première partie recoupe. Sont recoupés : les numéros et les minutes (Telemetr affiche l'heure locale de
l'utilisateur, UTC+2 en juin, soit l'heure de `t.me` plus deux heures, minute pour minute), et, pour deux points, la doc officielle
lue en brut. Ne l'est pas : la formulation exacte.

- **326** (2026-06-09, 11:36 UTC) : les fréquences d'envoi de plusieurs abonnements **WebSocket** changent « à la prochaine mise à
  niveau » (`l2Book`, `allMids`, `spotAssetCtxs`, `allDexsAssetCtxs`, `webData2`), puis corrigées par le message 327. **Aucun
  usage chez nous** : aucune occurrence de `WebSocket` ni de `wss://` dans `src/` du gateway, du bot et de l'application mobile
  (relevé du 2026-10-27). `l2Book` et `allMids` n'apparaissent que dans le gateway, comme types de requête REST `info` (la table
  des poids du garde de débit, et un appel `l2Book` dans `hyperliquid-api-public-info.service.ts`), jamais comme abonnement.
  À relire le jour où l'un des trois passera au WebSocket.
- **327** (2026-06-11, 10:48 UTC) : `modify` et `batchModify` « now support » un champ optionnel « always place », qui permet de
  modifier un ordre **en** un ordre exécutable ou à déclencheur, pour des parcours « less common » où une modification doit
  s'exécuter au lieu de rester au carnet. C'est **la date de `a`**, six jours avant le SDK. Le libellé est celui d'une
  **capacité** : ni rejet, ni date d'application, ni TP/SL n'y figurent. Il s'accorde avec la page de l'endpoint (ce que
  `a = false` interdit) ; il ne dit pas si la modification d'un ordre à déclencheur **vers** un ordre à déclencheur est comprise,
  et la mesure du 2026-10-27 montre qu'elle est acceptée sans `a`, au moins sur le mainnet.
- **329** (2026-06-17, 09:41 UTC — en plein dans la vie du PR #146, ouvert à 08:55 et fusionné à 10:12 UTC ; aucun lien établi) :
  - les frais prioritaires de lecture et d'écriture sont dans le périmètre du bug bounty, avec un correctif sur l'obtention de la
    priorité ALO par des ordres non ALO : sans objet pour nous, qui n'en utilisons pas ;
  - **`f`** : « no disadvantage » à envoyer `f: true` ; la seule différence est que l'annulation **ne marche pas pour les ordres à
    déclencheur**. Recoupé avec la doc brute (page de l'endpoint et page de latence). Le mot « clarification » suppose une annonce
    antérieure de `f`, que nous n'avons pas ;
  - **le minimum d'ordre** : à la prochaine mise à niveau, la formule devient prévisible, fondée sur le **prix limite** d'un ordre
    au repos et sur le **prix de première exécution** d'un ordre exécutable, **au lieu du prix mark**.

⚠️ **Le minimum d'ordre : une piste, non mesurée.** La date de la mise à niveau est inconnue (probablement passée au 2026-10-27,
rien ne l'établit), et on ignore ce que « prix de première exécution » vaut pour un ordre à déclencheur qui se déclenche. Deux
endroits encodent le minimum de 10 $ : `domain/order-minimum.ts` du bot (mesuré le 2026-10-20, voir
`nest-trading-bot/docs/known-gaps.md`) et le contrôle local du gateway (`smart-order.service.ts`, `sz × price <= 10`, avec un
TODO), calculé sur son propre prix. Le verdict de l'exchange fait autorité, pas ce contrôle : à mesurer avant de supposer qu'ils
s'accordent. Les mesures du bot (fermeture complète exemptée, bande 10–11 $ remplie, reliquat de 1,2 $ rejeté) ne semblent pas
distinguer l'ancienne base de la nouvelle : lecture, non éprouvée.

**Ce que ça change pour le risque** — et il ne tient pas à l'adoption de l'ordre de position :

- **Le réalignement d'aujourd'hui y est exposé.** Il passe par `batchModify` sur les ordres `reduceOnly` à déclencheur (stops et
  take-profits de protection) et n'envoie jamais `a`. Si la règle était appliquée, chacun de ces `modify` serait refusé. La route
  `position-protective/modify` n'a pas de repli et échouerait bruyamment.
- **Ce que le réalignement fait d'un refus, depuis le 2026-10-27** (`smart-order.service.ts`, `placeBatchProtectiveOrders`). On
  ignore quelle forme l'exchange emploierait ; quatre sont possibles, lues dans le code, aucune observée :
  - un refus **par ordre** dans une réponse `ok` (`statuses[i].error`) : inchangé. `Failed to modify order` dans le journal, puis
    repli par annulation + recréation, avec la seconde sans protection que `batchModify` évitait. Ce repli a maintenant un test,
    il n'en avait aucun ;
  - une réponse qui n'est **pas un `ok`** — l'enveloppe `{ status: 'err', response }` en HTTP 200, `{}`, `null`, rien. _Avant_ : le
    bloc sautait sans un mot, les annulations et les créations du même passage partaient, et le gateway rendait un compte rendu
    d'apparence normale ; le bot lisait `protected` dès que ce compte rendu n'était pas vide, et ne signalait « rien appliqué »
    que pour un plan fait seulement de modifications. _Maintenant_ : le refus est journalisé en erreur avec la réponse brute dès
    qu'il arrive (`batchModify of N protective order(s) refused as a whole`), le plan continue, puis le gateway lève
    `EXCHANGE_BATCH_MODIFY_REFUSED` en **422**, dont le message porte la réponse brute et ce que l'exchange a accepté du reste du
    plan ;
  - un `ok` dont les statuts **ne se comptent pas un par modification** : un seul statut pour un lot de deux, une liste vide ou
    absente (ni `data`, ni `response`), un statut de trop. _Avant_ : `if (!status) return;` sautait sans un mot les modifications
    sans statut ; un statut d'erreur isolé déclenchait le repli annulation + recréation pour le **seul premier** ordre, et la
    modification du stop disparaissait sans trace (reproduit avec un double le 2026-10-27) ; une liste ou des `data` absents
    levaient un `TypeError` **avant** l'envoi des annulations et des créations, donc un stop manquant n'était même pas posé.
    _Maintenant_ : rien n'est attribué (ni `updated`, ni repli par ordre), le gateway journalise la réponse brute
    (`batchModify of N protective order(s) answered ok with K status(es), which cannot be matched one to one`), termine le plan,
    puis lève **422 `EXCHANGE_BATCH_MODIFY_UNMATCHED`**. Un code distinct de `…_REFUSED`, parce que « refusé » serait faux pour une
    liste trop longue, et que ce cas dit autre chose : une forme de réponse jamais vue, à mesurer. Ce que la doc en dit est plus
    bas ;
  - une erreur HTTP : l'exception remonte (`MAX_RETRIES = 1`, pas de relance), donc bruyante.
- **Pourquoi le plan continue avant de lever.** Lever dès le refus laissait sans stop une position dont le stop manque et dont un
  TP périmé est refusé : mesuré dans une copie jetable le 2026-10-27, l'ancien code posait le stop, une version qui lève d'emblée
  ne le posait pas. Ce qui protège part d'abord, l'échec vient après.
- **Pourquoi 422 et non 502.** Le bot lit une 5xx d'écriture comme `UNKNOWN_ORDER_STATE` et abandonne le passage de **toutes** les
  paires (`nest-trading-bot`, `gateway-errors.ts`, `mustAbortPass`) ; une 4xx est une réponse claire, contenue à sa paire
  (`Failed to realign protective orders`, paire `unprotected` avec la raison). Le gateway emploie déjà 422 pour ses refus clairs.
  ⚠️ C'est un couplage avec la classification du bot : si elle change, ce choix devient faux sans qu'un test le dise (les tests
  figent le numéro, pas la raison).
- **Le signal précoce compte donc quatre traces** : `Failed to modify order` (refus par ordre), `refused as a whole` et
  `cannot be matched one to one` dans le journal du gateway, et, côté bot, `Failed to realign protective orders` suivi de
  `EXCHANGE_BATCH_MODIFY_REFUSED` ou `EXCHANGE_BATCH_MODIFY_UNMATCHED`. Un `cancelled` non nul au retour de `batch-protective`
  reste la trace du repli par ordre.

- **`a: true` n'a pas été mesuré sur un stop, et n'est pas à activer sans mesure** : il poserait le nouvel ordre même si
  l'annulation avait échoué, par exemple parce que l'ancien venait de se déclencher. L'envoyer demanderait aussi les types
  partagés (champ optionnel, **omis** quand il est faux : jamais `a: false`), le gateway, puis le bot — un changement qui traverse
  les trois dépôts, à coordonner par un tag — et de savoir où la clé se place dans l'action signée (la doc la montre au niveau de
  l'action, donc valable pour tout le lot ; mais la signature hache l'action sérialisée, l'ordre des clés peut compter : inféré,
  non vérifié dans notre code).
- **`f: true` n'est pas utilisable pour annuler un stop ou un take-profit** (la doc, la page de latence et le message 329 le
  disent). Si un chemin d'urgence veut un jour une annulation prioritaire, elle ne vaudra pas pour les ordres à déclencheur.

⚠️ **Ce qui n'est toujours pas établi pour ce durcissement :**

- **Le texte réel d'un refus** de `modify` sur un déclencheur : les tests emploient un libellé marqué « placeholder », que le code
  ne lit pas. La doc ne le donne pas non plus (voir plus haut : onglets de réponse vides). Que `err` veuille dire « rien n'a été
  modifié » est le sens du format, non mesuré pour un lot : le message dit « not reported as applied » et demande de relire le
  carnet.
- **Que l'erreur unique de pré-validation existe pour un `batchModify`, et sous quelle enveloppe** (`err`, ou `ok` avec un seul
  statut). La page des erreurs, lue en brut, décrit ce cas pour les **ordres et les annulations** : une pré-validation en échec
  rend une seule erreur pour tout le lot, la réponse pouvant être dupliquée n fois avant d'être remise au callback, et elle
  recommande de traiter ce cas. Elle ne dit pas qui duplique, ni sur le fil ni dans le SDK, ni rien de `modify`. Les deux
  enveloppes sont couvertes, aucune n'est observée. Elle dit aussi que ces erreurs sont une fonction déterministe du payload ; la
  règle de `a` en est peut-être une (type de l'ordre et drapeau), mais sa clause « GTC non exécutable » dépend du carnet :
  **inféré, non tranché**.
- **Avec une seule modification, un unique statut est lu comme celui de cet ordre** (repli par annulation + recréation), alors
  qu'une erreur de pré-validation de tout le lot lui est alors indiscernable : un test le fige, sans pouvoir le résoudre. Et quand
  les nombres ne concordent pas, **rien** n'est attribué, même un `resting` isolé : on préfère sous-déclarer (le message demande
  de relire le carnet) que créditer le mauvais ordre.
- **Côté bot**, la réaction à un 422 est lue dans le code, pas exercée avec ce gateway, et le faux gateway du bot
  (`gateway-contract.ts`) ne modélise pas ce refus.
- **Pas de repli annulation + recréation pour un lot refusé en entier** : sa cause est inconnue, et ce repli ouvre une fenêtre sans
  protection. À décider quand on connaîtra le texte réel du refus.
- **Trois trous voisins, non traités** : un échec de l'annulation (réponse non `ok`) est seulement journalisé, une création qui
  reçoit une réponse non `ok` lève un `TypeError`, et un élément `null` ou absent dans une liste **de la bonne longueur** est
  encore sauté par `if (!status) return;`. Le même mécanisme (consigner, finir, lever) pourrait les couvrir.
- **Si une écriture suivante du même plan lève avant la fin**, le refus n'existe plus que dans le journal (un test le fige).

C'est le cas inverse de celui qui a fait écrire ce document : ici la doc est précise et la mesure la dément **à la lettre** —
probablement parce que la règle n'est pas encore appliquée. Aucune des deux ne dispense de l'autre.

## La règle qui précède les trois

**Seules les sources de première partie concluent** : l'exchange, sa documentation, son SDK
Python, et la mesure. Les sites agrégateurs, billets de blog et réponses d'assistants
conversationnels ne sont pas conservés, même quand ils tombent juste — on ne peut pas
distinguer après coup ce qu'ils ont vérifié de ce qu'ils ont supposé, et une affirmation
dont on ne peut plus remonter l'origine n'est pas une source.

Le reste — SDK communautaires, CCXT, dépôts de l'organisation que la doc n'appuie plus —
**ouvre** des questions sans les clore. C'est utile : une divergence entre deux
implémentations signale l'endroit exact où aller mesurer. Mais la conclusion se tire
ailleurs, et le commentaire qui en naît cite la source qui a tranché, pas celle qui a
alerté.

Et dans tous les cas : **citer où et quand**. Un chemin de fichier dans un SDK, un endpoint
et une date de relevé, le nombre d'états distincts observés. C'est ce qui permet à la
personne suivante de contredire la conclusion au lieu de devoir la refaire.

## Lire une page de documentation en brut

**Une page de documentation, de SDK ou de dépôt se lit en brut. Un outil qui résume (un
`WebFetch` qui rend « l'essentiel » d'une page) peut aider à repérer quelle page lire ; il ne
sert jamais à conclure.**

C'est la règle ci-dessus appliquée à la lecture elle-même : dans ce qu'un résumé rend, on ne
distingue pas ce qui a été lu de ce qui a été reformulé ou complété. Et l'erreur n'est pas
théorique, elle a été mesurée ici :

- **Une précision qui n'était pas dans le texte** (2026-10-27, page des erreurs d'Hyperliquid).
  Lue par un outil qui résume, elle disait que l'erreur unique d'une pré-validation en échec est
  répliquée par les SDK « pour retomber sur la longueur du lot ». Le texte brut dit seulement que
  la réponse peut être dupliquée n fois avant d'être remise au callback (« could be duplicated n
  times before being sent to the callback function »), sans dire qui duplique, ni pourquoi. La
  paraphrase figurait dans les commentaires du correctif proposé ; la relecture en brut l'a
  corrigée avant l'application. La décision de code tenait, pas son explication — et c'est
  l'explication que la personne suivante croit.
- **Une page lue en partie sans que ça se voie.** La page de l'endpoint (environ 120 000
  caractères) n'avait d'abord été lue que sur ses 100 000 premiers. Seul le fichier entier permet
  d'écrire qu'un mot n'y figure pas.
- **Des citations exactes, des paraphrases fausses** (PR du SDK communautaire, relus en brut le
  2026-10-27). Les deux phrases citées étaient littérales ; autour d'elles, un corps de PR « vide »
  était le modèle de PR non rempli, des tests « d'ordres à déclencheur » couvraient aussi les ordres
  exécutables et `batchModify`, et une annonce attribuée aux deux drapeaux ne l'était qu'à un seul.

**Comment**

1. **Prendre le Markdown.** Chaque page de la documentation Hyperliquid (GitBook) existe en
   `.md` en ajoutant `.md` à son URL ; la page l'annonce en tête, et l'index de toutes les pages
   est `https://hyperliquid.gitbook.io/hyperliquid-docs/llms.txt`. Un `curl -sSL -o <fichier> <url>.md`,
   avec `-w '%{http_code} %{size_download}\n'` pour lire le code HTTP et la taille, dans le dossier
   jetable de la session et non dans un dépôt. Une fois par page, et on garde le fichier : c'est
   un site de documentation et non l'API, mais il n'y a pas de raison de le solliciter en boucle.
2. **Noter la taille.** Le nombre d'octets reçus est ce qui dénonce une troncature.
3. **Lire le fichier, ou le chercher en entier** (l'outil de lecture, `grep` sur le fichier
   complet), pas la page rendue. « La doc ne mentionne pas X » ne s'écrit qu'après une recherche
   sur le texte entier.
4. **Une page qui n'existe pas en Markdown, ou un dépôt GitHub** : le texte de la page dans le
   navigateur interne, ou le contenu brut (`gh api`, `raw.githubusercontent.com`) — le JSON d'un
   PR, pas un résumé de PR.

**Ce qu'on écrit ensuite**

- Une lecture se date et dit comment elle a été faite : « lue en brut le 2026-10-27 ».
- **Une citation est littérale, courte, et dans la langue d'origine.** Une traduction ou une
  paraphrase ne se met pas entre guillemets : le guillemet affirme un texte que la page n'a pas.
- **Ce qui n'a été vu qu'à travers un résumé se marque**
  `⚠️ lu par un outil qui résume — à relire en brut`, **et ne fonde aucun comportement du code**
  tant que ce n'est pas relu. La lecture des PR du SDK communautaire, d'abord faite par un
  résumé, a été refaite en brut le 2026-10-27 (section sur `modify`, plus haut). Restent dans ce
  cas la façon dont a été lu le SDK Python, qui n'est pas notée, et les textes des messages du
  canal d'annonces, relevés sur un miroir tiers.
- **Dire aussi ce que la page ne dit pas, avec sa portée** : « ne parle que des ordres et des
  annulations » n'est pas « ne parle pas des modifications ».
