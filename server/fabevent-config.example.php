<?php
/**
 * FabEvent — réglages facultatifs du serveur. Copier en « fabevent-config.php » dans fabevent/api/ (jamais dans Git).
 * Sans ce fichier, tout fonctionne avec les valeurs par défaut.
 */
return [
    // dossier privé des données (par défaut : fabevent-prive/ à côté du dossier du site, hors du web)
    // 'data_dir' => '/home/monsite/fabevent-prive',

    // code d'installation choisi par toi (8 caractères min.) : demandé une seule fois pour créer le premier compte
    // administrateur sur un serveur qui a déjà des données. À retirer une fois le compte créé.
    // 'setup_code' => 'CHOISIS-UN-CODE',

    // recherche de la fiche technique des articles (Matériel → « Chercher la fiche technique ») : sans réglage, FabEvent
    // interroge DuckDuckGo puis Bing. Pour une recherche plus fiable, une clé Brave Search API (offre gratuite :
    // https://brave.com/search/api/) :
    // 'search_key' => 'TA-CLÉ-BRAVE',
];
