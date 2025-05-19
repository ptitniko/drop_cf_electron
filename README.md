# Photoroom creative factory

Ce projet est un starter Electron/Node.js pour surveiller un dossier ("hotfolder") et traiter automatiquement les images via une API externe, avec interface de suivi simple.

## Fonctionnalités

- Surveillance automatique d’un dossier pour les nouveaux fichiers image
- Traitement des images via une API externe avec récupération des résultats
- Gestion des erreurs et organisation des fichiers
- Interface Electron minimaliste affichant les logs en temps réel

## Prérequis

- [Node.js](https://nodejs.org/) (version 18 ou plus recommandée)
- [npm](https://www.npmjs.com/)
- [exiftool](https://exiftool.org/) doit être accessible dans le PATH du système

## Installation

1. Clonez le dépôt ou créez le dossier et copiez les fichiers.
2. Installez les dépendances :

   ```sh
   npm install
   ```

3. Créez un fichier `.env` à la racine :

   ```
   WEBHOOK_PORT=4000
   API_URL=https://votre-api/photo
   LOCAL_URL=http://localhost
   ```

   Adaptez les valeurs à votre environnement.

4. Vérifiez que les sous-dossiers suivants existent (sinon, ils seront créés au lancement) :

   ```
   hotfolder/
   processed/
   error/
   originaux/
   metadata/
   renderer/
   ```

5. Placez vos fichiers `index.html` et `renderer.js` dans le dossier `renderer/`.

## Utilisation

Lancez l’application avec :

```sh
npm start
```

L’interface Electron s’ouvre, le serveur Express écoute sur le port défini dans `.env`, les logs s’affichent dans la fenêtre.

Pour accéder directement au hotfolder via le navigateur :  
[http://localhost:4000/files/](http://localhost:4000/files/)

## Construction pour distribution

Pour générer un exécutable pour Windows ou Mac :

```sh
npm run dist
```

Les exécutables seront disponibles dans le dossier `dist/`.

## Personnalisation

- Modifiez les variables dans `.env` selon vos besoins.
- Adaptez la logique de traitement dans `main.js`.
- Améliorez l’interface dans `renderer/index.html` si souhaité.

## Dépannage

- Assurez-vous que les dépendances sont installées (`npm install`).
- Vérifiez que les ports utilisés ne sont pas bloqués ou déjà utilisés.
- Consultez les logs dans la fenêtre Electron ou le terminal pour diagnostiquer d’éventuels problèmes.
