# PyEnClair

**Du code Python, en français simple.**

PyEnClair est un outil pédagogique qui transforme du code Python en explications françaises à l’aide de règles déterministes et modifiables. L’analyse est réalisée entièrement dans le navigateur, sans exécuter le programme, sans intelligence artificielle et sans transmettre le code sur Internet.

## Fonctionnalités

- analyse du code à partir d’un arbre syntaxique Python ;
- traduction ligne par ligne en français ;
- distinction entre explication précise et explication structurelle ;
- représentation visuelle de l’indentation et des blocs ;
- coloration syntaxique commune au code et à sa traduction ;
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

## Licence

PyEnClair est distribué sous [licence MIT](LICENSE). Les composants tiers intégrés conservent leurs propres mentions dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


