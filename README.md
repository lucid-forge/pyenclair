# PyEnClair

[Utiliser PyEnClair en ligne](https://lucid-forge.github.io/pyenclair/)

**Du code Python, en français simple.**

PyEnClair est un outil pédagogique qui transforme du code Python en explications françaises à l’aide de règles déterministes et modifiables. L’analyse est réalisée entièrement dans le navigateur, sans exécuter le programme, sans intelligence artificielle et sans transmettre le code sur Internet.

## Fonctionnalités

- analyse du code à partir d’un arbre syntaxique Python ;
- traduction ligne par ligne en français ;
- distinction entre explication précise et explication structurelle ;
- représentation visuelle de l’indentation et des blocs ;
- coloration syntaxique commune au code et à sa traduction ;
- présentation compacte des valeurs dans les listes, tuples et ensembles, avec leur type au survol ou au clavier ;
- présentation sur une ligne des dictionnaires simples comportant jusqu’à quatre entrées, avec distinction des clés et des valeurs dans les infobulles ;
- présentation structurée des longues listes de dictionnaires et distinction entre accès par clé, par position et par tranche ;
- traduction en français des formats courants des f-strings et de l’ancien opérateur `%` ;
- formulation concise des définitions et appels de fonctions, avec leur rôle indiqué dans une infobulle ;
- reconnaissance de motifs sémantiques courants, séparée du moteur d’interface ;
- fonctionnement en ligne ou directement depuis un fichier local ;
- dictionnaires de traduction JSON lisibles et modifiables.

## Bibliothèques prises en charge

Le projet couvre Python et des opérations courantes de sa bibliothèque standard, ainsi qu’une sélection d’appels de :

- NumPy ;
- SciPy ;
- pandas ;
- Matplotlib ;
- Seaborn ;
- scikit-learn ;
- Requests ;
- Statsmodels ;
- Plotly.
- Pillow.

Cette liste indique les bibliothèques reconnues, mais ne signifie pas que l’intégralité de chaque API est traduite. Un appel inconnu doit recevoir une explication structurelle plutôt qu’une description artificiellement précise.

## Utilisation

### Depuis GitHub Pages

Ouvrez simplement le site publié, collez du code Python puis sélectionnez **Expliquer le code**.

### En local

Ouvrez `index.html` dans un navigateur récent. Aucun serveur web n’est nécessaire.

Sous Windows, `DEMARRER.cmd` peut aussi synchroniser les traductions embarquées avant d’ouvrir l’application.

## Modifier les traductions

Les dictionnaires se trouvent dans le dossier `traductions/`. Chaque bibliothèque possède un fichier JSON séparé.

Après une modification, exécutez `GENERER-TRADUCTIONS.ps1` ou `DEMARRER.cmd` sous Windows afin de reconstruire les fichiers `*-data.js` utilisés lorsque l’application est ouverte sans serveur web.

Les fichiers JSON et leurs versions JavaScript doivent toujours rester synchronisés avant une publication.

## Structure principale

```text
index.html                  Page principale
a-propos.html               Méthode, confidentialité et bibliothèques
app.js                      Moteur de traduction et interface
regles-semantiques.js       Détection déterministe des motifs sémantiques
parser.bundle.js            Analyseur syntaxique embarqué
styles.css                  Présentation
traductions/                Dictionnaires JSON et données embarquées
LICENSE                     Licence du projet
THIRD_PARTY_NOTICES.md      Licences des composants tiers
```

## Confidentialité

Le code saisi reste dans le navigateur. PyEnClair n’exécute pas ce code et ne l’envoie à aucun service distant.

## Limites

PyEnClair est un outil d’aide à la compréhension, pas un interpréteur Python. Certaines expressions complexes, bibliothèques inconnues ou méthodes propres à une application peuvent recevoir une explication structurelle.

Les règles sémantiques reconnaissent uniquement des structures suffisamment caractéristiques. Si un motif est ambigu, si ses expressions ne correspondent pas exactement ou si une fonction intégrée nécessaire a été redéfinie, l’application conserve sa traduction compositionnelle générale.

Les formats numériques courants sont explicités (`.2f`, `.2%`, `04d`, alignement, largeur, séparateurs de milliers, notation scientifique et bases numériques). Un format dynamique ou non reconnu reste affiché sous sa notation Python afin de ne pas inventer son effet.

## Transparence sur le développement

Ce projet a été développé en grande partie selon une démarche de **« vibe coding »**, avec l’aide de Codex d’OpenAI pour produire, modifier, relire et tester le code. Les objectifs, les choix fonctionnels, les formulations françaises et les validations ont été dirigés et révisés par l’auteur du projet.

Cette assistance concerne uniquement la création du logiciel : **PyEnClair n’utilise aucune intelligence artificielle pour analyser ou traduire le code Python saisi**. Son fonctionnement repose sur un analyseur syntaxique local et des règles déterministes conservées dans des fichiers JSON. Le code saisi n’est envoyé ni à OpenAI ni à un autre service distant.

## Licence

PyEnClair est distribué sous [licence MIT](LICENSE). Les composants tiers intégrés conservent leurs propres mentions dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
