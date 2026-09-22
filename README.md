# Playwright — dossier CSS/DOM pour IA

Ce projet collecte plusieurs pages et états d’un composant, conserve une archive détaillée et génère un dossier compact pour une IA. Une deuxième commande appelle OpenAI, Claude ou Gemini pour proposer un fichier CSS Angular. La génération est contrôlée statiquement ; la compilation Angular et la comparaison visuelle restent à effectuer.

## Générer le CSS avec tes sessions Claude Code / Codex / Gemini CLI

Prérequis : Node.js >= 20.12, et `claude`, `codex` ou `gemini` disponible dans le PATH et déjà connecté à ton compte. **Aucune clé API, aucun fichier `.env` requis.** Le script lance le CLI officiel avec ta session enregistrée.

```sh
npm run collect
npm run ia:claude -- --dry-run
# Choisir un fournisseur :
npm run ia:claude
npm run ia:chatgpt
npm run ia:gemini
# Alias explicite de ia:chatgpt :
npm run ia:codex
```

- `ia:claude` lance `claude -p` avec une sortie JSON structurée.
- `ia:gemini` lance `gemini -p` avec une sortie JSON structurée.
- `ia:chatgpt` / `ia:codex` lancent `codex exec` avec un schéma JSON et récupèrent la réponse finale.

Pour établir la connexion si nécessaire : ouvrir `claude` et utiliser `/login`, lancer `codex login` ou authentifier `gemini`. Les commandes npm utilisent l’authentification propre au CLI ; elles ne lisent ni ne copient les fichiers de jetons. Elles retirent `OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY` et `GEMINI_API_KEY` de l’environnement enfant. Les autres réglages d’authentification du CLI restent sous ton contrôle : vérifier la session enregistrée pour utiliser l’abonnement voulu.

Une génération consomme les limites de ton compte selon les règles de ton fournisseur ; elle n’est pas illimitée. `--dry-run` prépare les fichiers sans lancer le CLI et sans consommer de génération. Il n’y a pas de relance automatique par le wrapper ; les CLI gèrent leurs échanges internes et leurs propres retries.

### Prompt, modèle et collecte

Le prompt commun est **`prompts/regenerate-css.md`**. Il précise la conversion Angular, la cascade, les frontières des composants, la provenance Ionic et les limites de couverture. Chaque définition source doit être classée dans le rapport du modèle.

```sh
npm run ia:claude -- --input artifacts/DATE --component fbr-button --model opus
npm run ia:gemini -- --input artifacts/DATE --model gemini-2.5-pro
npm run ia:chatgpt -- --input artifacts/DATE --prompt prompts/regenerate-css.md
npm run ia:chatgpt -- --help
```

Le modèle configuré dans le CLI est utilisé par défaut. `--model` permet d’en choisir un autre, ainsi que les variables `CLAUDE_MODEL` / `CODEX_MODEL` / `GEMINI_MODEL` du shell. Aucune sélection de modèle API n’est imposée. Les identifiants disponibles dépendent de ton CLI et de ton compte.

Sans `--input`, la commande utilise la collecte la plus récente dans `artifacts`. Une collecte en échec/incomplète bloque l’envoi ; elle n’est pas remplacée silencieusement par une ancienne. Un seul type de composant est produit par exécution : il est déduit des cibles ; si plusieurs tags sont présents, fournir `--component`.

### Résultat et contrôles

Chaque exécution crée un dossier distinct :

```text
artifacts/DATE/ai/FOURNISSEUR-DATE-ID/
  input.json             DOM/CSS préparé pour le modèle
  prompt.md              Copie du prompt utilisé
  request.txt            Texte complet transmis par stdin
  plan.json              Commande, modèle, couverture, taille et délai
  response.schema.json   Schéma imposé au CLI
  cli.stdout.log         Sortie du CLI
  cli.stderr.log         Diagnostic du CLI
  response.json          Réponse structurée et usage renvoyés
  report.json            Contrôles et points à vérifier
  fbr-button.css         CSS produit si les contrôles statiques passent
```

Codex écrit aussi sa réponse finale dans `cli-result.json`. `--dry-run` écrit uniquement les fichiers de préparation. `--output CHEMIN` choisit une autre racine de sortie.

Le prompt et les données passent par **stdin**, sans interpolation shell ni argument géant. Claude est lancé sans outils et sans serveurs MCP ; Codex fonctionne dans le dossier de sortie avec le sandbox `read-only`. Le script Node écrit le fichier CSS après validation. Le prompt demande de travailler uniquement sur les données fournies.

Les contrôles refusent une exécution CLI incomplète, une sortie JSON invalide, du Markdown, des sources non classées/dupliquées, des sélecteurs sans ancre `:host`, le tag racine ou les attributs Angular générés, Sass et `@import`. En cas d’échec, aucun CSS final n’est publié ; les journaux restent disponibles. Les collectes ne sont jamais remplacées.

**Le CSS reste une proposition à vérifier dans Angular.** Les contrôles ne prouvent ni l’équivalence de cascade, ni la fidélité visuelle, ni la pertinence des exclusions du modèle. Codes de sortie : `0` préparation ou génération sans alerte détectée, `1` échec, `2` CSS produit avec points à vérifier. Les pages actuelles n’observent que 1280 px ; les shadow roots des `ion-icon` ne sont pas explorés.

### Volume et limites

La préparation partage les définitions CSS et attributs répétés, retire les explications de filtrage répétées et remplace la longue liste des règles omises par un compte. **Chaque occurrence, ordre, feuille et groupe parent reste représenté.** L’archive complète reste locale, hors du prompt transmis.

Le format `css-regeneration-input-v2` filtre les valeurs calculées aux variables atteignables depuis les règles obligatoires, puis partage les ensembles identiques entre les pages avec `variableSets`. Les signatures de déclarations utilisées par le contrôle de complétude sont recalculées localement après la réponse et ne sont plus dupliquées dans le prompt. Cette compression ne retire aucune définition CSS ni occurrence de cascade.

Pas de limite arbitraire à 1, 2 ou 3 pages : choisir celles qui apportent des variantes utiles. Relancer `collect` pour bénéficier du filtre de sélecteurs amélioré sur une ancienne archive.

`--max-input-chars 600000` bloque par défaut un prompt trop volumineux, sans troncature. Cette taille n’est pas un décompte de tokens ; les instructions internes du CLI s’ajoutent au prompt. `--timeout-ms 1200000` fixe le délai maximal à 20 minutes. La limite de sortie dépend du CLI/modèle : l’ancien `--max-output-tokens` API a été retiré. Un timeout ou une interruption ne déclenche pas de seconde génération automatique par le script.

Documentation : [Codex en mode non interactif](https://developers.openai.com/codex/noninteractive), [Claude Code en mode programmatique](https://code.claude.com/docs/en/headless).

## Utilisation principale : une liste d’URL et de sélecteurs

Modifier **`pages.json`**, déjà rempli avec les trois URL Chromatic et les huit sélecteurs fournis, puis lancer :

```sh
npm run collect
# Ou un autre fichier :
npm run collect -- --pages mon-projet.json
```

Le format minimal est une liste JSON :

```json
[
  {
    "url": "https://mon-site.example/page-a",
    "selectors": ["fbr-button", ".toolbar .action"]
  },
  {
    "url": "https://autre-site.example/page-b",
    "selectors": ["#mon-bouton"]
  }
]
```

Les URL doivent être absolues, HTTP(S). Les domaines peuvent être différents. Chaque sélecteur natif CSS extrait **tous les éléments correspondants** ; au moins un élément doit être présent. Un hôte sans boîte visible ou un élément masqué peut être extrait. Aucune navigation dans l’application, aucun clic et aucune régénération par IA ne sont effectués.

Le format objet permet des options :

```json
{
  "project": "mes-boutons",
  "viewport": {"width": 1280, "height": 720},
  "screenshots": false,
  "includeText": false,
  "pages": [
    {
      "name": "page-a",
      "url": "https://mon-site.example/page-a",
      "selectors": ["fbr-button"],
      "waitFor": "fbr-button button"
    }
  ]
}
```

Options : `timeout` en millisecondes, `navigationAttempts` (1 à 3), `widths` pour plusieurs largeurs, `stopPrefixes`, `ionicSheetURLs` et `storageState` pour une session Playwright (chemin relatif au JSON). Chaque page peut préciser `viewport` et `includeText`. `waitFor` attend la présence d’un sélecteur supplémentaire avant la collecte. Les paramètres d’URL Storybook sont conservés tels quels ; aligner leur viewport avec celui configuré.

Les captures d’écran sont désactivées par défaut dans ce mode. `screenshots: true` ajoute une capture de page. Les images individuelles et les interactions restent disponibles via les scénarios JavaScript avancés.

### Sorties destinées à la régénération CSS

Dans `artifacts/<date>/` :

- `page-001/dom.json`, etc. : graphe DOM lisible, attributs, hiérarchie, cibles et frontières.
- `page-001/candidates.css` : CSS candidat conservant les sélecteurs d’origine, groupes et provenance des règles.
- `page-001/source.css` : règles CSSOM accessibles, y compris celles omises du filtrage.
- `page-001/computed.json` : propriétés calculées et pseudo-éléments observés.
- `page-001/sources.json` : URL de base, état des feuilles et règles omises.
- `ai-context.json` : dossier compact regroupant les captures.
- `archive.json` : archive structurée détaillée et dictionnaire partagé.
- `report.json` : résultat par page, nombres d’éléments trouvés et sous-dossier associé.
- `REGENERATE.md` : consignes pour exploiter les observations avec une IA.

Les CSS sont des **sources pour analyse**, pas encore du CSS converti en `:host`. Les feuilles désactivées sont explicitement annotées dans les exports lisibles. Les URL relatives conservent la base de leur feuille d’origine. Les imports accessibles sont développés avec leurs conditions ; les imports inaccessibles restent signalés. Le DOM est un graphe JSON, pas une copie complète de la page ni un template Angular.

Un sélecteur absent provoque un échec explicite pour sa page et un code de sortie 1 ; les autres pages continuent. Les artefacts réussis restent disponibles. Une collecte sans échec ne garantit pas l’exhaustivité des états dynamiques. Commencer par `REGENERATE.md` et `report.json` avant de donner `ai-context.json` à l’IA.

## Démarrage

```sh
npm install
npm run browsers
npm test
npm run demo
```

La démonstration lance une fixture HTML locale et capture six cas (liste normale/survol, modale, deux largeurs). Ses attributs Angular sont simulés : ce n’est pas une compilation Angular.

Pour le mode avancé avec interactions JavaScript, modifier `scenarios.config.mjs`, puis :

```sh
APP_URL=http://localhost:4200 npm run collect -- --config scenarios.config.mjs
APP_URL=http://localhost:4200 npm run collect -- --config scenarios.config.mjs --headed
```

Une absence de sélecteur attendu ou une erreur de scénario produit un statut failed et un code de sortie 1. Une capture avec un avertissement CORS est conservée, mais ne constitue pas un export exhaustif.

## Scénarios

Configurer les sélecteurs, les routes, les largeurs et les actions applicatives. Chaque combinaison scénario × état × largeur démarre dans un contexte navigateur neuf pour éviter les effets résiduels. Les états nommés doivent être uniques dans chaque scénario.

```js
{
  name: 'ajout-client',
  path: '/clients',
  collector: { selectors: ['fbr-button'] },
  prepare: async page => {
    await page.getByRole('button', {name: 'Ajouter'}).click();
    await page.getByRole('dialog').waitFor();
  },
  states: [
    {name: 'normal'},
    {name: 'survol', prepare: page => page.locator('fbr-button').first().hover()},
  ],
}
```

`prepare` ouvre l’interface, `states[].prepare` établit l’état et `ready(page, state)` peut attendre une condition métier supplémentaire. L’attente des polices est incluse. Aucune découverte automatique des états métier n’est revendiquée. Le script ne clique que selon les fonctions configurées.

Pour l’authentification, fournir `context: {storageState: '.auth/user.json'}` ou un `setup(page, context)` adapté. Un contexte neuf est créé pour chaque cas ; le setup est donc rejoué. Le fichier d’authentification est ignoré par Git. Le projet ne lit pas les sessions de ton navigateur personnel.

Chaque sélecteur configuré doit trouver au moins un élément dans le scénario. Sélectionner de préférence l’hôte Angular pour préparer une migration vers `:host`. Les sélecteurs Playwright spéciaux ne sont pas acceptés par le collecteur : utiliser des sélecteurs CSS natifs.

## Fichiers produits

Chaque exécution crée un sous-dossier daté dans `artifacts/` :

- `archive.json` : toutes les règles CSSOM accessibles, contexte DOM, styles calculés, pseudo-éléments, origine des feuilles, positions et conditions.
- `ai-context.json` : règles candidates ou incertaines et DOM structurel ; textes partagés par références.
- `report.json` : cas prévus, captures, échecs, avertissements et tailles en caractères (pas en tokens).
- `case-*.png` : captures de référence des pages. Pas de comparaison avant/après à ce stade.

Les exports sont mis à jour après chaque cas. Les textes de règle identiques sont stockés une seule fois, mais toutes les occurrences conservent leur feuille, leur position et leur bloc parent. Ne pas dédupliquer ces occurrences lors d’une conversion.

Dans l’archive, `dictionary` est un tableau de chaînes. Dans le dossier IA, c’est un objet conservant les mêmes identifiants. Les champs `*Ref` pointent vers ce dictionnaire. `attrsRef`, `computedRef` et `pseudosRef` contiennent des objets JSON sérialisés. Les styles calculés détaillés restent dans l’archive. Les règles non retenues dans le dossier IA sont identifiées par `omittedRuleIDs`.

Le helper Playwright analyse les sélecteurs avec `postcss-selector-parser`. Il construit des sélecteurs de sondage élargis pour les pseudo-classes et les attributs d’état, y compris `:not()`, `:is()`, `:has()` et les échappements. Les cas non interprétables restent candidats par prudence ; les sources originales restent intactes. Les dépendances comme les polices et keyframes sont conservées sans filtrage agressif. Le dossier IA peut donc rester volumineux ; aucune troncature arbitraire n’est appliquée.

## Architecture

- `src/collector.js` : fonction sérialisable via `page.evaluate`, sans IndexedDB ni navigation.
- `src/run.js` : scénarios, contextes, collecte et captures d’écran.
- `src/exporter.js` : dictionnaire partagé et préparation du dossier IA.
- `src/cli.js` : point d’entrée et codes de sortie.
- `scenarios.config.mjs` : configuration de l’application.
- `scenarios.demo.mjs` et `fixtures/` : exemple local autonome.

Pas d’appel de modèle, de clé API ou de tokens IA pour la collecte. Les tests du projet utilisent Chromium réel sur une fixture locale.

## Limites à garder avec le dossier

Le collecteur observe le DOM présent et les feuilles accessibles. Les branches Angular absentes, styles navigateur, iframe et shadow roots ne sont pas extraits. Les sous-arbres aux frontières `fbr-`, `fmo-`, `fho-`, `mss-`, `fto-` ne sont pas traversés (sauf l’hôte racine sélectionné). Les frères des ancêtres sont décrits sans leurs sous-arbres.

Les règles CSSOM conservent la sémantique exposée par le navigateur, pas les commentaires ou source maps d’origine. Les URL relatives doivent être interprétées selon `baseURL` de chaque feuille. Les règles Ionic sont annotées par URL exacte, pas supprimées.

Le filtrage du dossier IA reste heuristique : il ne prouve pas l’inutilité des règles omises. Les propriétés calculées ne donnent pas la déclaration source gagnante. Captures DOM et images sont prises successivement ; une animation ou des données mouvantes peuvent changer entre les deux. Pour une référence stable, préparer des données déterministes dans le scénario.

Les captures peuvent contenir URL, attributs, styles et contenu visible de l’application. Les textes DOM sont omis par défaut, mais les captures d’écran les montrent. Préférer des données de test. Les artefacts sont ignorés par Git.

## Pages Chromatic demandées

`scenarios.chromatic.mjs` contient les trois stories saving-detail, manage-notifications et mobile, avec les huit sélecteurs demandés. Les échappements Markdown ont été retirés (`ion-row.` désigne bien un tag suivi de classes). Chaque cible doit correspondre à exactement un élément DOM. Son sélecteur visuel doit correspondre à un seul élément visible. Les identifiants `pn_id_*` sont conservés tels que fournis : leur stabilité n’est pas supposée. Un identifiant absent fait échouer le cas, sans remplacement approximatif.

```sh
npm run chromatic
```

La fenêtre et le paramètre Storybook `globals` sont configurés à **1280 × 720**. Pour tester d’autres tailles, modifier les deux de façon cohérente. Le runner ouvre directement `iframe.html` : le contenu de la story devient le document principal, il ne faut pas rechercher une iframe imbriquée.

La sortie comporte une archive, un dossier IA, un rapport, une image de chaque page et une image de chaque bouton nommé (`case-*-target-*.png`). Les images de cibles peuvent provoquer un défilement après la collecte DOM ; elles ne sont pas une capture atomique de l’ensemble. Aucune interaction métier ou clic sur ces boutons n’est exécuté.

Le build fourni est accessible publiquement. Si un autre build demande une connexion, pour réutiliser un accès dont tu disposes :

```sh
npm run chromatic:login
# Se connecter manuellement, puis fermer la fenêtre pour sauvegarder la session.
CHROMATIC_STORAGE_STATE=.auth/chromatic.json npm run chromatic
```

Le script ouvre le générateur Playwright pour permettre cette connexion. `.auth/` est ignoré par Git : ce fichier contient une session et doit rester local. Aucun mot de passe n’est stocké par le projet. Sans session valide, le runner signale l’accès bloqué et enregistre une capture de diagnostic.

Pour utiliser un autre build public sans modifier le fichier :

```sh
CHROMATIC_URL=https://votre-build.chromatic.com npm run chromatic
```

Cette variable change l’origine du build ; les trois identifiants de stories restent ceux de la configuration. Si les pages évoluent, adapter les scénarios et les sélecteurs après inspection du DOM réel.

### Hôte sans boîte visible

Le bouton notifications-form possède un hôte Angular inline de taille 0 × 0, avec un bouton enfant flottant visible. `selector` conserve l’hôte exact demandé pour le CSS/DOM ; `screenshotSelector` pointe vers son enfant `button` pour l’image. Le runner vérifie l’unicité de chacun et ne remplace pas l’hôte dans l’archive. Cette distinction est enregistrée dans le rapport.

Chromatic est configuré avec `navigationAttempts: 3` : en cas de réponse HTTP 401/403/429/502/503/504 intermittente, le runner réessaie au maximum deux fois (attentes de 1 puis 2 secondes). Chaque réponse est enregistrée dans `report.json`. Un accès durablement refusé reste un échec ; aucune session n’est créée automatiquement.
